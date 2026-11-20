"use client";
import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Msg, api } from "./ui";

type Domain = {
  id: string; hostname: string; status: string; sslStatus: string; isPrimary: boolean; lastCheckedAt: string | null; lastCheckMessage: string | null;
  records: Array<{ type: string; name: string; value: string; purpose: string }>;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_dns: { label: "Waiting for DNS", cls: "c-draft" }, verified: { label: "Verified", cls: "c-active" }, failed: { label: "DNS record missing", cls: "c-cancelled" },
};
const SSL: Record<string, { label: string; cls: string; help: string }> = {
  pending_setup: { label: "SSL: not started", cls: "c-draft", help: "Vishwaship switches on SSL for custom domains once your DNS is verified. Your free store link keeps working meanwhile." },
  pending: { label: "SSL: issuing", cls: "c-draft", help: "The certificate is being issued. This usually takes a few minutes." },
  active: { label: "SSL: active", cls: "c-active", help: "Your domain is live with HTTPS." },
  failed: { label: "SSL: failed", cls: "c-cancelled", help: "We could not issue a certificate. Check the DNS records, then contact support." },
};

export function DomainsManager({ domains, defaultUrl, max }: { domains: Domain[]; defaultUrl: string; max: number }) {
  const router = useRouter();
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add"); setMsg(null);
    const r = await api("POST", "/api/portal/store/domains", { hostname: host });
    setBusy(null);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setHost(""); setMsg({ ok: "Domain added. Add the DNS records below at your domain provider, then click Check." }); router.refresh();
  }
  async function act(id: string, action: "check" | "primary" | "disconnect", hostname: string) {
    if (action === "disconnect" && !confirm(`Disconnect ${hostname}? Buyers on this domain won't reach your store.`)) return;
    setBusy(id + action); setMsg(null);
    const r = await api<{ message?: string }>("PATCH", "/api/portal/store/domains", { id, action });
    setBusy(null);
    if (!r.ok) setMsg({ err: r.error });
    else setMsg({ ok: action === "check" ? r.data.message ?? "Checked" : action === "primary" ? `${hostname} is now your primary domain.` : `${hostname} disconnected.` });
    router.refresh();
  }
  const copy = (v: string) => navigator.clipboard?.writeText(v).catch(() => {});

  return (
    <>
      <div className="card mb12" style={{ padding: 16 }}>
        <div className="small muted">Your free store link (always works)</div>
        <a href={defaultUrl} target="_blank" rel="noopener" style={{ fontWeight: 600, color: "var(--navy)" }}>{defaultUrl}</a>
      </div>
      <form className="card mb12" style={{ padding: 16 }} onSubmit={add}>
        <div className="field"><label htmlFor="dom">Connect your own domain</label>
          <div className="row" style={{ gap: 8 }}>
            <input id="dom" className="input" placeholder="shop.yourbrand.com" value={host} onChange={(e) => setHost(e.target.value)} style={{ flex: 1, minWidth: 0 }} maxLength={253} />
            <button className="btn btn-orange" disabled={!host.trim() || busy === "add" || domains.length >= max}>{busy === "add" ? "Adding…" : "Add domain"}</button>
          </div>
          <span className="small muted">Buy a domain from any provider (GoDaddy, Hostinger, Namecheap…). A sub-domain like shop.yourbrand.com is easiest to set up. Up to {max} domains.</span>
        </div>
        <Msg m={msg} />
      </form>
      {domains.map((d) => (
        <div className="card mb12" style={{ padding: 16 }} key={d.id}>
          <div className="row between wrap" style={{ gap: 8, alignItems: "center" }}>
            <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
              <b style={{ fontSize: 15 }}>{d.hostname}</b>
              {d.isPrimary && <span className="chip c-active">Primary</span>}
              <span className={`chip ${STATUS[d.status]?.cls ?? "c-draft"}`}>{STATUS[d.status]?.label ?? d.status}</span>
              <span className={`chip ${SSL[d.sslStatus]?.cls ?? "c-draft"}`}>{SSL[d.sslStatus]?.label ?? d.sslStatus}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-outline btn-sm" onClick={() => act(d.id, "check", d.hostname)} disabled={!!busy}>{busy === d.id + "check" ? "Checking…" : "Check DNS"}</button>
              {!d.isPrimary && d.status === "verified" && <button className="btn btn-outline btn-sm" onClick={() => act(d.id, "primary", d.hostname)} disabled={!!busy}>Make primary</button>}
              <button className="btn btn-outline btn-sm" onClick={() => act(d.id, "disconnect", d.hostname)} disabled={!!busy}>Disconnect</button>
            </div>
          </div>
          {d.lastCheckMessage && <p className="small" style={{ margin: "8px 0 0" }}>{d.lastCheckMessage} <span className="tiny muted">{d.lastCheckedAt ? `(checked ${new Date(d.lastCheckedAt).toLocaleString("en-IN")})` : ""}</span></p>}
          <p className="small muted" style={{ margin: "6px 0 10px" }}>{SSL[d.sslStatus]?.help}</p>
          <div style={{ overflowX: "auto" }}>
            <table className="os-dns">
              <thead><tr><th>Type</th><th>Name / Host</th><th>Value</th><th>Why</th></tr></thead>
              <tbody>{d.records.map((r) => (
                <tr key={r.type}>
                  <td><b>{r.type}</b></td>
                  <td><code>{r.name}</code> <button className="os-ic" onClick={() => copy(r.name)} aria-label={`Copy ${r.type} name`}><Copy size={12} /></button></td>
                  <td><code>{r.value}</code> <button className="os-ic" onClick={() => copy(r.value)} aria-label={`Copy ${r.type} value`}><Copy size={12} /></button></td>
                  <td className="small muted">{r.purpose}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
