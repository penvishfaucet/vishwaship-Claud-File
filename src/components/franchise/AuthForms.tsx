"use client";
import Link from "next/link";
import { useActionState } from "react";
import { type FrFormState, franchiseLogin, setFranchisePassword } from "@/server/franchise/auth-actions";

const Err = ({ s }: { s: FrFormState }) => (s?.error ? <p className="err small" role="alert">{s.error}</p> : null);

export function FranchiseLoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState(franchiseLogin, undefined);
  return (
    <>
      <span className="pill">Franchise partner</span>
      <h1 style={{ fontSize: 24, marginTop: 12 }}>Franchise login</h1>
      <p className="muted small" style={{ margin: "4px 0 18px" }}>Use the email registered with Vishwaship for your franchise.</p>
      {notice && <p className="err small" role="alert">{notice}</p>}
      <form className="col" style={{ gap: 14 }} action={action}>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" required autoFocus autoComplete="username" /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" className="input" type="password" required autoComplete="current-password" /></div>
        <Err s={state} />
        <button className="btn btn-navy btn-lg btn-block" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        <p className="center tiny muted" style={{ margin: 0 }}>Forgot your password? Ask your Vishwaship manager for a new set-password link.</p>
        <div className="center small muted"><Link className="link-navy" href="/login/">Customer login</Link></div>
      </form>
    </>
  );
}

export function FranchiseSetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(setFranchisePassword, undefined);
  return (
    <>
      <span className="pill">Franchise partner</span>
      <h1 style={{ fontSize: 24, marginTop: 12 }}>Set your password</h1>
      <p className="muted small" style={{ margin: "4px 0 18px" }}>At least 10 characters. This link works once.</p>
      <form className="col" style={{ gap: 14 }} action={action}>
        <input type="hidden" name="token" value={token} />
        <div className="field"><label htmlFor="pw">New password</label><input id="pw" name="password" type="password" className="input" minLength={10} required autoComplete="new-password" /></div>
        <div className="field"><label htmlFor="pw2">Confirm password</label><input id="pw2" name="confirm" type="password" className="input" minLength={10} required autoComplete="new-password" /></div>
        <Err s={state} />
        <button className="btn btn-navy btn-lg btn-block" disabled={pending || !token}>{pending ? "Saving…" : "Save password"}</button>
      </form>
    </>
  );
}
