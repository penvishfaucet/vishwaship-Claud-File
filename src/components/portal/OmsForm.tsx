"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const PROVIDERS = [["unicommerce", "Unicommerce"], ["easyecom", "EasyEcom"], ["vinculum", "Vinculum"], ["browntape", "Browntape"], ["custom", "Other / in-house OMS"]] as const;

export function OmsForm({ initial }: { initial: { provider: string; accountName: string; pushShipmentUpdates: boolean; notes: string } | null }) {
  const [v, setV] = useState(initial ?? { provider: "unicommerce", accountName: "", pushShipmentUpdates: true, notes: "" });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const router = useRouter();
  async function save() {
    setState("saving");
    const r = await fetch("/api/portal/settings/oms", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    if (r.ok) { setState("saved"); router.refresh(); } else { setState("error"); setErr((await r.json().catch(() => ({}))).error?.message ?? "Could not save"); }
  }
  return (
    <div className="grid2" style={{ gap: 10 }}>
      <div className="field"><label htmlFor="op">OMS</label><select id="op" className="select" value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })}>{PROVIDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="field"><label htmlFor="oa">OMS account / tenant name</label><input id="oa" className="input" value={v.accountName} maxLength={80} onChange={(e) => setV({ ...v, accountName: e.target.value })} /></div>
      <label className="check small" style={{ gridColumn: "1 / -1" }}><input type="checkbox" checked={v.pushShipmentUpdates} onChange={(e) => setV({ ...v, pushShipmentUpdates: e.target.checked })} /> Send AWB and tracking updates back to the OMS</label>
      <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="on">Field mapping notes (channel, warehouse codes, SKU mapping)</label><textarea id="on" className="input" rows={2} maxLength={300} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
      <div className="row" style={{ gap: 10, alignItems: "center", gridColumn: "1 / -1" }}>
        <button type="button" className="btn btn-orange" disabled={state === "saving" || v.accountName.trim().length < 2} onClick={save}>{initial ? "Update request" : "Request connection"}</button>
        {state === "saved" && <span className="small t-credit" role="status">Saved. Vishwaship will set up the connector and update the status here.</span>}
        {state === "error" && <span className="small t-debit" role="alert">{err}</span>}
      </div>
    </div>
  );
}
