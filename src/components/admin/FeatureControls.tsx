"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/admin/modules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, message: j.message as string } : { ok: false, message: (j.error?.message as string) ?? "Failed" };
}

/** On / Off / Inherit(Default) override buttons for one module, global (orgId null) or per customer. */
export function FeatureButtons({ orgId, module, current, label }: { orgId: string | null; module: string; current: "on" | "off" | "inherit"; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  async function set(value: "on" | "off" | "inherit") {
    setBusy(true); setErr("");
    const r = await post({ op: "feature", orgId, module, value });
    setBusy(false);
    if (!r.ok) setErr(r.message); else router.refresh();
  }
  return (
    <span className="row" style={{ gap: 4 }} role="group" aria-label={`${label} access`}>
      {(["on", "off", "inherit"] as const).map((v) => (
        <button key={v} type="button" className={`btn btn-sm ${current === v ? "btn-navy" : "btn-outline"}`} aria-pressed={current === v} disabled={busy} onClick={() => set(v)}>
          {v === "inherit" ? (orgId ? "Inherit" : "Default") : v === "on" ? "On" : "Off"}
        </button>
      ))}
      {err && <span className="tiny t-debit" role="alert">{err}</span>}
    </span>
  );
}

/** Activate / renew / cancel a customer's plan. */
export function PlanControls({ orgId, plans, currentPlanId }: { orgId: string; plans: Array<{ id: string; label: string }>; currentPlanId: string | null }) {
  const [planId, setPlanId] = useState(currentPlanId ?? "");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();
  async function run(body: Record<string, unknown>) {
    setBusy(true); setMsg("");
    const r = await post(body);
    setBusy(false); setMsg(r.message);
    if (r.ok) router.refresh();
  }
  return (
    <>
      <div className="row wrap" style={{ gap: 8, alignItems: "end" }}>
        <div className="field"><label htmlFor="plan">Plan</label><select id="plan" className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="" disabled>Choose…</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <div className="field"><label htmlFor="days">Valid for (days, 0 = no expiry)</label><input id="days" type="number" min={0} max={3650} className="input" value={days} onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))} style={{ maxWidth: 120 }} /></div>
        <button type="button" className="btn btn-orange" disabled={busy || !planId} onClick={() => run({ op: "assign", orgId, planId, days })}>{currentPlanId ? "Change / renew" : "Activate"}</button>
      </div>
      {currentPlanId && <button type="button" className="btn btn-sm btn-outline mt8" disabled={busy} onClick={() => { if (confirm("Cancel this customer's subscription? Plan-only features switch off immediately.")) run({ op: "cancel", orgId }); }}>Cancel subscription</button>}
      {msg && <p className="small mt8" role="status">{msg}</p>}
    </>
  );
}
