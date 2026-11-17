"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { OTHERS, type OthersKind } from "@/lib/others";

type Row = { id: string; form: Record<string, string | number | boolean>; cells: Record<string, string> };

/** Add / edit / delete / search for one Others section. Field definitions come from lib/others. */
export function RecordManager({ kind, rows }: { kind: OthersKind; rows: Row[] }) {
  const def = OTHERS[kind];
  const [edit, setEdit] = useState<{ id: string | null; form: Record<string, string | number | boolean> } | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  const list = useMemo(() => rows.filter((r) => !q || Object.values(r.cells).join(" ").toLowerCase().includes(q.toLowerCase())), [rows, q]);
  async function save() {
    if (!edit) return;
    setBusy(true); setErr("");
    const r = await fetch(`/api/portal/others/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...edit.form, ...(edit.id ? { id: edit.id } : {}) }) });
    setBusy(false);
    if (r.ok) { setEdit(null); router.refresh(); } else setErr((await r.json().catch(() => ({}))).error?.message ?? "Could not save");
  }
  async function remove(id: string) {
    if (!confirm(`Delete this ${def.singular}?`)) return;
    const r = await fetch(`/api/portal/others/${kind}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (r.ok) router.refresh(); else setErr("Could not delete");
  }
  return (
    <>
      <div className="row wrap between mb12" style={{ gap: 8 }}>
        <label className="search" style={{ maxWidth: 320, flex: 1 }}><Search size={16} aria-hidden /><span className="sr-only">Search {def.title}</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${def.title.toLowerCase()}`} /></label>
        <button type="button" className="btn btn-orange" onClick={() => { setErr(""); setEdit({ id: null, form: kind === "tags" ? { color: "#0b1f3a" } : {} }); }}><Plus size={16} /> Add {def.singular}</button>
      </div>
      {err && <p className="small t-debit" role="alert">{err}</p>}
      {edit && (
        <section className="card mb12" style={{ padding: 16 }} aria-label={edit.id ? `Edit ${def.singular}` : `New ${def.singular}`}>
          <div className="grid3" style={{ gap: 10 }}>
            {def.fields.map((f) => {
              const [key, label, type] = f as readonly [string, string, string?];
              const val = edit.form[key];
              const on = (x: string | boolean) => setEdit({ ...edit, form: { ...edit.form, [key]: x } });
              if (type === "checkbox") return <label key={key} className="check small" style={{ alignSelf: "end" }}><input type="checkbox" checked={!!val} onChange={(e) => on(e.target.checked)} /> {label}</label>;
              return <div key={key} className="field"><label htmlFor={`rm-${key}`}>{label}</label><input id={`rm-${key}`} className="input" type={type === "number" ? "number" : type === "color" ? "color" : "text"} step={type === "number" ? "0.01" : undefined} min={type === "number" ? 0 : undefined} value={String(val ?? "")} onChange={(e) => on(e.target.value)} style={type === "color" ? { height: 40 } : undefined} /></div>;
            })}
          </div>
          <div className="row mt12" style={{ gap: 8 }}><button type="button" className="btn btn-orange" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button><button type="button" className="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button></div>
        </section>
      )}
      {list.length === 0 ? <div className="card empty"><p className="muted">{rows.length ? "No matches." : `No ${def.title.toLowerCase()} yet.`}</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr>{def.columns.map(([k, l]) => <th key={k}>{l}</th>)}<th /></tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id}>
              {def.columns.map(([k]) => <td key={k} className="small">{kind === "tags" && k === "name" ? <span className="chip" style={{ background: String(r.form.color), color: "#fff" }}>{r.cells[k]}</span> : r.cells[k]}</td>)}
              <td><span className="row" style={{ gap: 6 }}><button type="button" className="icon-btn" aria-label={`Edit ${r.cells.name}`} onClick={() => { setErr(""); setEdit({ id: r.id, form: r.form }); }}><Pencil size={15} /></button><button type="button" className="icon-btn" aria-label={`Delete ${r.cells.name}`} onClick={() => remove(r.id)}><Trash2 size={15} /></button></span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
