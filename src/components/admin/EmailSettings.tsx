"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Sender = { id: string; email: string; displayName: string; replyTo: string | null; isDefault: boolean; status: string; statusDetail: string | null; checkedAt: string | null; usedBy: string[] };
type Rule = { event: string; label: string; audience: string; enabled: boolean; senderId: string | null; toClient: boolean; toRecipient: boolean };
type Tpl = { event: string; label: string; subject: string; body: string; custom: boolean; placeholders: string[] };
type Log = { id: string; event: string; label: string; toEmail: string; toKind: string; senderEmail: string; subject: string; status: string; error: string | null; attempts: number; retryable: boolean; at: string };
export type EmailSettingsData = {
  write: boolean; auth: { googleEnabled: boolean; otpValidityMin: number; otpCooldownSec: number; otpMaxAttempts: number };
  googleConfigured: boolean; redirectUri: string; providerConfigured: boolean;
  senders: Sender[]; rules: Rule[]; templates: Tpl[]; logs: Log[];
};

const TABS = [["signin", "Signup & Login"], ["otp", "OTP Settings"], ["senders", "Sender Emails"], ["rules", "Email Rules"], ["templates", "Templates"], ["logs", "Email Logs"]] as const;
const chip = (s: string) => (s === "verified" || s === "sent" ? "c-active" : s === "failed" ? "c-failed" : s === "disabled" ? "c-cancelled" : "c-pending");

