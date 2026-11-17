"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

type C = { code: string; name: string; logo: string | null; available: boolean; services: string[] };

/** Manage Courier: switch couriers on/off for this account and set the preference order used by auto-assign. */
export function CourierManager({ couriers, initial }: { couriers: C[]; initial: { disabled: string[]; priority: string[] } }) {
  const ordered = [...couriers].sort((a, b) => {
    const ia = initial.priority.indexOf(a.code), ib = initial.priority.indexOf(b.code);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.name.localeCompare(b.name);
  });
  const [list, setList] = useState(ordered);
  const [disabled, setDisabled] = useState(new Set(initial.disabled));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const router = useRouter();
  const move = (i: number, d: -1 | 1) => setList((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; setState("idle"); return n; });
  const toggle = (code: string) => setDisabled((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); setState("idle"); return n; });
  async function save() {
    setState("saving"); setErr("");
    const r = await fetch("/api/portal/settings/courier_prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ disabled: [...disabled], priority: list.map((c) => c.code) }) });
    if (r.ok) { setState("saved"); router.refresh(); } else { setState("error"); setErr((await r.json().catch(() => ({}))).error?.message ?? "Could not save"); }
  }
  const enabledCount = list.filter((c) => c.available && !disabled.has(c.code)).length;
  return (
    <>
      <div className="card p0 tbl-wrap">
        <table className="tbl">
          <thead><tr><th style={{ width: 70 }}>Priority</th><th>Courier</th><th>Services</th><th>Status</th><th>Use for my account</th></tr></thead>
          <tbody>{list.map((c, i) => (
            <tr key={c.code} className={!c.available ? "muted" : undefined}>
              <td><span className="row" style={{ gap: 2 }}><button type="button" className="icon-btn" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button><button type="button" className="icon-btn" aria-label={`Move ${c.name} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button><span className="small b">{i + 1}</span></span></td>
              <td className="small"><span className="row" style={{ gap: 8, alignItems: "center" }}>{c.logo && <img src={c.logo} alt="" width={28} height={28} style={{ objectFit: "contain" }} />}<b>{c.name}</b></span></td>
              <td className="small">{c.services.length ? c.services.join(", ") : <span className="muted">—</span>}</td>
              <td>{!c.available ? <span className="chip c-draft">Not offered by Vishwaship</span> : disabled.has(c.code) ? <span className="chip c-failed">Off</span> : <span className="chip c-active">Active</span>}</td>
              <td><label className="check small"><input type="checkbox" checked={c.available && !disabled.has(c.code)} disabled={!c.available} onChange={() => toggle(c.code)} /> {c.available ? (disabled.has(c.code) ? "Hidden from my rates" : "Show in my rates") : "Unavailable"}</label></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="row wrap mt12" style={{ gap: 10, alignItems: "center" }}>
        <button type="button" className="btn btn-orange" disabled={state === "saving" || enabledCount === 0} onClick={save}>{state === "saving" ? "Saving…" : "Save preferences"}</button>
        {enabledCount === 0 && <span className="small t-debit">Keep at least one courier on.</span>}
        {state === "saved" && <span className="small t-credit" role="status">Saved. Rates, Price List and Auto-Assign now use these preferences.</span>}
        {state === "error" && <span className="small t-debit" role="alert">{err}</span>}
      </div>
    </>
  );
}
