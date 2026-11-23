import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";
import { audit } from "@/server/audit";
import { getAuthSettings } from "@/server/email/service";
import { activeService } from "@/server/integrations/services";
import { firebasePhoneConfig } from "@/server/auth/firebase-phone";

/** Client ID + secret: Admin → API Keys & Services (when ON), else GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the server. */
async function googleKeys(): Promise<{ id: string; secret: string } | null> {
  const v = await activeService("google_oauth");
  if (v?.clientId && v.clientSecret) return { id: v.clientId, secret: v.clientSecret };
  const id = process.env.GOOGLE_CLIENT_ID?.trim(), secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

/**
 * Continue with Google (OpenID Connect, authorization-code flow with PKCE).
 * Server config: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL (redirect URI = APP_URL + /api/auth/google/callback).
 * Admin → Settings → Email & Sign-in can switch it off without a deploy.
 */
const KEY = () => process.env.APP_ENCRYPTION_KEY ?? "dev";
const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/+$/, "");
export const googleRedirectUri = () => `${appUrl()}/api/auth/google/callback`;
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(v: unknown) { const p = b64url(Buffer.from(JSON.stringify(v))); return `${p}.${hmacSha256Hex(KEY(), p)}`; }
function unsign<T>(s: string | undefined): T | null {
  if (!s) return null;
  const [p, mac] = s.split(".");
  if (!p || !mac || !safeEqual(mac, hmacSha256Hex(KEY(), p))) return null;
  try { const v = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()) as T & { exp?: number }; return v.exp && v.exp < Date.now() ? null : v; } catch { return null; }
}
const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function googleAvailable() {
  const on = (await getAuthSettings()).googleEnabled;
  const keys = await googleKeys();
  return { enabled: on && !!keys, configured: !!keys, switchedOn: on };
}

/**
 * "Continue with Google" through Firebase: used only when the direct Google sign-in above has no keys, the Admin
 * switch "Show Continue with Google" is ON, and the Firebase mobile-OTP card is ON. Returns the Firebase web config.
 */
export function firebaseGoogleFrom<T>(g: { enabled: boolean; switchedOn: boolean }, firebase: T | null): T | null {
  return !g.enabled && g.switchedOn ? firebase : null;
}
export async function firebaseGoogleConfig() {
  const [g, fb] = await Promise.all([googleAvailable(), firebasePhoneConfig()]);
  return firebaseGoogleFrom(g, fb);
}

/** URL to send the browser to Google; remembers state, nonce and the PKCE verifier in a short signed cookie. */
export async function googleStartUrl(next: string) {
  const state = b64url(randomBytes(18)), nonce = b64url(randomBytes(18)), verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  (await cookies()).set("vs_goauth", sign({ state, nonce, verifier, next, exp: Date.now() + 10 * 60_000 }), { ...cookieOpts, maxAge: 600 });
  const keys = await googleKeys();
  if (!keys) throw new Error("Google sign-in is not configured");
  const q = new URLSearchParams({ client_id: keys.id, redirect_uri: googleRedirectUri(), response_type: "code", scope: "openid email profile",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export type GoogleIdentity = { sub: string; email: string; name: string };

/** Exchange the code and validate the ID token on our server (audience, issuer, expiry, nonce, verified email). */
export async function googleCallback(code: string, state: string): Promise<{ ok: true; id: GoogleIdentity; next: string } | { ok: false; message: string }> {
  const jar = await cookies();
  const saved = unsign<{ state: string; nonce: string; verifier: string; next: string }>(jar.get("vs_goauth")?.value);
  jar.delete("vs_goauth");
  if (!saved || !safeEqual(saved.state, state)) return { ok: false, message: "Google sign-in expired or was opened in another tab. Please try again." };
  const keys = await googleKeys();
  if (!keys) return { ok: false, message: "Google sign-in is switched off" };
  const tr = await safeFetch("https://oauth2.googleapis.com/token", {
    method: "POST", allowedHosts: ["oauth2.googleapis.com"], timeoutMs: 15_000, headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: keys.id, client_secret: keys.secret, redirect_uri: googleRedirectUri(), grant_type: "authorization_code", code_verifier: saved.verifier }).toString(),
  }).catch(() => null);
  const tj = (await tr?.json().catch(() => ({}))) as { id_token?: string } | undefined;
  if (!tr?.ok || !tj?.id_token) return { ok: false, message: "Google did not confirm the sign-in. Please try again." };
  // Google's tokeninfo endpoint checks the signature and expiry; we check audience, issuer, nonce and verified email.
  const ir = await safeFetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tj.id_token)}`, { allowedHosts: ["oauth2.googleapis.com"], timeoutMs: 15_000 }).catch(() => null);
  const c = (await ir?.json().catch(() => ({}))) as { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string | boolean; name?: string; nonce?: string; exp?: string } | undefined;
  if (!ir?.ok || !c) return { ok: false, message: "Could not verify the Google account" };
  if (c.aud !== keys.id || !["accounts.google.com", "https://accounts.google.com"].includes(c.iss ?? "") || !c.sub || c.nonce !== saved.nonce || Number(c.exp) * 1000 < Date.now())
    return { ok: false, message: "Google sign-in could not be verified" };
  if (!(c.email_verified === true || c.email_verified === "true") || !c.email) return { ok: false, message: "This Google account has no verified email address" };
  return { ok: true, id: { sub: c.sub, email: c.email.toLowerCase(), name: (c.name ?? "").trim() || c.email.split("@")[0] }, next: saved.next };
}

/** Google email matches an existing account: remember the identity until the customer signs in with their password. */
export async function rememberPendingLink(id: GoogleIdentity) {
  (await cookies()).set("vs_glink", sign({ ...id, exp: Date.now() + 15 * 60_000 }), { ...cookieOpts, maxAge: 900 });
}
export async function pendingLink() { return unsign<GoogleIdentity>((await cookies()).get("vs_glink")?.value); }

/** After a password login: link the pending Google identity when it belongs to the same email. */
export async function linkPendingGoogle(userId: string, email: string | null) {
  const jar = await cookies();
  const p = unsign<GoogleIdentity>(jar.get("vs_glink")?.value);
  if (!p) return false;
  jar.delete("vs_glink");
  if (!email || p.email !== email.toLowerCase()) return false;
  const db = await getDb();
  const [other] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.googleSub, p.sub));
  if (other && other.id !== userId) return false;
  await db.update(schema.users).set({ googleSub: p.sub, emailVerifiedAt: new Date() }).where(and(eq(schema.users.id, userId), eq(schema.users.kind, "customer")));
  await audit({ actorUserId: userId, actorKind: "customer", action: "auth.google_linked" });
  return true;
}
