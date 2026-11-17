"use client";
import Link from "next/link";
import { useState } from "react";

export function OrderTagsEditor({ orderId, all, initial }: { orderId: string; all: Array<{ id: string; name: string; color: string }>; initial: string[] }) {
  const [sel, setSel] = useState(initial);
  const [state, setState] = useState<"" | "saving" | "saved" | "error">("");
  async function toggle(id: string) {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next); setState("saving");
    const r = await fetch(`/api/portal/orders/${orderId}/tags`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tagIds: next }) });
    setState(r.ok ? "saved" : "error");
  }
  if (!all.length) return <p className="tiny muted" style={{ margin: 0 }}>No tags yet. <Link className="link" href="/portal/others/tags/">Create tags</Link></p>;
  return (
    <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
      {all.map((t) => { const on = sel.includes(t.id); return <button key={t.id} type="button" className="chip" aria-pressed={on} onClick={() => toggle(t.id)} style={{ background: on ? t.color : "transparent", color: on ? "#fff" : t.color, border: `1px solid ${t.color}`, cursor: "pointer" }}>{t.name}</button>; })}
      <span className="tiny muted" role="status">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Could not save" : ""}</span>
    </div>
  );
}
