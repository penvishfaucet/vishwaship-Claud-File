"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type OpField =
  | { name: string; label: string; type?: "text" | "number" | "date" | "email" | "textarea" | "tel" | "datetime-local"; value?: string | number; step?: string; placeholder?: string; wide?: boolean; required?: boolean }
  | { name: string; label: string; type: "select"; value?: string; options: Array<[string, string]>; wide?: boolean }
  | { name: string; label: string; type: "checkbox"; value?: boolean; wide?: boolean }
  | { name: string; label: string; type: "hidden"; value: string };

/** One admin action form → POST /api/admin/commercial {op, ...fields}. Shows the server's message and refreshes. */
export function AdminOpForm({ op, fields, submit, confirmText, disabled, extra, endpoint = "/api/admin/commercial", resetOnSuccess }: { op: string; fields: OpField[]; submit: string; confirmText?: string; disabled?: boolean; extra?: Record<string, unknown>; endpoint?: string; resetOnSuccess?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <form className="row wrap" style={{ gap: 8, alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (confirmText && !confirm(confirmText)) return;
      const form = e.currentTarget;
      const fd = new FormData(form);
      const body: Record<string, unknown> = { op, ...extra };
      for (const f of fields) body[f.name] = f.type === "checkbox" ? fd.get(f.name) === "on" : fd.get(f.name) ?? "";
      setBusy(true); setMsg(null);
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      setMsg(r.ok ? { ok: true, text: j.message ?? "Saved" } : { ok: false, text: j.error?.message ?? "Failed" });
      if (r.ok) { if (resetOnSuccess) form.reset(); router.refresh(); }
    }}>
      {fields.map((f) => {
        const id = `${op}-${f.name}-${String(f.value ?? "").slice(0, 8)}`;
        if (f.type === "hidden") return <input key={f.name} type="hidden" name={f.name} value={f.value} />;
        if (f.type === "checkbox") return <label key={f.name} className="check small" style={f.wide ? { flexBasis: "100%" } : undefined}><input type="checkbox" name={f.name} defaultChecked={!!f.value} disabled={disabled} /> {f.label}</label>;
        if (f.type === "select") return <div key={f.name} className="field" style={f.wide ? { flexBasis: "100%" } : undefined}><label htmlFor={id}>{f.label}</label><select id={id} name={f.name} className="select" defaultValue={f.value} disabled={disabled}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>;
        if (f.type === "textarea") return <div key={f.name} className="field" style={{ flexBasis: "100%" }}><label htmlFor={id}>{f.label}</label><textarea id={id} name={f.name} className="input" rows={2} defaultValue={f.value} placeholder={f.placeholder} disabled={disabled} /></div>;
        return <div key={f.name} className="field" style={f.wide ? { flex: 1, minWidth: 220 } : undefined}><label htmlFor={id}>{f.label}</label><input id={id} name={f.name} type={f.type ?? "text"} step={f.step} className="input" defaultValue={f.value} placeholder={f.placeholder} disabled={disabled} required={f.required} inputMode={f.type === "tel" ? "tel" : undefined} /></div>;
      })}
      {!disabled && <button className="btn btn-orange btn-sm" disabled={busy}>{busy ? "Working…" : submit}</button>}
      {msg && <span className={`small ${msg.ok ? "t-credit" : "t-debit"}`} role="status" style={{ flexBasis: "100%" }}>{msg.text}</span>}
    </form>
  );
}
