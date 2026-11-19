"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Field = { key: string; label: string; secret: boolean; required: boolean; placeholder?: string; help?: string; value: string; hint: string | null };
export type ServiceView = {
  adapter: string; group: string; name: string; purpose: string; guide: string[]; links: Array<{ label: string; url: string }>;
  info: Array<{ label: string; value: string }>; fields: Field[]; saved: boolean; on: boolean;
  lastTest: { ok: boolean; message: string; at: string } | null;
};

/** One card per service: status, where to get the keys, the key form, Test connection and ON/OFF. */
export function ServicesHub({ services, write }: { services: ServiceView[]; write: boolean }) {
  return (
    <div className="svc-grid">
      {services.map((s) => <ServiceCard key={s.adapter} s={s} write={write} />)}
    </div>
  );
}

function state(s: ServiceView) {
  if (s.on) return { cls: "c-active", text: "ON — working" };
  if (!s.saved) return { cls: "c-draft", text: "Not set up" };
  if (s.lastTest?.ok) return { cls: "c-pending", text: "Tested — turn ON" };
  if (s.lastTest) return { cls: "c-failed", text: "Test failed" };
  return { cls: "c-pending", text: "Saved — test it" };
}

function ServiceCard({ s, write }: { s: ServiceView; write: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(!s.saved);
  const [copied, setCopied] = useState("");
  async function call(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ adapter: s.adapter, ...body }) });
      const j = await r.json().catch(() => ({}));
      setMsg({ ok: r.ok, text: j.message ?? j.error?.message ?? (r.ok ? "Done" : "Failed") });
      router.refresh();
      return r.ok;
    } finally { setBusy(false); }
  }
  const st = state(s);
  const ro = !write || busy;
  return (
    <section className="card svc-card" aria-labelledby={`h-${s.adapter}`}>
      <div className="row between" style={{ gap: 8, alignItems: "start" }}>
        <div><span className="tiny muted">{s.group}</span><h2 id={`h-${s.adapter}`}>{s.name}</h2></div>
        <span className={`chip ${st.cls}`}>{st.text}</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{s.purpose}</p>
      {s.lastTest && <p className={`small ${s.lastTest.ok ? "t-credit" : "t-debit"}`} style={{ margin: 0 }}>Last test: {s.lastTest.ok ? "✓" : "✗"} {s.lastTest.message}</p>}

      <details className="svc-guide" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>How to get these keys (step by step)</summary>
        <ol>{s.guide.map((g, i) => <li key={i}>{g}</li>)}</ol>
        <p className="small">{s.links.map((l) => <a key={l.url} className="link" href={l.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 12 }}>{l.label} ↗</a>)}</p>
      </details>

      {s.info.length > 0 && (
        <div className="svc-info">
          {s.info.map((i) => (
            <div key={i.label} className="svc-copy">
              <span className="tiny muted">{i.label}</span>
              <div className="row" style={{ gap: 6 }}>
                <code>{i.value}</code>
                {!i.value.startsWith("the ") && <button type="button" className="btn btn-sm" onClick={() => { void navigator.clipboard?.writeText(i.value); setCopied(i.label); setTimeout(() => setCopied(""), 1500); }}>{copied === i.label ? "Copied" : "Copy"}</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="svc-form" onSubmit={async (e) => {
        e.preventDefault();
        const el = e.currentTarget; const fd = new FormData(el);
        const values = Object.fromEntries(s.fields.map((f) => [f.key, String(fd.get(f.key) ?? "")]));
        if (await call({ op: "save", values })) s.fields.filter((f) => f.secret).forEach((f) => { const i = el.elements.namedItem(f.key) as HTMLInputElement | null; if (i) i.value = ""; });
      }}>
        {s.fields.map((f) => (
          <div key={f.key} className="field">
            <label htmlFor={`${s.adapter}-${f.key}`}>{f.label}{f.required && <span className="req"> *</span>}</label>
            <input id={`${s.adapter}-${f.key}`} name={f.key} className="input" type={f.secret ? "password" : "text"} autoComplete="off" spellCheck={false} disabled={ro}
              defaultValue={f.secret ? "" : f.value} placeholder={f.secret ? (f.hint ? `Saved (${f.hint}) — leave blank to keep` : f.placeholder ?? "") : f.placeholder ?? ""} />
            {f.help && <span className="tiny muted">{f.help}</span>}
          </div>
        ))}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-orange" disabled={ro}>Save keys</button>
          <button type="button" className="btn" disabled={ro || !s.saved} onClick={() => void call({ op: "test" })}>Test connection</button>
          {s.on
            ? <button type="button" className="btn btn-red" disabled={ro} onClick={() => void call({ op: "on", on: false })}>Turn OFF</button>
            : <button type="button" className="btn btn-green" disabled={ro || !s.lastTest?.ok} title={!s.lastTest?.ok ? "Test connection first" : undefined} onClick={() => void call({ op: "on", on: true })}>Turn ON</button>}
        </div>
        {msg && <p className={`small ${msg.ok ? "t-credit" : "t-debit"}`} role="status" style={{ margin: 0 }}>{msg.text}</p>}
        {!write && <p className="tiny muted">View only — changing keys needs the Integrations write permission.</p>}
      </form>
    </section>
  );
}
