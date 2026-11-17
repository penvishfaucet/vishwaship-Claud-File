"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Cond = { mode?: string; payment?: string; warehouseId?: string; pinPrefixes: string[]; minGrams?: number; maxGrams?: number };
type Rule = { id: string; name: string; priority: number; active: boolean; conditions: Cond; couriers: string[] };
type Opt = { code: string; name: string };

const blank: Rule = { id: "", name: "", priority: 100, active: true, conditions: { pinPrefixes: [] }, couriers: [] };

export function AssignRules({ rules, couriers, warehouses }: { rules: Rule[]; couriers: Opt[]; warehouses: Array<{ id: string; label: string }> }) {
  const [edit, setEdit] = useState<Rule | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const cname = (c: string) => couriers.find((x) => x.code === c)?.name ?? c;
  const describe = (c: Cond) => [c.mode, c.payment === "cod" ? "COD" : c.payment === "prepaid" ? "Prepaid" : null, c.warehouseId ? `from ${warehouses.find((w) => w.id === c.warehouseId)?.label ?? "warehouse"}` : null,
    c.pinPrefixes.length ? `PIN ${c.pinPrefixes.join(", ")}` : null, c.minGrams != null || c.maxGrams != null ? `${c.minGrams != null ? c.minGrams / 1000 : 0}–${c.maxGrams != null ? c.maxGrams / 1000 : "∞"} kg` : null].filter(Boolean).join(" · ") || "All orders";
  async function save(r: Rule) {
    setBusy(true); setErr("");
    const body = { ...(r.id ? { id: r.id } : {}), name: r.name, priority: r.priority, active: r.active, couriers: r.couriers, conditions: { ...r.conditions, mode: r.conditions.mode || undefined, payment: r.conditions.payment || undefined, warehouseId: r.conditions.warehouseId || undefined } };
    const res = await fetch("/api/portal/assign-rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) { setEdit(null); router.refresh(); } else setErr((await res.json().catch(() => ({}))).error?.message ?? "Could not save");
  }
  async function remove(id: string) {
    if (!confirm("Delete this rule?")) return;
    const res = await fetch("/api/portal/assign-rules", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) router.refresh(); else setErr("Could not delete");
  }
  const toggleCourier = (c: string) => setEdit((e) => e && ({ ...e, couriers: e.couriers.includes(c) ? e.couriers.filter((x) => x !== c) : [...e.couriers, c] }));
  const setC = (patch: Partial<Cond>) => setEdit((e) => e && ({ ...e, conditions: { ...e.conditions, ...patch } }));
  return (
    <>
      <div className="row between mb12"><span className="small muted">{rules.length} rule{rules.length === 1 ? "" : "s"} · lower priority number runs first</span><button type="button" className="btn btn-orange" onClick={() => setEdit({ ...blank, priority: (rules.at(-1)?.priority ?? 0) + 10 })}>Add rule</button></div>
      {err && <p className="small t-debit" role="alert">{err}</p>}
      {edit && (
        <section className="card mb12" style={{ padding: 16 }} aria-label={edit.id ? "Edit rule" : "New rule"}>
          <div className="grid3" style={{ gap: 10 }}>
            <div className="field"><label htmlFor="rn">Rule name</label><input id="rn" className="input" value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="rp">Priority</label><input id="rp" type="number" min={1} max={999} className="input" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) || 100 })} /></div>
            <label className="check small" style={{ alignSelf: "end" }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            <div className="field"><label htmlFor="rm">Shipment type</label><select id="rm" className="select" value={edit.conditions.mode ?? ""} onChange={(e) => setC({ mode: e.target.value || undefined })}><option value="">Any</option><option>B2C</option><option>B2B</option></select></div>
            <div className="field"><label htmlFor="rpay">Payment</label><select id="rpay" className="select" value={edit.conditions.payment ?? ""} onChange={(e) => setC({ payment: e.target.value || undefined })}><option value="">Any</option><option value="prepaid">Prepaid</option><option value="cod">COD</option></select></div>
            <div className="field"><label htmlFor="rw">Warehouse</label><select id="rw" className="select" value={edit.conditions.warehouseId ?? ""} onChange={(e) => setC({ warehouseId: e.target.value || undefined })}><option value="">Any</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></div>
            <div className="field"><label htmlFor="rpin">Delivery PIN codes / prefixes</label><input id="rpin" className="input" placeholder="e.g. 400, 110001" value={edit.conditions.pinPrefixes.join(", ")} onChange={(e) => setC({ pinPrefixes: e.target.value.split(/[\s,]+/).filter((x) => /^\d{1,6}$/.test(x)) })} /></div>
            <div className="field"><label htmlFor="rmin">Min weight (kg)</label><input id="rmin" type="number" step="0.01" min={0} className="input" value={edit.conditions.minGrams != null ? edit.conditions.minGrams / 1000 : ""} onChange={(e) => setC({ minGrams: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 1000) })} /></div>
            <div className="field"><label htmlFor="rmax">Max weight (kg)</label><input id="rmax" type="number" step="0.01" min={0} className="input" value={edit.conditions.maxGrams != null ? edit.conditions.maxGrams / 1000 : ""} onChange={(e) => setC({ maxGrams: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 1000) })} /></div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
            <legend className="small b">Couriers, in order of preference (click to add / remove)</legend>
            <div className="row wrap" style={{ gap: 6 }}>{couriers.map((c) => { const i = edit.couriers.indexOf(c.code); return <button key={c.code} type="button" className={`btn btn-sm ${i >= 0 ? "btn-navy" : "btn-outline"}`} aria-pressed={i >= 0} onClick={() => toggleCourier(c.code)}>{i >= 0 ? `${i + 1}. ` : ""}{c.name}</button>; })}</div>
          </fieldset>
          <div className="row mt12" style={{ gap: 8 }}><button type="button" className="btn btn-orange" disabled={busy || edit.name.trim().length < 2 || !edit.couriers.length} onClick={() => save(edit)}>{busy ? "Saving…" : "Save rule"}</button><button type="button" className="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button></div>
        </section>
      )}
      {rules.length === 0 && !edit ? <div className="card empty"><p className="muted">No rules yet. Without rules, Auto-assign uses your Manage Courier order, then the cheapest courier.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Priority</th><th>Rule</th><th>When</th><th>Use couriers</th><th>Status</th><th /></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id}><td className="small b">{r.priority}</td><td className="small">{r.name}</td><td className="small">{describe(r.conditions)}</td><td className="small">{r.couriers.map(cname).join(" → ")}</td>
              <td><span className={`chip ${r.active ? "c-active" : "c-draft"}`}>{r.active ? "Active" : "Paused"}</span></td>
              <td><span className="row" style={{ gap: 6 }}><button type="button" className="btn btn-sm btn-outline" onClick={() => setEdit(r)}>Edit</button><button type="button" className="btn btn-sm btn-outline" onClick={() => remove(r.id)}>Delete</button></span></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
