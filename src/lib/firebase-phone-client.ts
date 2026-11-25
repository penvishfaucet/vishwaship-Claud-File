"use client";
import { useEffect, useState } from "react";

/**
 * Browser side of Firebase phone OTP (login page and pickup-mobile checks). Firebase's own SDK is loaded from Google
 * only when an OTP is actually sent (nothing is bundled). The server checks every resulting token itself.
 */
export type PhoneOtpConfig = { apiKey: string; authDomain: string; projectId: string; appId?: string };
export type Confirmation = { confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }> };
export type OtpPurpose = "login" | "staff" | "store" | "pickup";
type Fb = { signOut: () => Promise<void>; send: (phone: string, boxId: string, purpose?: OtpPurpose) => Promise<Confirmation> };

/** Thrown when our server refuses an OTP (limits); shown to the user as-is. */
export class OtpLimitError extends Error {}

/** Ask the server before Firebase sends an SMS (per-number / per-network / daily site limits). */
async function otpPermission(phone: string, purpose: OtpPurpose) {
  const r = await fetch("/api/auth/otp-request/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mobile: phone, purpose }) });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new OtpLimitError(j?.error?.message ?? "Too many OTP requests. Please try again later.");
  }
}

const SDK = "https://www.gstatic.com/firebasejs/13.2.0";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (u: string): Promise<any> => new Function("u", "return import(u)")(u);
let fbPromise: Promise<Fb> | null = null;

export function firebasePhone(cfg: PhoneOtpConfig): Promise<Fb> {
  fbPromise ??= (async () => {
    const [{ initializeApp, getApps }, a] = await Promise.all([load(`${SDK}/firebase-app.js`), load(`${SDK}/firebase-auth.js`)]);
    const app = getApps().find((x: { name: string }) => x.name === "vs-phone") ?? initializeApp(cfg, "vs-phone");
    const auth = a.getAuth(app);
    auth.languageCode = "en";
    let verifier: { clear: () => void } | null = null;
    return {
      signOut: () => a.signOut(auth),
      send: async (phone: string, boxId: string, purpose: OtpPurpose = "login") => {
        await otpPermission(phone, purpose);
        verifier?.clear();
        // Visible "I'm not a robot" check before every SMS (owner 2026-11-26): the OTP goes out only after it is solved.
        verifier = new a.RecaptchaVerifier(auth, boxId, { size: "normal" });
        return a.signInWithPhoneNumber(auth, phone, verifier);
      },
    };
  })().catch((e) => { fbPromise = null; throw e; });
  return fbPromise;
}

/** Check the code; returns the Firebase ID token for our server, then drops Firebase's own sign-in. */
export async function confirmPhoneOtp(cfg: PhoneOtpConfig, c: Confirmation, code: string) {
  const token = await (await c.confirm(code)).user.getIdToken();
  void firebasePhone(cfg).then((fb) => fb.signOut()).catch(() => {});
  return token;
}

/**
 * Continue with Google through Firebase (used when the site's direct Google sign-in is not set up). Opens Google's
 * account chooser in a popup and returns the Firebase ID token for our server, then drops Firebase's own sign-in.
 * Call `preloadFirebaseGoogle` when the button appears so the click opens the popup at once (browsers block popups
 * opened long after the click).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FbGoogle = { auth: any; a: any };
let googlePromise: Promise<FbGoogle> | null = null;
export function preloadFirebaseGoogle(cfg: PhoneOtpConfig): Promise<FbGoogle> {
  googlePromise ??= (async () => {
    const [{ initializeApp, getApps }, a] = await Promise.all([load(`${SDK}/firebase-app.js`), load(`${SDK}/firebase-auth.js`)]);
    const app = getApps().find((x: { name: string }) => x.name === "vs-google") ?? initializeApp(cfg, "vs-google");
    const auth = a.getAuth(app);
    auth.languageCode = "en";
    return { auth, a };
  })().catch((e) => { googlePromise = null; throw e; });
  return googlePromise;
}
export async function firebaseGoogleSignIn(cfg: PhoneOtpConfig): Promise<string> {
  const { auth, a } = await preloadFirebaseGoogle(cfg);
  const provider = new a.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await a.signInWithPopup(auth, provider);
  const token: string = await cred.user.getIdToken();
  void a.signOut(auth).catch(() => {});
  return token;
}
const GOOGLE_MSG: Record<string, string> = {
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/popup-closed-by-user": "Google sign-in was cancelled.",
  "auth/cancelled-popup-request": "Google sign-in was cancelled.",
  "auth/user-cancelled": "Google sign-in was cancelled.",
  "auth/unauthorized-domain": "Continue with Google is not set up for this website yet. Use email instead.",
  "auth/operation-not-allowed": "Continue with Google is not switched on yet. Use email instead.",
  "auth/operation-not-supported-in-this-environment": "This browser cannot open the Google window. Use email or mobile OTP instead.",
  "auth/web-storage-unsupported": "This browser blocks the storage Google sign-in needs. Use email or mobile OTP instead.",
  "auth/user-disabled": "This Google account is disabled. Use email instead.",
  "auth/too-many-requests": "Too many attempts from this device. Please try again later.",
  "auth/network-request-failed": "No internet connection. Check your network and try again.",
};
/** True when the customer simply closed the Google window (show a gentle note, not an error). */
export const googleCancelled = (e: unknown) => ["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"].includes((e as { code?: string })?.code ?? "");
export const googleError = (e: unknown) => GOOGLE_MSG[(e as { code?: string })?.code ?? ""] ?? "Google sign-in could not be completed. Please try again.";

const MSG: Record<string, string> = {
  "auth/invalid-phone-number": "Enter a valid 10-digit mobile number.",
  "auth/too-many-requests": "Too many OTP requests from this device. Please try again later.",
  "auth/quota-exceeded": "OTP limit reached for today. Please try again tomorrow.",
  "auth/invalid-verification-code": "Wrong OTP. Check the code and try again.",
  "auth/code-expired": "This OTP has expired. Request a new one.",
  "auth/captcha-check-failed": "Security check failed. Reload the page and try again.",
  "auth/unauthorized-domain": "Mobile OTP is not set up for this website yet. Contact support.",
  "auth/operation-not-allowed": "Mobile OTP is not switched on yet. Contact support.",
  "auth/billing-not-enabled": "Mobile OTP is not switched on yet. Contact support.",
  "auth/network-request-failed": "No internet connection. Check your network and try again.",
};
export const fbError = (e: unknown) => e instanceof OtpLimitError ? e.message : MSG[(e as { code?: string })?.code ?? ""] ?? "Could not send or check the OTP. Please try again.";

let cfgPromise: Promise<PhoneOtpConfig | null> | null = null;
/** Public web config when Admin has switched mobile OTP ON (undefined while loading, null when off). */
export function usePhoneOtpConfig() {
  const [cfg, setCfg] = useState<PhoneOtpConfig | null | undefined>(undefined);
  useEffect(() => {
    cfgPromise ??= fetch("/api/auth/firebase-phone/", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { config: null })).then((j) => j.config ?? null).catch(() => { cfgPromise = null; return null; });
    let live = true;
    void cfgPromise.then((c) => { if (live) setCfg(c); });
    return () => { live = false; };
  }, []);
  return cfg;
}
