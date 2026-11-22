"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { rupees } from "@/lib/store-themes";
import { Msg, api } from "./ui";

const idemKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
type M = { ok?: string; err?: string } | null;

/** pricePaise is before GST; grossPaise = price + GST (what the wallet pays). */
export type PlanView = { id: string; name: string; interval: string; pricePaise: number; grossPaise: number };

/** Plan cards. One idempotency key per opened confirmation, so a double click or retry charges once. */
export function BuyPlan({ plans, walletPaise, startsLabel }: { plans: PlanView[]; walletPaise: number; startsLabel: string }) {
  const router = useRouter();
  const [pick, setPick] = useState<PlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const key = useRef("");
  function open(p: PlanView) { setPick(p); setMsg(null); key.current = idemKey(); }
  async function buy() {
    if (!pick) return;
    setBusy(true); setMsg(null);
    const r = await api<{ until: string; receipt: string }>("POST", "/api/portal/store/plan", { planId: pick.id, idem: key.current });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setPick(null);
    setMsg({ ok: `Done. Receipt ${r.data.receipt}. Your plan runs till ${new Date(r.data.until).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.` });
    router.refresh();
  }
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
        {plans.map((p) => (
          <div key={p.id} className="card" style={{ padding: 16 }}>
            <div className="small muted">{p.name}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--navy)", margin: "4px 0" }}>{rupees(p.pricePaise)}<span className="small muted" style={{ fontWeight: 400 }}> + GST / {p.interval}</span></div>
            <div className="tiny muted">{rupees(p.grossPaise)} incl. GST · paid from your wallet · plus 1.5% + GST on delivered orders only</div>
            <button className="btn btn-orange" style={{ marginTop: 10, width: "100%" }} onClick={() => open(p)}>Choose {p.name}</button>
          </div>
        ))}
      </div>
      {pick && (
        <div className="card" style={{ padding: 16, marginTop: 12, maxWidth: 560, borderColor: "var(--orange)" }} role="dialog" aria-label="Confirm plan">
          <b>Confirm: {pick.name} plan for {rupees(pick.pricePaise)} + GST = {rupees(pick.grossPaise)}</b>
          <p className="small" style={{ margin: "6px 0" }}>{rupees(pick.grossPaise)} will be taken from your wallet (available {rupees(walletPaise)}). {startsLabel}</p>
          {walletPaise < pick.grossPaise && <p className="small red" style={{ margin: "6px 0" }}>Not enough balance. <a className="orange" href="/portal/billing/recharges/">Recharge your wallet</a> first.</p>}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-orange" onClick={buy} disabled={busy || walletPaise < pick.grossPaise}>{busy ? "Paying…" : `Pay ${rupees(pick.grossPaise)} from wallet`}</button>
            <button className="btn btn-outline" onClick={() => setPick(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      <Msg m={msg} />
    </div>
  );
}

async function post(body: Record<string, unknown>) { return api("POST", "/api/portal/store/managed-ads", body); }

export function TermsAccept({ terms, version, accepted, capRupees }: { terms: string; version: number; accepted: boolean; capRupees: number | null }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [cap, setCap] = useState(capRupees ? String(capRupees) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await post({ action: "terms", version, monthlyCapRupees: Number(cap) });
    setBusy(false);
    setMsg(r.ok ? { ok: "Terms accepted." } : { err: r.error });
    if (r.ok) router.refresh();
  }
  return (
    <form onSubmit={save}>
      <pre className="small" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", background: "var(--gray-soft)", borderRadius: 10, padding: 12, maxHeight: 260, overflow: "auto", margin: 0 }}>{terms}</pre>
      <p className="tiny muted" style={{ margin: "4px 0 10px" }}>Terms version {version}{accepted ? " · you accepted this version" : ""}</p>
      <div className="field" style={{ maxWidth: 320 }}><label htmlFor="cap">Monthly ad spend limit (₹)</label>
        <input id="cap" className="input" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 15000" required />
        <span className="small muted">We will never ask you to approve a plan above this. Meta charges this to your ad account, not your wallet.</span></div>
      <label className="row" style={{ gap: 8, marginTop: 10 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I have read and accept these terms</label>
      <Msg m={msg} />
      <button className="btn btn-orange" style={{ marginTop: 10 }} disabled={!ok || busy || !cap}>{busy ? "Saving…" : accepted ? "Update limit / accept again" : "Accept terms"}</button>
    </form>
  );
}

export function CheckToggle({ itemKey, done, label }: { itemKey: string; done: boolean; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function flip() {
    setBusy(true); setErr("");
    const r = await post({ action: "check", key: itemKey, done: !done });
    setBusy(false);
    if (!r.ok) setErr(r.error); else router.refresh();
  }
  return <span><button type="button" className="btn btn-sm btn-outline" onClick={flip} disabled={busy}>{done ? "Undo" : label}</button>{err && <span className="small red"> {err}</span>}</span>;
}

export function DepositPay({ amountPaise, walletPaise, ready }: { amountPaise: number; walletPaise: number; ready: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  const key = useRef(idemKey());
  async function pay() {
    setBusy(true); setMsg(null);
    const r = await post({ action: "deposit", idem: key.current });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setMsg({ ok: "Deposit paid. Your receipt is below." }); router.refresh();
  }
  return (
    <div>
      <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={!ready} /> Hold {rupees(amountPaise)} from my wallet as a refundable security deposit</label>
      {walletPaise < amountPaise && <p className="small red" style={{ margin: "6px 0 0" }}>Wallet balance is {rupees(walletPaise)}. <a className="orange" href="/portal/billing/recharges/">Recharge</a> first.</p>}
      {!ready && <p className="small muted" style={{ margin: "6px 0 0" }}>Accept the terms first.</p>}
      <Msg m={msg} />
      <button className="btn btn-orange" style={{ marginTop: 10 }} onClick={pay} disabled={!confirm || !ready || busy || walletPaise < amountPaise}>{busy ? "Paying…" : `Pay ${rupees(amountPaise)} deposit`}</button>
    </div>
  );
}

export function RefundRequest({ canRequest, why }: { canRequest: boolean; why?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await post({ action: "refund", reason });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setOpen(false); router.refresh();
  }
  if (!canRequest) return why ? <p className="small muted" style={{ margin: 0 }}>{why}</p> : null;
  return open ? (
    <form onSubmit={send} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
      <div className="field"><label htmlFor="rr">Reason (optional)</label><textarea id="rr" className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <Msg m={msg} />
      <div className="row" style={{ gap: 8 }}><button className="btn btn-orange" disabled={busy}>{busy ? "Sending…" : "Ask for refund"}</button><button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  ) : <button className="btn btn-outline" onClick={() => setOpen(true)}>Ask for the deposit back</button>;
}

export function AdsStatusButtons({ status }: { status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<M>(null);
  async function go(to: "paused" | "ended") {
    if (!confirm(to === "ended" ? "End Managed Meta Ads? Vishwaship will stop working on your ads. You can then ask for your deposit back." : "Pause Managed Meta Ads? No new changes will be made until it is restarted.")) return;
    setBusy(true); setMsg(null);
    const r = await post({ action: "status", to });
    setBusy(false);
    if (!r.ok) setMsg({ err: r.error }); else router.refresh();
  }
  if (status === "ended") return null;
  return (
    <div className="row wrap" style={{ gap: 8 }}>
      {status === "active" && <button className="btn btn-outline" onClick={() => go("paused")} disabled={busy}>Pause service</button>}
      <button className="btn btn-outline" onClick={() => go("ended")} disabled={busy}>End service</button>
      <Msg m={msg} />
    </div>
  );
}

/** Explicit spend approval: the merchant ticks a box that states the budget before Approve is enabled. */
export function ApproveChange({ id, budgetText }: { id: string; budgetText: string }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<M>(null);
  async function decide(approve: boolean) {
    setBusy(approve ? "a" : "r"); setMsg(null);
    const r = await post({ action: "decide", changeId: id, approve, confirm: ok, note });
    setBusy(null);
    if (!r.ok) setMsg({ err: r.error }); else router.refresh();
  }
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
      <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} style={{ marginTop: 3 }} /> I approve spending {budgetText} on this. Meta charges it to my own ad account.</label>
      <input className="input" placeholder="Note for your account manager (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <Msg m={msg} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-orange" onClick={() => decide(true)} disabled={!ok || !!busy}>{busy === "a" ? "Approving…" : "Approve"}</button>
        <button className="btn btn-outline" onClick={() => decide(false)} disabled={!!busy}>{busy === "r" ? "Rejecting…" : "Reject"}</button>
      </div>
    </div>
  );
}
