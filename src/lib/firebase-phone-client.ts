"use client";
import { useEffect, useState } from "react";

/**
 * Browser side of Firebase phone OTP (login page and pickup-mobile checks). Firebase's own SDK is loaded from Google
 * only when an OTP is actually sent (nothing is bundled). The server checks every resulting token itself.
 */
export type PhoneOtpConfig = { apiKey: string; authDomain: string; projectId: string; appId?: string };
export type Confirmation = { confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }> };
type Fb = { signOut: () => Promise<void>; send: (phone: string, boxId: string) => Promise<Confirmation> };

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
      send: async (phone: string, boxId: string) => {
        verifier?.clear();
        verifier = new a.RecaptchaVerifier(auth, boxId, { size: "invisible" });
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
export const fbError = (e: unknown) => MSG[(e as { code?: string })?.code ?? ""] ?? "Could not send or check the OTP. Please try again.";

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
