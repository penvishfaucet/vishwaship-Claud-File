"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Ev = { key: string; label: string; enabled: boolean; updatedAt: string | null };

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={on ? "vs-switch on" : "vs-switch"} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

const SAMPLE = {
  event_id: "evt_01HZX…", type: "shipment.status_changed", version: "2026-11-01", created_at: "2026-11-17T10:00:00+05:30",
  data: { order_id: "VSA1001", reference_id: "ord_…", awb: "DEMO1234567890", carrier: "Delhivery", status: "out_for_delivery", shipment_type: "B2C", eta: "2026-11-18", scans: [{ status: "in_transit", location: "Pune hub", at: "2026-11-17T06:10:00+05:30" }] },
};

export function NotificationTab({ channel, master, events, webhookUrl }: { channel: string; master: boolean; events: Ev[]; webhookUrl: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState(webhookUrl);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);

  async function toggle(event: string, enabled: boolean) {
    setBusy(event); setMsg(null);
    const r = await fetch("/api/portal/notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, event, enabled }) });
    setBusy(null);
    if (!r.ok) setMsg({ err: (await r.json()).error?.message ?? "Could not save" });
    router.refresh();
  }
  async function saveWebhook(test = false) {
    setBusy("webhook"); setMsg(null);
    const r = await fetch("/api/portal/webhooks", { method: test ? "PATCH" : "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const j = await r.json(); setBusy(null);
    setMsg(r.ok ? { ok: j.message } : { err: j.error?.message ?? "Failed" });
    if (r.ok && j.secret) setMsg({ ok: `${j.message} Signing secret (shown once): ${j.secret}` });
    router.refresh();
  }

  return (
    <>
      {channel === "webhook" && (
        <section className="card mb12" style={{ padding: 16 }}>
          <form className="row wrap" style={{ gap: 8, alignItems: "end" }} onSubmit={(e) => { e.preventDefault(); saveWebhook(); }}>
            <div className="field" style={{ flex: 1, minWidth: 260 }}><label htmlFor="whu">Endpoint URL (https)</label><input id="whu" className="input" type="url" required placeholder="https://yourstore.com/webhooks/vishwaship" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
            <button className="btn btn-orange" disabled={busy === "webhook"}>Save</button>
            <button type="button" className="btn btn-outline" disabled={busy === "webhook" || !webhookUrl} onClick={() => saveWebhook(true)}>Send Test</button>
          </form>
          <p className="tiny muted mt8">Each delivery carries <span className="mono">X-Vishwaship-Event-Id</span>, <span className="mono">X-Vishwaship-Timestamp</span> and <span className="mono">X-Vishwaship-Signature</span> = HMAC-SHA256(secret, timestamp + "." + body). Reject timestamps older than 5 minutes.</p>
        </section>
      )}
      <section className="card" style={{ padding: 16 }}>
        <div className="row between mb12">
          <div><b>{channel === "webhook" ? "Webhook events" : `${channel.toUpperCase()} notifications to buyers`}</b><div className="tiny muted">{channel === "sms" || channel === "whatsapp" ? "1 credit per message accepted by the provider." : channel === "email" ? "Free." : "Free."}</div></div>
          <Switch on={master} label="Master switch" onChange={(v) => toggle("*", v)} disabled={busy !== null} />
        </div>
        <div className="tbl-wrap only-desktop">
          <table className="tbl">
            <thead><tr><th>Event</th><th>Enable</th><th>Template</th><th>Updated at</th><th>Actions</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.key}>
                  <td>{e.label}</td>
                  <td><Switch on={e.enabled} label={`${e.label} ${channel}`} onChange={(v) => toggle(e.key, v)} disabled={!master || busy !== null} /></td>
                  <td className="small muted">{channel === "webhook" ? "JSON v2026-11-01" : "Default (approved)"}</td>
                  <td className="small">{e.updatedAt ? new Date(e.updatedAt).toLocaleDateString("en-IN") : "—"}</td>
                  <td><button className="btn btn-sm btn-outline" type="button" onClick={() => setMsg({ ok: `Preview: Hi, your order VSA1001 is now "${e.label}". Track: https://vishwaship.com/track/?awb=DEMO…` })}>Preview</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="plain-list only-mobile">
          {events.map((e) => <li key={e.key} className="row between">{e.label}<Switch on={e.enabled} label={`${e.label} ${channel}`} onChange={(v) => toggle(e.key, v)} disabled={!master || busy !== null} /></li>)}
        </ul>
        {!master && <p className="tiny muted mt8">Turn on the master switch to enable individual events.</p>}
      </section>
      {msg?.ok && <p className="small mt8 t-credit" role="status" style={{ wordBreak: "break-all" }}>{msg.ok}</p>}
      {msg?.err && <p className="small mt8 err" role="alert">{msg.err}</p>}
      {channel === "webhook" && (
        <section className="card mt12" style={{ padding: 16 }}>
          <h2 className="b small" style={{ marginTop: 0 }}>Sample payload</h2>
          <pre className="mono tiny" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(SAMPLE, null, 2)}</pre>
        </section>
      )}
    </>
  );
}
