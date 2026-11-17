"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Conn = { id: string; platform: string; storeUrl: string; status: string; hint: string | null; warehouseId: string | null; autoSync: boolean; pushTracking: boolean; lastSyncAt: string | null; lastError: string | null; defaultPackage: { lengthCm: number; breadthCm: number; heightCm: number; weightKg: number } };
type Log = { id: string; connectionId: string; name: string | null; outcome: string; message: string | null; orderId: string | null; at: string };

const STORES = [
  { key: "shopify", name: "Shopify", help: "In Shopify admin: Settings → Apps and sales channels → Develop apps → Create an app. Give it Admin API scopes read_orders, read_merchant_managed_fulfillment_orders and write_merchant_managed_fulfillment_orders, install it, and paste the Admin API access token (shpat_…)." },
  { key: "woocommerce", name: "WooCommerce", help: "In WordPress: WooCommerce → Settings → Advanced → REST API → Add key with Read/Write permission. Your site must use HTTPS." },
  { key: "custom", name: "Custom website / API", help: "Use an API key from the API Credentials tab to push orders to /api/v1/orders and receive status webhooks." },
] as const;

export function StoreConnections({ conns, logs, warehouses }: { conns: Conn[]; logs: Log[]; warehouses: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "shopify" | "woocommerce">(null);
  const [f, setF] = useState({ storeUrl: "", token: "", key: "", secret: "", warehouseId: warehouses[0]?.id ?? "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault(); setBusy("connect"); setMsg(null);
    const body = open === "shopify" ? { platform: "shopify", storeUrl: f.storeUrl, token: f.token, warehouseId: f.warehouseId } : { platform: "woocommerce", storeUrl: f.storeUrl, key: f.key, secret: f.secret, warehouseId: f.warehouseId };
    const r = await fetch("/api/portal/stores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); setBusy(null);
    if (!r.ok) { setMsg({ err: j.error?.issues?.[0]?.message ?? j.error?.message ?? "Could not connect" }); return; }
    setMsg({ ok: j.message }); setOpen(null); setF({ ...f, token: "", key: "", secret: "" }); router.refresh();
  }
  async function patch(id: string, set: Partial<Conn>) {
    setBusy(id);
    const r = await fetch("/api/portal/stores", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...set }) });
    setBusy(null); if (!r.ok) setMsg({ err: (await r.json()).error?.message ?? "Could not save" }); router.refresh();
  }
  async function sync(id: string) {
    setBusy(id); setMsg(null);
    const r = await fetch(`/api/portal/stores/${id}/sync`, { method: "POST" });
    const j = await r.json(); setBusy(null);
    setMsg(r.ok ? { ok: `Sync done: ${j.imported} imported, ${j.duplicate} already imported, ${j.skipped} skipped, ${j.error} with errors.` } : { err: j.error?.message ?? "Sync failed" });
    router.refresh();
  }
  async function disconnect(id: string) {
    if (!confirm("Disconnect this store? Saved credentials are deleted. Imported orders and history stay.")) return;
    await fetch(`/api/portal/stores?id=${encodeURIComponent(id)}`, { method: "DELETE" }); router.refresh();
  }

  return (
    <>
      <div className="grid3" style={{ gap: 12 }}>
        {STORES.map((s) => {
          const c = conns.find((x) => x.platform === s.key && x.status !== "disconnected");
          return (
            <article key={s.key} className="card" style={{ padding: 16 }}>
              <div className="row between"><b>{s.name}</b><span className={`chip ${c ? (c.status === "connected" ? "c-active" : "c-urgent") : "c-draft"}`}>{c ? c.status : s.key === "custom" ? "Via API" : "Not connected"}</span></div>
              <p className="tiny muted">{s.help}</p>
              {s.key === "custom" ? <a className="btn btn-sm btn-orange" href="/portal/integrations/?tab=api">Manage</a>
                : <button className="btn btn-sm btn-orange" onClick={() => { setOpen(s.key); setF({ ...f, storeUrl: c?.storeUrl ?? "" }); }}>{c ? "Update credentials" : "Connect"}</button>}
            </article>
          );
        })}
      </div>

      {open && (
        <form className="card mt12" style={{ padding: 18 }} onSubmit={connect}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Connect {open === "shopify" ? "Shopify" : "WooCommerce"}</h2>
          <div className="grid2" style={{ gap: 10 }}>
            <div className="field"><label htmlFor="su">{open === "shopify" ? "Store address (…myshopify.com)" : "Store URL (https)"}</label><input id="su" className="input" required value={f.storeUrl} onChange={(e) => setF({ ...f, storeUrl: e.target.value })} placeholder={open === "shopify" ? "yourstore.myshopify.com" : "https://yourstore.in"} /></div>
            <div className="field"><label htmlFor="sw">Ship imported orders from</label><select id="sw" className="select" value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></div>
            {open === "shopify"
              ? <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="st">Admin API access token</label><input id="st" className="input" type="password" autoComplete="off" required value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} placeholder="shpat_…" /></div>
              : <>
                <div className="field"><label htmlFor="sk">Consumer key</label><input id="sk" className="input" type="password" autoComplete="off" required value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="ck_…" /></div>
                <div className="field"><label htmlFor="ss">Consumer secret</label><input id="ss" className="input" type="password" autoComplete="off" required value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} placeholder="cs_…" /></div>
              </>}
          </div>
          <p className="tiny muted mt8">We test the connection before saving. Credentials are encrypted and can’t be viewed again.</p>
          <div className="row" style={{ gap: 8 }}><button className="btn btn-orange" disabled={busy === "connect"}>{busy === "connect" ? "Testing…" : "Test & connect"}</button><button type="button" className="btn btn-outline" onClick={() => setOpen(null)}>Cancel</button></div>
        </form>
      )}
      {msg?.ok && <p className="small t-credit mt8" role="status">{msg.ok}</p>}
      {msg?.err && <p className="small err mt8" role="alert">{msg.err}</p>}

      {conns.filter((c) => c.status !== "disconnected").map((c) => (
        <section key={c.id} className="card mt16" style={{ padding: 16 }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <div><b>{c.platform === "shopify" ? "Shopify" : "WooCommerce"}</b> · <span className="small mono">{c.storeUrl}</span> <span className="tiny muted">({c.hint})</span>
              <div className="tiny muted">Last sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString("en-IN") : "never"}{c.lastError ? ` · Error: ${c.lastError}` : ""}</div></div>
            <div className="row" style={{ gap: 6 }}><button className="btn btn-sm btn-orange" disabled={busy === c.id} onClick={() => sync(c.id)}>{busy === c.id ? "Syncing…" : "Sync now"}</button><button className="btn btn-sm btn-outline" onClick={() => disconnect(c.id)}>Disconnect</button></div>
          </div>
          <div className="grid4 mt12" style={{ gap: 10, alignItems: "end" }}>
            <div className="field"><label htmlFor={`w-${c.id}`}>Pickup address</label><select id={`w-${c.id}`} className="select" defaultValue={c.warehouseId ?? ""} onChange={(e) => patch(c.id, { warehouseId: e.target.value })}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></div>
            <label className="check small"><input type="checkbox" defaultChecked={c.autoSync} onChange={(e) => patch(c.id, { autoSync: e.target.checked })} /> Auto-sync every 15 min</label>
            <label className="check small"><input type="checkbox" defaultChecked={c.pushTracking} onChange={(e) => patch(c.id, { pushTracking: e.target.checked })} /> Send tracking back to store</label>
            <div className="tiny muted">Default box {c.defaultPackage.lengthCm}×{c.defaultPackage.breadthCm}×{c.defaultPackage.heightCm} cm, min {c.defaultPackage.weightKg} kg (used when the store has no dimensions)</div>
          </div>
          <h3 className="small b mt16">Import history</h3>
          {logs.filter((l) => l.connectionId === c.id).length === 0 ? <p className="tiny muted">No imports yet.</p> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Time</th><th>Store order</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>{logs.filter((l) => l.connectionId === c.id).map((l) => <tr key={l.id}><td className="small">{new Date(l.at).toLocaleString("en-IN")}</td><td className="small">{l.name}</td><td><span className={`chip ${l.outcome === "imported" ? "c-success" : l.outcome === "error" ? "c-urgent" : "c-draft"}`}>{l.outcome}</span></td><td className="small">{l.orderId ? <a className="link-navy" href={`/portal/orders/${l.orderId}/`}>View order</a> : null} {l.message}</td></tr>)}</tbody></table></div>
          )}
          {logs.some((l) => l.connectionId === c.id && l.outcome === "error") && <p className="tiny muted mt8">Fix the order in your store (e.g. add a phone number or PIN code) and click Sync now — already-imported orders are never duplicated.</p>}
        </section>
      ))}
    </>
  );
}
