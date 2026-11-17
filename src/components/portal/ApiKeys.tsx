"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound } from "lucide-react";

const SCOPES = ["quotes:read", "orders:read", "orders:write", "shipments:write", "tracking:read", "labels:read", "ndr:write"];
type Key = { id: string; label: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; expiresAt: string | null };

export function ApiKeys({ keys }: { keys: Key[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>(["quotes:read", "orders:read", "tracking:read"]);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const r = await fetch("/api/portal/api-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, scopes }) });
    const j = await r.json(); setBusy(false);
    if (r.ok) { setCreated(j); setOpen(false); router.refresh(); }
  }
  async function revoke(id: string) {
    if (!confirm("Revoke this key? Integrations using it will stop working immediately.")) return;
    await fetch(`/api/portal/api-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    router.refresh();
  }
  return (
    <>
      <div className="row between mb12"><p className="small muted" style={{ margin: 0 }}>Keys give programmatic access to your workspace only. Send <span className="mono">Authorization: Bearer &lt;key_id&gt;.&lt;secret&gt;</span>.</p><button className="btn btn-orange" onClick={() => setOpen(true)}><KeyRound size={16} /> Generate Key</button></div>
      {created && (
        <div className="note mb12" role="alert">
          <b>Copy your secret now — it won’t be shown again.</b>
          <div className="mono small mt8" style={{ wordBreak: "break-all" }}>{created.id}.{created.secret}</div>
          <button className="btn btn-sm btn-outline mt8" onClick={() => { navigator.clipboard.writeText(`${created.id}.${created.secret}`); }}>Copy</button>
          <button className="btn btn-sm btn-outline mt8" style={{ marginLeft: 8 }} onClick={() => setCreated(null)}>I’ve saved it</button>
        </div>
      )}
      {open && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="gk-h" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal card" style={{ padding: 20, maxWidth: 460 }} onSubmit={create}>
            <h2 id="gk-h" style={{ fontSize: 18, marginTop: 0 }}>Generate API key</h2>
            <div className="field"><label htmlFor="kl">Label</label><input id="kl" className="input" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Website checkout" /></div>
            <fieldset className="mt12" style={{ border: 0, padding: 0 }}>
              <legend className="small b">Scopes</legend>
              {SCOPES.map((s) => <label key={s} className="check small" style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />{s}</label>)}
            </fieldset>
            <div className="row mt12" style={{ gap: 8 }}><button className="btn btn-orange" disabled={busy || !scopes.length}>Generate</button><button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button></div>
          </form>
        </div>
      )}
      <div className="card p0 tbl-wrap">
        <table className="tbl"><thead><tr><th>Label</th><th>Key ID</th><th>Scopes</th><th>Created</th><th>Last used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {keys.length === 0 && <tr><td colSpan={7} className="small muted center">No API keys yet.</td></tr>}
            {keys.map((k) => <tr key={k.id}><td>{k.label}</td><td className="mono tiny">{k.id}</td><td className="tiny">{k.scopes.join(", ")}</td><td className="small">{new Date(k.createdAt).toLocaleDateString("en-IN")}</td><td className="small">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("en-IN") : "Never"}</td><td><span className={`chip ${k.revokedAt ? "c-cancelled" : "c-active"}`}>{k.revokedAt ? "Revoked" : "Active"}</span></td><td>{!k.revokedAt && <button className="btn btn-sm btn-outline" onClick={() => revoke(k.id)}>Revoke</button>}</td></tr>)}
          </tbody></table>
      </div>
    </>
  );
}
