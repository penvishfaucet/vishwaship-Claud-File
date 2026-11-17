"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Info } from "lucide-react";
import { type FormState, customerLogin, customerSignup, staffLogin } from "@/server/auth/actions";

function Seg({ active }: { active: "signup" | "login" }) {
  return (
    <div className="seg mb16" style={{ width: "fit-content" }}>
      <Link href="/signup/" className={active === "signup" ? "on" : ""} style={{ width: 110, textAlign: "center" }}>Sign up</Link>
      <Link href="/login/" className={active === "login" ? "on" : ""} style={{ width: 110, textAlign: "center" }}>Login</Link>
    </div>
  );
}

const Err = ({ s }: { s: FormState }) => s?.error ? <p className="err small" role="alert">{s.error}</p> : null;

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(customerLogin, undefined);
  return (
    <>
      <Seg active="login" />
      <h1 style={{ fontSize: 24 }}>Welcome back</h1>
      <p className="muted small" style={{ margin: "4px 0 18px" }}>Login with your email or mobile number</p>
      <form className="col" style={{ gap: 14 }} action={action}>
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="field"><label htmlFor="identifier">Email or mobile</label><input id="identifier" name="identifier" className="input" required autoFocus autoComplete="username" /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" className="input" type="password" required autoComplete="current-password" /></div>
        <Err s={state} />
        <button className="btn btn-orange btn-lg btn-block" disabled={pending}>{pending ? "Logging in…" : "Login"}</button>
        <div className="center small muted">New here? <Link className="link" href="/signup/">Create account</Link> · <Link className="link-navy" href="/forgot-password/">Forgot password</Link> · <Link className="link-navy" href="/admin/login/">Admin login</Link></div>
      </form>
    </>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(customerSignup, undefined);
  return (
    <>
      <Seg active="signup" />
      <h1 style={{ fontSize: 24 }}>Create your account</h1>
      <p className="muted small" style={{ margin: "4px 0 18px" }}>Start shipping in 2 minutes</p>
      <form className="col" style={{ gap: 14 }} action={action}>
        <div className="grid2">
          <div className="field"><label htmlFor="name">Full name</label><input id="name" name="name" className="input" placeholder="Rahul Kumar" required autoComplete="name" /></div>
          <div className="field"><label htmlFor="business">Business name</label><input id="business" name="business" className="input" placeholder="Kumar Traders" required autoComplete="organization" /></div>
          <div className="field"><label htmlFor="mobile">Mobile</label><input id="mobile" name="mobile" className="input" inputMode="tel" placeholder="+91 98xxxxxx10" required autoComplete="tel" /></div>
          <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" className="input" type="email" placeholder="you@business.in" required autoComplete="email" /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" className="input" type="password" placeholder="Min 8 characters" required minLength={8} autoComplete="new-password" /></div>
          <div className="field"><label htmlFor="volume">Monthly shipments</label>
            <select id="volume" name="volume" className="select" defaultValue="100 – 500"><option>0 – 100</option><option>100 – 500</option><option>500 – 2,000</option><option>2,000+</option></select>
          </div>
        </div>
        <div className="field"><label htmlFor="gstin">GSTIN (optional)</label><input id="gstin" name="gstin" className="input" placeholder="07AAxxxxxx1Z5" /></div>
        <label className="check"><input type="checkbox" name="terms" required /> I agree to the <Link className="link" target="_blank" href="/terms/">Terms &amp; shipping policy</Link></label>
        <Err s={state} />
        <button className="btn btn-orange btn-lg btn-block" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
        <div className="center small muted">Already have an account? <Link className="link" href="/login/">Login</Link></div>
        <div className="note row" style={{ gap: 6 }}><Info size={16} /> After sign-up: KYC (PAN / GST / Aadhaar) → add pickup address → recharge wallet → book</div>
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
