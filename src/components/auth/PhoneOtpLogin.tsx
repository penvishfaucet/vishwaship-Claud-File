"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";

export type PhoneOtpConfig = { apiKey: string; authDomain: string; projectId: string; appId?: string };

/* Firebase's own browser SDK, loaded from Google only when the customer chooses mobile OTP (nothing is bundled). */
const SDK = "https://www.gstatic.com/firebasejs/13.2.0";
type Confirmation = { confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }> };
type Fb = {
  auth: unknown; signOut: () => Promise<void>;
  send: (phone: string) => Promise<Confirmation>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (u: string): Promise<any> => new Function("u", "return import(u)")(u);
let fbPromise: Promise<Fb> | null = null;
function firebase(cfg: PhoneOtpConfig, boxId: string): Promise<Fb> {
  fbPromise ??= (async () => {
    const [{ initializeApp, getApps }, a] = await Promise.all([load(`${SDK}/firebase-app.js`), load(`${SDK}/firebase-auth.js`)]);
    const app = getApps().find((x: { name: string }) => x.name === "vs-phone") ?? initializeApp(cfg, "vs-phone");
    const auth = a.getAuth(app);
    auth.languageCode = "en";
    let verifier: { clear: () => void } | null = null;
    return {
      auth,
      signOut: () => a.signOut(auth),
      send: async (phone: string) => {
        verifier?.clear();
        verifier = new a.RecaptchaVerifier(auth, boxId, { size: "invisible" });
        return a.signInWithPhoneNumber(auth, phone, verifier);
      },
    };
  })().catch((e) => { fbPromise = null; throw e; });
  return fbPromise;
}

const MSG: Record<string, string> = {
  "auth/invalid-phone-number": "Enter a valid 10-digit mobile number.",
  "auth/too-many-requests": "Too many OTP requests from this device. Please try again later.",
  "auth/quota-exceeded": "OTP limit reached for today. Please use email login.",
  "auth/invalid-verification-code": "Wrong OTP. Check the code and try again.",
  "auth/code-expired": "This OTP has expired. Request a new one.",
  "auth/captcha-check-failed": "Security check failed. Reload the page and try again.",
  "auth/unauthorized-domain": "Mobile OTP is not set up for this website yet. Please use email login.",
  "auth/operation-not-allowed": "Mobile OTP is not switched on yet. Please use email login.",
  "auth/billing-not-enabled": "Mobile OTP is not switched on yet. Please use email login.",
  "auth/network-request-failed": "No internet connection. Check your network and try again.",
};
const fbError = (e: unknown) => MSG[(e as { code?: string })?.code ?? ""] ?? "Could not send or check the OTP. Please try again.";

/** "Login with Mobile OTP" — on the login and signup pages, shown only when Admin has switched Firebase ON. */
export function PhoneOtpLogin({ config, next }: { config: PhoneOtpConfig | null; next?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"mobile" | "code" | "signup">("mobile");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cool, setCool] = useState(0);
  const [shown, setShown] = useState("");
  const [f, setF] = useState({ name: "", email: "", terms: false });
  const conf = useRef<Confirmation | null>(null);
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool((c) => c - 1), 1000); return () => clearTimeout(t); }, [cool]);
  if (!config) return null;
  const valid = /^[6-9]\d{9}$/.test(mobile);

  async function send() {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      const fb = await firebase(config!, "vs-recaptcha");
      conf.current = await fb.send(`+91${mobile}`);
      setStep("code"); setCode(""); setCool(30);
    } catch (e) { setErr(fbError(e)); }
    setBusy(false);
  }

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/auth/firebase-phone/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, next: next ?? "" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? "Something went wrong. Please try again.");
    return j as { redirect?: string; signup?: boolean; mobile?: string };
  }

  async function check() {
    if (!/^\d{6}$/.test(code) || busy || !conf.current) return;
    setBusy(true); setErr("");
    try {
      let token: string;
      try { token = await (await conf.current.confirm(code)).user.getIdToken(); } catch (e) { setErr(fbError(e)); setBusy(false); return; }
      const j = await post({ op: "verify", idToken: token });
      void firebase(config!, "vs-recaptcha").then((fb) => fb.signOut()).catch(() => {}); // our own session is the login; drop Firebase's
      if (j.redirect) { window.location.assign(j.redirect); return; }
      if (j.signup) { setShown(j.mobile ?? `+91 ${mobile}`); setStep("signup"); }
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function signup() {
    if (busy) return;
    setBusy(true); setErr("");
    try { const j = await post({ op: "signup", ...f }); window.location.assign(j.redirect ?? "/portal/"); return; }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  if (!open) return (
    <>
      <button type="button" className="btn-google" onClick={() => setOpen(true)} style={{ width: "100%", cursor: "pointer" }}>
        <Smartphone size={18} aria-hidden /> Login with Mobile OTP
      </button>
      <div className="or-line"><span>or</span></div>
    </>
  );

  return (
    <section className="phone-otp col" style={{ gap: 12, marginBottom: 16 }} aria-label="Login with mobile OTP">
      <div id="vs-recaptcha" />
      {step === "mobile" && (
        <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="field">
            <label htmlFor="po-mobile">Mobile number</label>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className="input" style={{ width: 56, flex: "none", display: "grid", placeItems: "center" }} aria-hidden>+91</span>
              <input id="po-mobile" className="input" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="10-digit mobile" value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))} style={{ flex: 1, minWidth: 0 }} autoFocus />
            </div>
          </div>
          <button className="btn btn-orange btn-lg btn-block" disabled={!valid || busy}>{busy ? "Sending OTP…" : "Send OTP"}</button>
        </form>
      )}
      {step === "code" && (
        <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void check(); }}>
          <p className="small muted" style={{ margin: 0 }}>OTP sent to <b>+91 {mobile}</b> · <button type="button" className="link" onClick={() => { setStep("mobile"); setErr(""); }}>Change</button></p>
          <div className="field">
            <label htmlFor="po-code">6-digit OTP</label>
            <input id="po-code" className="input otp-in" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} autoFocus />
            <p className="tiny muted">Didn&apos;t get it? <button type="button" className="link" onClick={() => void send()} disabled={cool > 0 || busy}>{cool > 0 ? `Resend OTP in ${cool}s` : "Resend OTP"}</button></p>
          </div>
          <button className="btn btn-orange btn-lg btn-block" disabled={code.length !== 6 || busy}>{busy ? "Checking…" : "Verify & Login"}</button>
        </form>
      )}
      {step === "signup" && (
        <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void signup(); }}>
          <p className="note small" style={{ margin: 0 }}><b>{shown}</b> is verified. No account uses this number yet — add your details to create one.</p>
          <div className="field"><label htmlFor="po-name">Full name <span className="req" aria-hidden>*</span></label>
            <input id="po-name" className="input" required maxLength={80} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></div>
          <div className="field"><label htmlFor="po-email">Email address <span className="req" aria-hidden>*</span></label>
            <input id="po-email" className="input" type="email" required maxLength={160} autoComplete="email" placeholder="you@business.in" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={f.terms} onChange={(e) => setF({ ...f, terms: e.target.checked })} style={{ width: 18, height: 18, marginTop: 2 }} />
            <span>I agree to the <Link className="link" href="/terms/" target="_blank">Terms &amp; shipping policy</Link></span>
          </label>
          <button className="btn btn-orange btn-lg btn-block" disabled={busy || !f.terms || f.name.trim().length < 2 || !f.email}>{busy ? "Creating account…" : "Create account"}</button>
        </form>
      )}
      {err && <p className="err small" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button type="button" className="link small" style={{ alignSelf: "center" }} onClick={() => { setOpen(false); setStep("mobile"); setErr(""); }}>Use email instead</button>
    </section>
  );
}
