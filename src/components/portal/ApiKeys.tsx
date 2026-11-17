"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound } from "lucide-react";

const SCOPES = ["quotes:read", "orders:read", "orders:write", "shipments:write", "tracking:read", "labels:read", "ndr:write"];
type Key = { id: string; label: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; expiresAt: string | null; orgName?: string };

/**
 * Shared API-credential manager.
 *  - Customer portal: endpoint=/api/portal/api-keys (own workspace only).
 *  - Admin portal:    endpoint=/api/admin/api-keys + orgs list (owner issues keys for a customer).
 * The secret is shown once after Generate/Rotate and is never sent to the browser again.
 */
export function ApiKeys({ keys, endpoint = "/api/portal/api-keys", orgs }: { keys: Key[]; endpoint?: string; orgs?: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const admin = !!orgs;
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [orgId, setOrgId] = useState(orgs?.[0]?.id ?? "");
  const [expiry, setExpiry] = useState("");
  const [scopes, setScopes] = useState<string[]>(["quotes:read", "orders:read", "tracking:read"]);
  const [shown, setShown] = useState<{ id: string; secret: string; rotated?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const body = { label, scopes, ...(expiry ? { expiresInDays: Number(expiry) } : {}), ...(admin ? { orgId } : {}) };
    const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error?.issues?.[0]?.message ?? j.error?.message ?? "Could not create key"); return; }
    setShown(j); setOpen(false); setLabel(""); router.refresh();
  }
  async function rotate(id: string) {
    if (!confirm("Rotate this key? A new secret is created and the current secret stops working immediately. Update your integration with the new secret.")) return;
    const r = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error?.message ?? "Could not rotate"); return; }
    setShown({ ...j, rotated: true }); router.refresh();
  }
  async function revoke(id: string) {
    if (!confirm("Revoke this key? Integrations using it will stop working immediately.")) return;
    await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    router.refresh();
  }
  return (
    <>
      <div className="row between wrap mb12" style={{ gap: 8 }}>
        <p className="small muted" style={{ margin: 0, maxWidth: 640 }}>{admin ? "Issue API credentials for a customer workspace. Each key can only act for that customer." : "Keys give programmatic access to your workspace only."} Send <span className="mono">Authorization: Bearer &lt;API Key&gt;.&lt;API Secret&gt;</span> to <span className="mono">/api/v1</span>.</p>
        <button className="btn btn-orange" onClick={() => setOpen(true)} disabled={admin && !orgs?.length}><KeyRound size={16} /> Generate Key</button>
      </div>
      {shown && (
        <div className="note mb12" role="alert">
          <b>{shown.rotated ? "Key rotated — the old secret no longer works." : "API credentials created."} Copy the secret now — it won’t be shown again.</b>
          <dl className="kv-list mt8"><dt>API Key</dt><dd className="mono">{shown.id}</dd><dt>API Secret</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{shown.secret}</dd></dl>
          <div className="row mt8" style={{ gap: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={() => navigator.clipboard.writeText(`${shown.id}.${shown.secret}`)}>Copy Bearer value</button>
            <button className="btn btn-sm btn-outline" onClick={() => setShown(null)}>I’ve saved it</button>
          </div>
        </div>
      )}
      {err && <p className="err small" role="alert">{err}</p>}
      {open && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="gk-h" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal card" style={{ padding: 20, maxWidth: 480 }} onSubmit={create}>
            <h2 id="gk-h" style={{ fontSize: 18, marginTop: 0 }}>Generate API credentials</h2>
            {admin && <div className="field"><label htmlFor="ko">Customer workspace</label><select id="ko" className="select" value={orgId} onChange={(e) => setOrgId(e.target.value)}>{orgs!.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}
            <div className="field mt8"><label htmlFor="kl">Label</label><input id="kl" className="input" required minLength={2} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Website checkout" /></div>
            <div className="field mt8"><label htmlFor="ke">Expires</label><select id="ke" className="select" value={expiry} onChange={(e) => setExpiry(e.target.value)}><option value="">Never</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option></select></div>
            <fieldset className="mt12" style={{ border: 0, padding: 0 }}>
              <legend className="small b">Scopes (what this key may do)</legend>
              {SCOPES.map((s) => <label key={s} className="check small" style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />{s}</label>)}
            </fieldset>
            <div className="row mt12" style={{ gap: 8 }}><button className="btn btn-orange" disabled={busy || !scopes.length}>{busy ? "Creating…" : "Generate"}</button><button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button></div>
          </form>
        </div>
      )}
      <div className="card p0 tbl-wrap">
        <table className="tbl"><thead><tr>{admin && <th>Customer</th>}<th>Label</th><th>API Key</th><th>Scopes</th><th>Created</th><th>Expires</th><th>Last used</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {keys.length === 0 && <tr><td colSpan={admin ? 9 : 8} className="small muted center">No API keys yet.</td></tr>}
            {keys.map((k) => {
              const expired = k.expiresAt && new Date(k.expiresAt).getTime() < Date.now();
              const status = k.revokedAt ? "Revoked" : expired ? "Expired" : "Active";
              return (
                <tr key={k.id}>
                  {admin && <td className="small">{k.orgName}</td>}
                  <td>{k.label}</td><td className="mono tiny">{k.id}</td><td className="tiny">{k.scopes.join(", ")}</td>
                  <td className="small">{new Date(k.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="small">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString("en-IN") : "Never"}</td>
                  <td className="small">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("en-IN") : "Never"}</td>
                  <td><span className={`chip ${status === "Active" ? "c-active" : "c-cancelled"}`}>{status}</span></td>
                  <td>{status === "Active" && <div className="row" style={{ gap: 4 }}><button className="btn btn-sm btn-outline" onClick={() => rotate(k.id)}>Rotate</button><button className="btn btn-sm btn-outline" onClick={() => revoke(k.id)}>Revoke</button></div>}</td>
                </tr>
              );
            })}
          </tbody></table>
      </div>
    </>
  );
}
