"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Msg, api } from "./ui";

export type SaleView = { id: string; name: string; percentOff: number; scope: string; categoryIds: string[]; productIds: string[]; startsAt: string; endsAt: string; bannerText: string | null; active: boolean };
type Opt = { id: string; name: string };

const local = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const toIso = (v: string) => new Date(v).toISOString();
const when = (s: string) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function SalesManager({ sales, categories, products }: { sales: SaleView[]; categories: Opt[]; products: Opt[] }) {
  const router = useRouter();
  const now = Date.now();
  const blank = { name: "", percentOff: "20", scope: "all", categoryIds: [] as string[], productIds: [] as string[], startsAt: local(new Date().toISOString()), endsAt: local(new Date(now + 3 * 86400_000).toISOString()), bannerText: "", active: true };
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  function open(s?: SaleView) {
    setMsg(null);
    if (!s) { setEdit("new"); setF(blank); return; }
    setEdit(s.id);
    setF({ name: s.name, percentOff: String(s.percentOff), scope: s.scope, categoryIds: s.categoryIds, productIds: s.productIds, startsAt: local(s.startsAt), endsAt: local(s.endsAt), bannerText: s.bannerText ?? "", active: s.active });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await api("POST", "/api/portal/store/sales", { id: edit === "new" ? undefined : edit, sale: { ...f, percentOff: Number(f.percentOff), startsAt: toIso(f.startsAt), endsAt: toIso(f.endsAt) } });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setEdit(null); router.refresh();
  }
  async function remove(id: string) {
    if (!confirm("Delete this sale? Prices go back to normal at once.")) return;
    const r = await api("DELETE", "/api/portal/store/sales", { id });
    if (!r.ok) setMsg({ err: r.error }); else router.refresh();
  }
  const toggle = (k: "categoryIds" | "productIds", id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const state = (s: SaleView) => (!s.active ? ["c-draft", "Off"] : new Date(s.endsAt).getTime() <= now ? ["c-draft", "Ended"] : new Date(s.startsAt).getTime() > now ? ["c-draft", "Scheduled"] : ["c-active", "Running"]);
  return (
    <div style={{ maxWidth: 960 }}>
      <div className="card p0 mb12">
        <div className="card-h row between"><b>Sale events</b><button className="btn btn-orange btn-sm" onClick={() => open()}>New sale</button></div>
        {sales.length === 0 ? <p className="small muted" style={{ padding: 16, margin: 0 }}>No sales yet. A sale lowers prices for a set time and shows a countdown bar at the top of your store.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Sale</th><th>Discount</th><th>On</th><th>When</th><th>Status</th><th /></tr></thead>
            <tbody>{sales.map((s) => {
              const [cls, label] = state(s);
              return (
                <tr key={s.id}><td className="small"><b>{s.name}</b>{s.bannerText && <div className="tiny muted">{s.bannerText}</div>}</td><td className="small">{s.percentOff}% off</td>
                  <td className="small">{s.scope === "all" ? "Whole store" : s.scope === "categories" ? `${s.categoryIds.length} categories` : `${s.productIds.length} products`}</td>
                  <td className="small">{when(s.startsAt)} – {when(s.endsAt)}</td><td><span className={`chip ${cls}`}>{label}</span></td>
                  <td className="small"><button className="link small" onClick={() => open(s)}>Edit</button> · <button className="link small" onClick={() => remove(s.id)}>Delete</button></td></tr>
              );
            })}</tbody></table></div>
        )}
      </div>
      {edit && (
        <form className="card" style={{ padding: 20, display: "grid", gap: 12 }} onSubmit={save}>
          <h3 style={{ margin: 0 }}>{edit === "new" ? "New sale" : "Edit sale"}</h3>
          <div className="grid2">
            <div className="field"><label htmlFor="sn">Name</label><input id="sn" className="input" maxLength={60} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diwali Sale" /></div>
            <div className="field"><label htmlFor="sp">Discount (% off)</label><input id="sp" className="input" inputMode="numeric" value={f.percentOff} onChange={(e) => setF({ ...f, percentOff: e.target.value.replace(/\D/g, "") })} /></div>
            <div className="field"><label htmlFor="ss">Starts</label><input id="ss" type="datetime-local" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required /></div>
            <div className="field"><label htmlFor="se">Ends</label><input id="se" type="datetime-local" className="input" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} required /></div>
          </div>
          <div className="field"><label htmlFor="sb">Top bar text (optional)</label><input id="sb" className="input" maxLength={120} value={f.bannerText} onChange={(e) => setF({ ...f, bannerText: e.target.value })} placeholder={`${f.name || "Sale"}: ${f.percentOff || 0}% off`} /></div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Applies to</legend>
            <div className="row wrap" style={{ gap: 16 }}>{[["all", "Whole store"], ["categories", "Some categories"], ["products", "Some products"]].map(([k, l]) => <label key={k} className="row small" style={{ gap: 6 }}><input type="radio" name="scope" checked={f.scope === k} onChange={() => setF({ ...f, scope: k })} /> {l}</label>)}</div>
          </fieldset>
          {f.scope === "categories" && <div className="row wrap" style={{ gap: 10 }}>{categories.length ? categories.map((c) => <label key={c.id} className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.categoryIds.includes(c.id)} onChange={() => toggle("categoryIds", c.id)} /> {c.name}</label>) : <span className="small muted">No categories yet.</span>}</div>}
          {f.scope === "products" && <div style={{ maxHeight: 220, overflow: "auto", display: "grid", gap: 6, border: "1px solid var(--line-2,#e5e7eb)", borderRadius: 10, padding: 10 }}>{products.map((p) => <label key={p.id} className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.productIds.includes(p.id)} onChange={() => toggle("productIds", p.id)} /> {p.name}</label>)}</div>}
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Switched on</label>
          <p className="small muted" style={{ margin: 0 }}>Sale prices are rounded to the rupee and checked again on the server at checkout. If two sales cover a product, the bigger discount is used. Coupons still work on top.</p>
          <Msg m={msg} />
          <div className="row" style={{ gap: 8 }}><button className="btn btn-orange" disabled={busy}>{busy ? "Saving…" : "Save sale"}</button><button type="button" className="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
      {!edit && <Msg m={msg} />}
    </div>
  );
}