/** Admin → Settings → Email & Sign-in. All changes go through /api/admin/email (permission-checked and audited). */
export function EmailSettings({ d }: { d: EmailSettingsData }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("signin");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function call(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      setMsg({ ok: r.ok, text: j.message ?? j.error?.message ?? (r.ok ? "Done" : "Failed") });
      router.refresh(); // failures are logged too (Email Logs), so always reload the data
      return r.ok ? j : null;
    } finally { setBusy(false); }
  }
  const ro = !d.write || busy;
  const verified = d.senders.filter((s) => s.status === "verified");
  const otpRule = d.rules.find((r) => r.event === "signup_otp")!;

  return (
    <div className="em-set">
      <div className="pills" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "pill on" : "pill"} onClick={() => { setTab(k); setMsg(null); }}>{l}</button>)}
      </div>
      {!d.write && <p className="note small">You can view these settings. Changing them needs the Notifications write permission.</p>}
      {msg && <p className={`note small ${msg.ok ? "" : "t-debit"}`} role="status">{msg.text}</p>}

      {tab === "signin" && (
        <form className="card em-card" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void call({ op: "auth_settings", ...d.auth, googleEnabled: f.get("google") === "on" }); }}>
          <h2>Signup &amp; Login</h2>
          <label className="em-check"><input type="checkbox" name="google" defaultChecked={d.auth.googleEnabled} disabled={ro} /> Show <b>Continue with Google</b> on the login and signup pages</label>
          <p className="small muted">Google sign-in status: {d.googleConfigured ? <span className="chip c-active">Configured</span> : <span className="chip c-pending">Not configured on the server</span>}. Redirect URI to add in Google Cloud → OAuth client: <span className="mono">{d.redirectUri}</span></p>
          {!d.googleConfigured && <p className="small muted">Until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on the server, the Google button stays hidden even when switched on.</p>}
          <label className="em-check"><input type="checkbox" checked readOnly disabled /> Email OTP verification is mandatory for email signup (always on)</label>
          <div><button className="btn btn-orange" disabled={ro}>Save</button></div>
        </form>
      )}

      {tab === "otp" && (
        <div className="em-grid">
          <form className="card em-card" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void call({ op: "auth_settings", googleEnabled: d.auth.googleEnabled, otpValidityMin: f.get("v"), otpCooldownSec: f.get("c"), otpMaxAttempts: f.get("a") }); }}>
            <h2>OTP rules</h2>
            <div className="grid3">
              <div className="field"><label htmlFor="v">Validity (minutes)</label><input id="v" name="v" type="number" min={1} max={30} className="input" defaultValue={d.auth.otpValidityMin} disabled={ro} /></div>
              <div className="field"><label htmlFor="c">Resend cooldown (seconds)</label><input id="c" name="c" type="number" min={15} max={600} className="input" defaultValue={d.auth.otpCooldownSec} disabled={ro} /></div>
              <div className="field"><label htmlFor="a">Wrong attempts allowed</label><input id="a" name="a" type="number" min={1} max={10} className="input" defaultValue={d.auth.otpMaxAttempts} disabled={ro} /></div>
            </div>
            <p className="tiny muted">A code works once. Sending a new code cancels the previous one. These limits are enforced on the server.</p>
            <div><button className="btn btn-orange" disabled={ro}>Save OTP rules</button></div>
          </form>
          <RuleForm r={otpRule} senders={d.senders} verified={verified} ro={ro} call={call} title="OTP sender" />
          <p className="small muted">Edit the OTP email text in <button type="button" className="link" onClick={() => setTab("templates")}>Templates</button>.</p>
        </div>
      )}

      {tab === "senders" && (
        <div className="em-grid">
          {!d.providerConfigured && <p className="note small">Email provider is not configured on the server (RESEND_API_KEY). {process.env.NODE_ENV === "production" ? "Emails will fail and appear in Email Logs until it is set." : "Development: emails go to a local outbox and verification is simulated."}</p>}
          <div className="table-wrap card"><table className="table">
            <thead><tr><th>Sender</th><th>Reply-to</th><th>Status</th><th>Used by</th><th></th></tr></thead>
            <tbody>{d.senders.map((s) => <SenderRow key={s.id} s={s} all={d.senders} ro={ro} call={call} />)}</tbody>
          </table></div>
          <form className="card em-card" onSubmit={async (e) => { e.preventDefault(); const el = e.currentTarget; const f = new FormData(el); if (await call({ op: "sender_add", email: f.get("email"), displayName: f.get("name"), replyTo: f.get("reply") })) el.reset(); }}>
            <h2>Add sender email</h2>
            <div className="grid3">
              <div className="field"><label htmlFor="se">Sender email</label><input id="se" name="email" type="email" className="input" placeholder="support@vishwaship.in" required disabled={ro} /></div>
              <div className="field"><label htmlFor="sn">Display name</label><input id="sn" name="name" className="input" placeholder="Vishwaship Support" required disabled={ro} /></div>
              <div className="field"><label htmlFor="sr">Reply-to (optional)</label><input id="sr" name="reply" type="email" className="input" disabled={ro} /></div>
            </div>
            <p className="tiny muted">A sender can be used only after its domain is verified at the email provider (SPF/DKIM DNS records). Until then it shows Pending.</p>
            <div><button className="btn btn-orange" disabled={ro}>Add sender</button></div>
          </form>
        </div>
      )}

      {tab === "rules" && (
        <div className="em-grid">
          {d.rules.filter((r) => r.audience === "shipment").map((r) => <RuleForm key={r.event} r={r} senders={d.senders} verified={verified} ro={ro} call={call} title={r.label} recipients />)}
          <p className="tiny muted">Shipment emails are sent only when confirmed courier tracking reaches that status (not when a pickup is requested or scheduled). Each shipment + event + address is emailed once. A failed email never affects the shipment.</p>
        </div>
      )}

      {tab === "templates" && <Templates tpls={d.templates} ro={ro} call={call} />}

      {tab === "logs" && (
        <div className="table-wrap card"><table className="table">
          <thead><tr><th>Time</th><th>Event</th><th>Recipient</th><th>Sender</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {d.logs.length === 0 && <tr><td colSpan={6} className="small muted">No emails yet.</td></tr>}
            {d.logs.map((l) => (
              <tr key={l.id}>
                <td className="small nowrap">{l.at}</td>
                <td className="small">{l.label}<div className="tiny muted">{l.subject}</div></td>
                <td className="small">{l.toEmail}<div className="tiny muted">{l.toKind === "client" ? "Vishwaship Client" : l.toKind === "recipient" ? "Delivery recipient" : l.toKind === "signup" ? "Signup" : "Test"}</div></td>
                <td className="small">{l.senderEmail}</td>
                <td className="small"><span className={`chip ${chip(l.status)}`}>{l.status}</span>{l.attempts > 1 && <span className="tiny muted"> · {l.attempts} tries</span>}{l.error && <div className="tiny t-debit">{l.error}</div>}</td>
                <td>{l.status === "failed" && (l.retryable ? <button type="button" className="btn btn-sm" disabled={ro} onClick={() => void call({ op: "log_retry", id: l.id })}>Retry</button> : <span className="tiny muted">One-time code — not re-sent</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function SenderRow({ s, all, ro, call }: { s: Sender; all: Sender[]; ro: boolean; call: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [rep, setRep] = useState("");
  const needsRep = s.isDefault || s.usedBy.length > 0;
  const options = all.filter((x) => x.id !== s.id && x.status === "verified");
  return (
    <tr>
      <td className="small"><b>{s.displayName}</b> {s.isDefault && <span className="chip c-active">Default</span>}<div className="mono tiny">{s.email}</div></td>
      <td className="small">{s.replyTo ?? "—"}</td>
      <td className="small"><span className={`chip ${chip(s.status)}`}>{s.status}</span>{s.statusDetail && <div className="tiny muted" style={{ maxWidth: 260 }}>{s.statusDetail}</div>}</td>
      <td className="small">{s.usedBy.length ? s.usedBy.join(", ") : <span className="muted">—</span>}</td>
      <td className="small">
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm" disabled={ro} onClick={() => void call({ op: "sender_check", id: s.id })}>Check verification</button>
          {!s.isDefault && s.status === "verified" && <button type="button" className="btn btn-sm" disabled={ro} onClick={() => void call({ op: "sender_default", id: s.id })}>Make default</button>}
          {s.status === "disabled"
            ? <button type="button" className="btn btn-sm" disabled={ro} onClick={() => void call({ op: "sender_enable", id: s.id })}>Enable</button>
            : <>
                {needsRep && <select className="select" aria-label={`Replacement for ${s.email}`} value={rep} onChange={(e) => setRep(e.target.value)} disabled={ro} style={{ maxWidth: 200 }}>
                  <option value="">Replacement sender…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.email}</option>)}</select>}
                <button type="button" className="btn btn-sm btn-danger" disabled={ro || (needsRep && !rep)} title={needsRep && !rep ? "Choose a replacement sender first" : undefined}
                  onClick={() => void call({ op: "sender_disable", id: s.id, replacementId: rep || undefined })}>Disable</button>
              </>}
        </div>
      </td>
    </tr>
  );
}

function RuleForm({ r, senders, verified, ro, call, title, recipients }: { r: Rule; senders: Sender[]; verified: Sender[]; ro: boolean; call: (b: Record<string, unknown>) => Promise<unknown>; title: string; recipients?: boolean }) {
  const def = senders.find((s) => s.isDefault);
  return (
    <form className="card em-card" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
      void call({ op: "rule_save", event: r.event, enabled: r.event === "signup_otp" ? true : f.get("on") === "on", senderId: (f.get("sender") as string) || null, toClient: r.event === "signup_otp" ? true : f.get("client") === "on", toRecipient: f.get("recipient") === "on" }); }}>
      <div className="row between"><h2>{title}</h2>{r.event !== "signup_otp" && <label className="em-check"><input type="checkbox" name="on" defaultChecked={r.enabled} disabled={ro} /> ON</label>}</div>
      <div className="field"><label htmlFor={`snd-${r.event}`}>Sender</label>
        <select id={`snd-${r.event}`} name="sender" className="select" defaultValue={r.senderId ?? ""} disabled={ro}>
          <option value="">Default sender{def ? ` (${def.email})` : ""}</option>
          {verified.filter((s) => !s.isDefault).map((s) => <option key={s.id} value={s.id}>{s.displayName} — {s.email}</option>)}
        </select></div>
      {recipients && <>
        <label className="em-check"><input type="checkbox" name="client" defaultChecked={r.toClient} disabled={ro} /> Send to Vishwaship Client (account email)</label>
        <label className="em-check"><input type="checkbox" name="recipient" defaultChecked={r.toRecipient} disabled={ro} /> Send to Delivery Recipient (when Recipient Email is given)</label>
      </>}
      <div><button className="btn btn-orange btn-sm" disabled={ro}>Save</button></div>
    </form>
  );
}

function Templates({ tpls, ro, call }: { tpls: Tpl[]; ro: boolean; call: (b: Record<string, unknown>) => Promise<unknown> }) {
  const [ev, setEv] = useState(tpls[0].event);
  const t = tpls.find((x) => x.event === ev)!;
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [to, setTo] = useState("");
  function pick(k: string) { const n = tpls.find((x) => x.event === k)!; setEv(k); setSubject(n.subject); setBody(n.body); setPreview(null); }
  async function doPreview() {
    const r = await fetch("/api/admin/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "template_preview", event: ev, subject, body }) });
    const j = await r.json().catch(() => null); if (r.ok && j) setPreview({ subject: j.subject, html: j.html });
  }
  return (
    <div className="em-grid">
      <div className="card em-card">
        <div className="field"><label htmlFor="tev">Email</label>
          <select id="tev" className="select" value={ev} onChange={(e) => pick(e.target.value)}>{tpls.map((x) => <option key={x.event} value={x.event}>{x.label}{x.custom ? " (edited)" : ""}</option>)}</select></div>
        <div className="field"><label htmlFor="tsub">Subject</label><input id="tsub" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={ro} /></div>
        <div className="field"><label htmlFor="tbody">Message</label><textarea id="tbody" className="input" rows={12} value={body} onChange={(e) => setBody(e.target.value)} disabled={ro} /></div>
        <p className="tiny muted">Placeholders: {t.placeholders.map((p) => <code key={p} className="em-ph">{`{{${p}}}`}</code>)}</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-orange" disabled={ro} onClick={() => void call({ op: "template_save", event: ev, subject, body })}>Save template</button>
          <button type="button" className="btn" onClick={() => void doPreview()}>Preview</button>
          {t.custom && <button type="button" className="btn" disabled={ro} onClick={() => void call({ op: "template_reset", event: ev })}>Reset to default</button>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <input className="input" type="email" placeholder="test@yourcompany.com" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Test email address" style={{ maxWidth: 260 }} disabled={ro} />
          <button type="button" className="btn" disabled={ro || !to} onClick={() => void call({ op: "template_test", event: ev, to, subject, body })}>Send test email</button>
        </div>
        <p className="tiny muted">Previews and test emails use sample values (sample code 123456) — never a real OTP or customer data.</p>
      </div>
      {preview && (
        <div className="card em-card">
          <p className="small"><b>Subject:</b> {preview.subject}</p>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="em-preview" />
        </div>
      )}
    </div>
  );
}
