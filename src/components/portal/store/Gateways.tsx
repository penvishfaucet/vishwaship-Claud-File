"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Msg, api } from "./ui";

type Field = { key: string; label: string; secret: boolean };
export type GatewayCard = {
  key: string; label: string; fields: Field[]; help: string;
  initial: { hints: Record<string, string>; mode: "test" | "live"; verified: boolean; lastTestAt: string | null; lastTestMessage: string | null } | null;
};

/** One payment gateway account (Cashfree / PhonePe / Paytm): keys, test/live mode, save & test, remove. */
export function GatewayForm({ g }: { g: GatewayCard }) {
  const router = useRouter();
  const init = g.initial;
  const [mode, setMode] = useState<"test" | "live">(init?.mode ?? "live");
  const [keys, setKeys] = useState<Record<string, string>>(Object.fromEntries(g.fields.map((f) => [f.key, f.secret ? "" : init?.hints[f.key] ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy("save"); setMsg(null);
    const r = await api<{ message: string }>("PUT", "/api/portal/store/gateways", { gateway: g.key, mode, keys });
    setBusy(null); setMsg(r.ok ? { ok: r.data.message } : { err: r.error });
    setKeys(Object.fromEntries(g.fields.map((f) => [f.key, f.secret ? "" : keys[f.key]]))); router.refresh();
  }
  async function other(method: "POST" | "DELETE") {
    if (method === "DELETE" && !confirm(`Remove your ${g.label} keys?`)) return;
    setBusy(method); setMsg(null);
    const r = await api<{ message?: string }>(method, "/api/portal/store/gateways", { gateway: g.key });
    setBusy(null); setMsg(r.ok ? { ok: method === "DELETE" ? "Keys removed." : r.data.message } : { err: r.error }); router.refresh();
  }
  return (
    <details className="card" style={{ padding: 16, maxWidth: 760 }} open={!!init}>
      <summary className="row between" style={{ cursor: "pointer", gap: 8 }}>
        <b>{g.label}</b>
        {init ? <span className={`chip ${init.verified ? "c-active" : "c-cancelled"}`}>{init.verified ? `Connected · ${init.mode} mode` : "Not connected"}</span> : <span className="chip c-draft">Not set up</span>}
      </summary>
      <form onSubmit={save} style={{ marginTop: 12 }}>
        <p className="small muted" style={{ marginTop: 0 }}>{g.help}</p>
        <div className="grid2">
          {g.fields.map((f) => (
            <div className="field" key={f.key}><label htmlFor={`${g.key}-${f.key}`}>{f.label}</label>
              <input id={`${g.key}-${f.key}`} className={`input${f.secret ? "" : " mono"}`} type={f.secret ? "password" : "text"} autoComplete="off" value={keys[f.key]}
                onChange={(e) => setKeys({ ...keys, [f.key]: e.target.value })} placeholder={f.secret && init?.hints[f.key] ? `Saved (${init.hints[f.key]}) — leave blank to keep` : ""} required={!f.secret || !init} /></div>
          ))}
          <div className="field"><label htmlFor={`${g.key}-mode`}>Mode</label>
            <select id={`${g.key}-mode`} className="input select" value={mode} onChange={(e) => setMode(e.target.value as "test" | "live")}><option value="live">Live (real payments)</option><option value="test">Test (sandbox keys)</option></select></div>
        </div>
        {init?.lastTestMessage && <p className="small muted" style={{ marginBottom: 0 }}>Last check: {init.lastTestMessage}{init.lastTestAt ? ` (${new Date(init.lastTestAt).toLocaleString("en-IN")})` : ""}</p>}
        <Msg m={msg} />
        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-orange" disabled={!!busy}>{busy === "save" ? "Checking…" : "Save & test"}</button>
          {init && <button type="button" className="btn btn-outline" onClick={() => other("POST")} disabled={!!busy}>Test again</button>}
          {init && <button type="button" className="btn btn-outline" onClick={() => other("DELETE")} disabled={!!busy}>Remove</button>}
        </div>
      </form>
    </details>
  );
}

const NAMES: Record<string, string> = { razorpay: "Razorpay", cashfree: "Cashfree", phonepe: "PhonePe Business", paytm: "Paytm Business" };

/** When more than one method is connected, the merchant picks the one buyers get for "Pay online". */
export function PrimaryPicker({ methods, primary }: { methods: string[]; primary: string | null }) {
  const router = useRouter();
  const [v, setV] = useState(primary ?? methods[0] ?? "");
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  if (methods.length < 2) return null;
  async function save() {
    const r = await api("PATCH", "/api/portal/store/gateways", { primary: v });
    setMsg(r.ok ? { ok: "Saved." } : { err: r.error }); router.refresh();
  }
  return (
    <div className="card" style={{ padding: 16, maxWidth: 760, marginBottom: 12 }}>
      <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <div className="field"><label htmlFor="pg-primary">Buyers pay online through</label>
          <select id="pg-primary" className="input select" value={v} onChange={(e) => setV(e.target.value)}>{methods.map((m) => <option key={m} value={m}>{NAMES[m] ?? m}</option>)}</select></div>
        <button className="btn btn-outline" onClick={save}>Save</button>
      </div>
      <Msg m={msg} />
    </div>
  );
}