export type ReviewView = { id: string; rating: number; title: string | null; body: string; name: string; verified: boolean; status: string; createdAt: string; product: string; slug: string };

export function ReviewsManager({ reviews, storeBase }: { reviews: ReviewView[]; storeBase: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  async function act(id: string, action: "hide" | "show" | "delete") {
    if (action === "delete" && !confirm("Delete this review for good?")) return;
    setBusy(id); setErr("");
    const r = await api("POST", "/api/portal/store/reviews", { id, action });
    setBusy(null);
    if (!r.ok) setErr(r.error); else router.refresh();
  }
  if (!reviews.length) return <div className="card empty"><p className="muted">No reviews yet. Buyers can write one on any product page.</p></div>;
  return (
    <div className="card p0" style={{ maxWidth: 1000 }}>
      {err && <p className="err-box small" style={{ margin: 12 }}>{err}</p>}
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Product</th><th>Rating</th><th>Review</th><th>By</th><th>Status</th><th /></tr></thead>
        <tbody>{reviews.map((r) => (
          <tr key={r.id} style={{ opacity: r.status === "hidden" ? 0.6 : 1 }}>
            <td className="small"><a className="orange" href={`${storeBase}/products/${r.slug}/#reviews`} target="_blank" rel="noopener">{r.product}</a></td>
            <td className="small" aria-label={`${r.rating} of 5`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</td>
            <td className="small" style={{ maxWidth: 360 }}>{r.title && <b>{r.title}<br /></b>}{r.body}</td>
            <td className="small">{r.name}{r.verified && <div className="tiny" style={{ color: "var(--green)" }}>Verified buyer</div>}<div className="tiny muted">{new Date(r.createdAt).toLocaleDateString("en-IN")}</div></td>
            <td><span className={`chip ${r.status === "published" ? "c-active" : "c-draft"}`}>{r.status === "published" ? "Live" : "Hidden"}</span></td>
            <td className="small" style={{ whiteSpace: "nowrap" }}>
              <button className="link small" disabled={busy === r.id} onClick={() => act(r.id, r.status === "published" ? "hide" : "show")}>{r.status === "published" ? "Hide" : "Show"}</button> · <button className="link small" disabled={busy === r.id} onClick={() => act(r.id, "delete")}>Delete</button>
            </td>
          </tr>
        ))}</tbody></table></div>
    </div>
  );
}
