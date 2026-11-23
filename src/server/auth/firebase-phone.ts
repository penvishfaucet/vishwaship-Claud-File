import "server-only";
import { createPublicKey, verify as verifySig, type JsonWebKey } from "node:crypto";
import { activeService } from "@/server/integrations/services";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * Login with Mobile OTP (Firebase phone auth). The browser gets the SMS code checked by Firebase and sends us the
 * Firebase ID token; nothing is trusted until this file verifies that token's RS256 signature against Google's
 * published keys and its claims (project, issuer, expiry, freshness, phone sign-in, an Indian mobile number).
 * Vishwaship's own session is created afterwards — Firebase never holds our users or sessions.
 */
export type FirebaseWebConfig = { apiKey: string; authDomain: string; projectId: string; appId?: string };

/** Public web config when the service is switched ON in Admin → API Keys & Services, else null. */
export async function firebasePhoneConfig(): Promise<FirebaseWebConfig | null> {
  const v = await activeService("firebase_phone").catch(() => null);
  if (!v?.apiKey || !v.authDomain || !v.projectId) return null;
  return { apiKey: v.apiKey, authDomain: v.authDomain, projectId: v.projectId, ...(v.appId ? { appId: v.appId } : {}) };
}

const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let keyCache: { at: number; ttlMs: number; keys: Array<JsonWebKey & { kid?: string }> } | null = null;

async function googleKeys(force = false) {
  if (!force && keyCache && Date.now() - keyCache.at < keyCache.ttlMs) return keyCache.keys;
  const r = await safeFetch(JWK_URL, { allowedHosts: ["www.googleapis.com"], timeoutMs: 10_000 });
  if (!r.ok) throw new Error(`Google keys HTTP ${r.status}`);
  const j = (await r.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const age = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  keyCache = { at: Date.now(), ttlMs: Math.min(Math.max(age, 300), 6 * 3600) * 1000, keys: j.keys ?? [] };
  return keyCache.keys;
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
export class PhoneTokenError extends Error {}

/**
 * Checks shared by every Firebase ID token: RS256 signature by Google's current keys, our project as audience and
 * issuer, not expired, and signed in within the last 10 minutes (an old token cannot be replayed later).
 */
async function verifyFirebaseIdToken(idToken: string, projectId: string, now: number): Promise<Record<string, unknown> & { sub: string }> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || idToken.length > 4096) throw new PhoneTokenError("bad token");
  let header: { alg?: string; kid?: string }, claims: Record<string, unknown>;
  try { header = JSON.parse(b64(parts[0]).toString()); claims = JSON.parse(b64(parts[1]).toString()); } catch { throw new PhoneTokenError("bad token"); }
  if (!header || !claims || typeof claims !== "object") throw new PhoneTokenError("bad token");
  if (header.alg !== "RS256" || !header.kid) throw new PhoneTokenError("bad token");
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === header.kid); // Google rotated its keys
  if (!jwk) throw new PhoneTokenError("unknown key");
  const ok = verifySig("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), b64(parts[2]));
  if (!ok) throw new PhoneTokenError("bad signature");
  const sec = Math.floor(now / 1000);
  const num = (k: string) => (typeof claims[k] === "number" ? (claims[k] as number) : NaN);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw new PhoneTokenError("wrong project");
  if (!(num("exp") > sec) || !(num("iat") <= sec + 60) || !(num("auth_time") <= sec + 60)) throw new PhoneTokenError("expired");
  // only a sign-in made in the last 10 minutes logs in (an old token cannot be replayed later)
  if (!(num("auth_time") >= sec - 600)) throw new PhoneTokenError("stale");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) throw new PhoneTokenError("bad subject");
  return claims as Record<string, unknown> & { sub: string };
}

/** Verified Indian mobile (10 digits) from a Firebase phone-sign-in ID token, or a PhoneTokenError. */
export async function verifyFirebasePhoneToken(idToken: string, projectId: string, now = Date.now()): Promise<{ mobile: string; uid: string }> {
  const claims = await verifyFirebaseIdToken(idToken, projectId, now);
  const fb = claims.firebase as { sign_in_provider?: string } | undefined;
  if (fb?.sign_in_provider !== "phone") throw new PhoneTokenError("not a phone sign-in");
  const m = /^\+91([6-9]\d{9})$/.exec(String(claims.phone_number ?? ""));
  if (!m) throw new PhoneTokenError("not an Indian mobile");
  return { mobile: m[1], uid: claims.sub };
}

/**
 * Google account from a Firebase Google-sign-in ID token, or a PhoneTokenError. Only a Google-verified email is
 * accepted. `sub` is Google's own account id (firebase.identities["google.com"][0]) — the same id the site's direct
 * Google sign-in stores, so an account linked either way is recognised by both.
 */
export async function verifyFirebaseGoogleToken(idToken: string, projectId: string, now = Date.now()): Promise<{ sub: string; email: string; name: string; uid: string }> {
  const claims = await verifyFirebaseIdToken(idToken, projectId, now);
  const fb = claims.firebase as { sign_in_provider?: string; identities?: Record<string, unknown> } | undefined;
  if (fb?.sign_in_provider !== "google.com") throw new PhoneTokenError("not a Google sign-in");
  if (claims.email_verified !== true) throw new PhoneTokenError("email not verified");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PhoneTokenError("no email");
  const ids = fb.identities?.["google.com"];
  const sub = Array.isArray(ids) ? ids[0] : undefined;
  if (typeof sub !== "string" || !/^[0-9A-Za-z_-]{1,128}$/.test(sub)) throw new PhoneTokenError("no Google id");
  // eslint-disable-next-line no-control-regex
  const name = typeof claims.name === "string" ? claims.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) : "";
  return { sub, email, name: name.length >= 2 ? name : email.split("@")[0].slice(0, 80), uid: claims.sub };
}

/** Test hook: forget cached Google keys. */
export function _resetKeyCache() { keyCache = null; }
