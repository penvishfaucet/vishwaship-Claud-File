"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Info } from "lucide-react";
import { type FormState, customerLogin, customerSignup, staffLogin } from "@/server/auth/actions";

/** Keep the return path (e.g. a booking started in the Rate Calculator) when switching between Login and Sign up. */
const withNext = (path: string, next?: string) => (next && next.startsWith("/") && !next.startsWith("//") ? `${path}?next=${encodeURIComponent(next)}` : path);

function Seg({ active, next }: { active: "signup" | "login"; next?: string }) {
  return (
    <div className="seg mb16" style={{ width: "fit-content" }}>
      <Link href={withNext("/signup/", next)} className={active === "signup" ? "on" : ""} style={{ width: 110, textAlign: "center" }}>Sign up</Link>
      <Link href={withNext("/login/", next)} className={active === "login" ? "on" : ""} style={{ width: 110, textAlign: "center" }}>Login</Link>
    </div>
  );
}

const Err = ({ s }: { s: FormState }) => s?.error ? <p className="err small" role="alert">{s.error}</p> : null;

function GoogleButton({ enabled, next, label }: { enabled: boolean; next?: string; label: string }) {
  if (!enabled) return null;
  return (
    <>
      <a className="btn-google" href={`/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        {label}
      </a>
      <div className="or-line"><span>or</span></div>
    </>
  );
}

const GOOGLE_MSG: Record<string, string> = {
  google: "Google sign-in could not be completed. Please try again.",
  google_cancelled: "Google sign-in was cancelled.",
  google_off: "Continue with Google is switched off right now. Use email instead.",
  google_setup: "Continue with Google is not set up yet. Use email instead.",
  inactive: "This account is not active. Contact support.",
};

export function LoginForm({ next, googleEnabled, err, msg, linkEmail }: { next?: string; googleEnabled: boolean; err?: string; msg?: string; linkEmail?: string }) {
  const [state, action, pending] = useActionState(customerLogin, undefined);
  return (
    <>
      <Seg active="login" next={next} />
      <h1 style={{ fontSize: 24 }}>Welcome back</h1>
      <p className="muted small" style={{ margin: "4px 0 18px" }}>Login with your email or mobile number</p>
      {linkEmail && <p className="note small mb12" role="status"><b>Link your Google account:</b> an account with {linkEmail} already exists. Log in with its password once to connect Google — your shipments, wallet and profile stay on this account.</p>}
      {err && GOOGLE_MSG[err] && <p className="err small" role="alert">{msg || GOOGLE_MSG[err]}</p>}
      {!linkEmail && <GoogleButton enabled={googleEnabled} next={next} label="Continue with Google" />}
      <form className="col" style={{ gap: 14 }} action={action}>
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="field"><label htmlFor="identifier">Email or mobile</label><input id="identifier" name="identifier" className="input" required autoFocus autoComplete="username" defaultValue={linkEmail ?? ""} /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" className="input" type="password" required autoComplete="current-password" /></div>
        <Err s={state} />
        <button className="btn btn-orange btn-lg btn-block" disabled={pending}>{pending ? "Logging in…" : linkEmail ? "Log in & link Google" : "Login"}</button>
        <div className="center small muted">New here? <Link className="link" href={withNext("/signup/", next)}>Create account</Link> · <Link className="link-navy" href="/forgot-password/">Forgot password</Link> · <Link className="link-navy" href="/admin/login/">Admin login</Link></div>
      </form>
    </>
  );
}

/** Sign up: email → Send OTP → code + name + password. The account is created only after the code is verified. */
export function SignupForm({ next, googleEnabled }: { next?: string; googleEnabled: boolean }) {
  const [state, action, pending] = useActionState(customerSignup, undefined);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cool, setCool] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; exists?: boolean } | null>(null);
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool((c) => c - 1), 1000); return () => clearTimeout(t); }, [cool]);
  async function send() {
    if (busy || cool > 0) return;
    setBusy(true); setNote(null);
    const r = await fetch("/api/auth/signup-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) { setSentTo(email.trim().toLowerCase()); setCool(j.cooldownSec ?? 60); setNote({ ok: true, text: `We sent a 6-digit code to ${email.trim()}. It is valid for ${j.validityMin ?? 10} minutes.` }); return; }
    if (j.error?.retryInSec) setCool(j.error.retryInSec);
    setNote({ ok: false, text: j.error?.message ?? "Could not send the code. Please try again.", exists: j.error?.reason === "exists" });
  }
  return (
    <>
      <Seg active="signup" next={next} />
      <h1 style={{ fontSize: 24 }}>Create your account</h1>
      <p className="muted small" style={{ margin: "4px 0 18px" }}>Verify your email to get started</p>
      <GoogleButton enabled={googleEnabled} next={next} label="Continue with Google" />
      <form className="col" style={{ gap: 14 }} action={action}>
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="field">
          <label htmlFor="email">Email Address <span className="req" aria-hidden>*</span></label>
          <div className="row" style={{ gap: 8 }}>
            <input id="email" name="email" className="input" type="email" placeholder="you@business.in" required autoComplete="email" value={email} readOnly={!!sentTo}
              onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            {!sentTo
              ? <button type="button" className="btn btn-navy" onClick={send} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())}>{busy ? "Sending…" : "Send OTP"}</button>
              : <button type="button" className="btn btn-outline" onClick={() => { setSentTo(null); setNote(null); setCool(0); }}>Change Email</button>}
          </div>
          {note && <p className={`small ${note.ok ? "t-ok" : "err"}`} role={note.ok ? "status" : "alert"}>{note.text}{note.exists && <> <Link className="link" href={withNext("/login/", next)}>Log in</Link> · <Link className="link" href="/forgot-password/">Forgot password</Link></>}</p>}
        </div>
        {sentTo && (
          <>
            <div className="field">
              <label htmlFor="otp">Verification code <span className="req" aria-hidden>*</span></label>
              <input id="otp" name="otp" className="input otp-in" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" placeholder="6-digit code" required autoFocus />
              <p className="tiny muted">Didn&apos;t get it? Check spam, or <button type="button" className="link" onClick={send} disabled={cool > 0 || busy}>{cool > 0 ? `Resend OTP in ${cool}s` : "Resend OTP"}</button></p>
            </div>
            <div className="grid2">
              <div className="field"><label htmlFor="name">Full name <span className="req" aria-hidden>*</span></label><input id="name" name="name" className="input" placeholder="Rahul Kumar" required autoComplete="name" /></div>
              <div className="field"><label htmlFor="password">Password <span className="req" aria-hidden>*</span></label><input id="password" name="password" className="input" type="password" placeholder="Min 8 characters" required minLength={8} autoComplete="new-password" /></div>
            </div>
            <label className="check"><input type="checkbox" name="terms" required /> I agree to the <Link className="link" target="_blank" href="/terms/">Terms &amp; shipping policy</Link></label>
            <Err s={state} />
            <button className="btn btn-orange btn-lg btn-block" disabled={pending}>{pending ? "Verifying…" : "Verify & create account"}</button>
          </>
        )}
        <div className="center small muted">Already have an account? <Link className="link" href={withNext("/login/", next)}>Login</Link></div>
        <div className="note row" style={{ gap: 6 }}><Info size={16} /> After sign-up: complete your profile → KYC → admin approval → your account is active for booking</div>
      </form>
    </>
  );
}

export function StaffLoginForm() {
  const [state, action, pending] = useActionState(staffLogin, undefined);
  return (
    <>
      <span className="pill">Admin &amp; franchise workspace</span>
      <h1 style={{ fontSize: 24, marginTop: 12 }}>Staff login</h1>
      <p className="muted small" style={{ margin: "4px 0 18px" }}>Use the staff ID issued by your Vishwaship owner.</p>
      <form className="col" style={{ gap: 14 }} action={action}>
        <div className="field"><label htmlFor="email">Staff email</label><input id="email" name="email" type="email" className="input" required autoFocus autoComplete="username" /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" className="input" type="password" required autoComplete="current-password" /></div>
        <Err s={state} />
        <button className="btn btn-navy btn-lg btn-block" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        <div className="center small muted"><Link className="link-navy" href="/login/">Customer login</Link></div>
      </form>
    </>
  );
}
