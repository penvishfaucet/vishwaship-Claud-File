"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The client's COD payout bank account. The full number is never shown back; re-enter it to change. */
export function CodBankForm({ hasAccount }: { hasAccount: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <form style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const body = Object.fromEntries(["holderName", "accountNumber", "confirmAccount", "ifsc", "bankName"].map((k) => [k, String(fd.get(k) ?? "").trim()]));
      setBusy(true); setMsg(null);
      const r = await fetch("/api/portal/cod-bank", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      setMsg(r.ok ? { ok: true, text: j.message ?? "Saved" } : { ok: false, text: j.error?.message ?? "Could not save" });
      if (r.ok) { (e.target as HTMLFormElement).reset(); router.refresh(); }
    }}>
      <div className="field"><label htmlFor="cb-holder">Account holder name</label><input id="cb-holder" name="holderName" className="input" required minLength={2} maxLength={120} autoComplete="off" /></div>
      <div className="field"><label htmlFor="cb-bank">Bank name</label><input id="cb-bank" name="bankName" className="input" maxLength={80} autoComplete="off" /></div>
      <div className="field"><label htmlFor="cb-acct">Account number</label><input id="cb-acct" name="accountNumber" className="input" required inputMode="numeric" pattern="[0-9 -]{9,24}" autoComplete="off" /></div>
      <div className="field"><label htmlFor="cb-acct2">Confirm account number</label><input id="cb-acct2" name="confirmAccount" className="input" required inputMode="numeric" pattern="[0-9 -]{9,24}" autoComplete="off" onPaste={(e) => e.preventDefault()} /></div>
      <div className="field"><label htmlFor="cb-ifsc">IFSC</label><input id="cb-ifsc" name="ifsc" className="input" required minLength={11} maxLength={11} style={{ textTransform: "uppercase" }} placeholder="HDFC0001234" autoComplete="off" /></div>
      <div className="field" style={{ alignSelf: "end" }}><button className="btn btn-orange" disabled={busy}>{busy ? "Saving…" : hasAccount ? "Change bank account" : "Save bank account"}</button></div>
      {msg && <p className={`small ${msg.ok ? "t-credit" : "t-debit"}`} role="status" style={{ gridColumn: "1 / -1", margin: 0 }}>{msg.text}</p>}
    </form>
  );
}
