"use client";
import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Msg, api } from "./ui";

/** Store order actions: ship (open the shipping order to book a courier), cancel, mark refunded. */
export function OrderActions({ id, status, paymentStatus, shippingOrderId, canCancel }: { id: string; status: string; paymentStatus: string; shippingOrderId: string | null; canCancel: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function act(action: "ship" | "cancel" | "refunded") {
    let reason = "";
    if (action === "cancel") {
      const r = prompt("Reason for cancelling (shown in your records):", "Out of stock");
      if (r === null) return;
      reason = r;
    }
    if (action === "refunded" && !confirm("Mark as refunded? Do this after you have refunded the buyer in your Razorpay dashboard.")) return;
    setBusy(action); setMsg(null);
    const r = await api<{ shippingOrderId?: string }>("PATCH", `/api/portal/store/orders/${id}`, { action, reason });
    setBusy(null);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    if (action === "ship" && r.data.shippingOrderId) { window.location.href = `/portal/orders/${r.data.shippingOrderId}/`; return; }
    setMsg({ ok: action === "cancel" ? "Order cancelled and stock returned." : "Marked as refunded." });
    router.refresh();
  }
  return (
    <div>
      <div className="row wrap" style={{ gap: 8 }}>
        {status === "placed" && <button className="btn btn-orange" onClick={() => act("ship")} disabled={!!busy}>{busy === "ship" ? "Opening…" : shippingOrderId ? "Book courier / view shipment" : "Ship this order"}</button>}
        {canCancel && <button className="btn btn-outline" onClick={() => act("cancel")} disabled={!!busy}>Cancel order</button>}
        {paymentStatus === "refund_due" && <button className="btn btn-outline" onClick={() => act("refunded")} disabled={!!busy}>Mark refunded</button>}
      </div>
      <Msg m={msg} />
    </div>
  );
}

type RzView = { hints: { keyId: string; keySecret: string; webhookSecret: string }; mode: string; verified: boolean; lastTestAt: string | null; lastTestMessage: string | null; webhookUrl: string } | null;

export function RazorpayForm({ initial }: { initial: RzView }) {
  const router = useRouter();
  const [f, setF] = useState({ keyId: initial?.hints.keyId ?? "", keySecret: "", webhookSecret: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy("save"); setMsg(null);
    const r = await api<{ message: string }>("PUT", "/api/portal/store/razorpay", f);
    setBusy(null); setMsg(r.ok ? { ok: r.data.message } : { err: r.error }); setF({ ...f, keySecret: "", webhookSecret: "" }); router.refresh();
  }
  async function other(method: "POST" | "DELETE") {
    if (method === "DELETE" && !confirm("Remove your Razorpay keys? Buyers will only see Cash on Delivery.")) return;
    setBusy(method); setMsg(null);
    const r = await api<{ message?: string }>(method, "/api/portal/store/razorpay");
    setBusy(null); setMsg(r.ok ? { ok: method === "DELETE" ? "Keys removed." : r.data.message } : { err: r.error }); router.refresh();
  }
  return (
    <form className="card" style={{ padding: 20, maxWidth: 760 }} onSubmit={save}>
      <div className="row between wrap" style={{ gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Your Razorpay account</h3>
        {initial && <span className={`chip ${initial.verified ? "c-active" : "c-cancelled"}`}>{initial.verified ? `Connected · ${initial.mode} mode` : "Not connected"}</span>}
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>Online payments from your store go straight to <b>your</b> Razorpay account. They are separate from your Vishwaship shipping wallet. Find the keys in Razorpay Dashboard → Account &amp; Settings → API Keys.</p>
      <div className="grid2">
        <div className="field"><label htmlFor="rk">Key ID</label><input id="rk" className="input mono" value={f.keyId} onChange={(e) => setF({ ...f, keyId: e.target.value.trim() })} placeholder="rzp_live_…" required autoComplete="off" /></div>
        <div className="field"><label htmlFor="rs">Key Secret</label><input id="rs" className="input" type="password" value={f.keySecret} onChange={(e) => setF({ ...f, keySecret: e.target.value })} placeholder={initial?.hints.keySecret ? `Saved (${initial.hints.keySecret}) — leave blank to keep` : ""} autoComplete="off" /></div>
      </div>
      <div className="field" style={{ marginTop: 12 }}><label htmlFor="rw">Webhook secret</label><input id="rw" className="input" type="password" value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} placeholder={initial?.hints.webhookSecret ? `Saved (${initial.hints.webhookSecret}) — leave blank to keep` : "The secret you set when creating the webhook"} autoComplete="off" /></div>
      {initial && (
        <div className="small" style={{ marginTop: 12, background: "var(--gray-soft)", borderRadius: 10, padding: 12 }}>
          <b>Webhook (recommended):</b> in Razorpay → Webhooks, add this URL with events <span className="mono">payment.captured</span> and <span className="mono">order.paid</span>, and paste the same secret above. It confirms payments even if the buyer closes the page.
          <div className="mono" style={{ wordBreak: "break-all", marginTop: 6 }}>{initial.webhookUrl}</div>
        </div>
      )}
      {initial?.lastTestMessage && <p className="small muted" style={{ marginBottom: 0 }}>Last check: {initial.lastTestMessage}{initial.lastTestAt ? ` (${new Date(initial.lastTestAt).toLocaleString("en-IN")})` : ""}</p>}
      <Msg m={msg} />
      <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
        <button className="btn btn-orange" disabled={!!busy}>{busy === "save" ? "Checking…" : "Save & test"}</button>
        {initial && <button type="button" className="btn btn-outline" onClick={() => other("POST")} disabled={!!busy}>Test again</button>}
        {initial && <button type="button" className="btn btn-outline" onClick={() => other("DELETE")} disabled={!!busy}>Remove</button>}
      </div>
    </form>
  );
}

type Coupon = { id: string; code: string; kind: string; value: number; maxDiscountPaise: number | null; minSubtotalPaise: number; maxUses: number | null; used: number; startsAt: string | null; endsAt: string | null; active: boolean; showOnStore: boolean };
const blank = { code: "", kind: "percent", value: "10", maxDiscount: "", minSubtotal: "", maxUses: "", startsAt: "", endsAt: "", active: true, showOnStore: false };

export function CouponManager({ coupons }: { coupons: Coupon[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const describe = (c: Coupon) => (c.kind === "percent" ? `${c.value / 100}% off${c.maxDiscountPaise ? ` (max ₹${c.maxDiscountPaise / 100})` : ""}` : c.kind === "flat" ? `₹${c.value / 100} off` : "Free shipping");
  function open(c?: Coupon) {
    setMsg(null);
    if (!c) { setEdit("new"); setF(blank); return; }
    setEdit(c.id);
    setF({ code: c.code, kind: c.kind, value: c.kind === "free_shipping" ? "0" : String(c.value / 100), maxDiscount: c.maxDiscountPaise ? String(c.maxDiscountPaise / 100) : "", minSubtotal: c.minSubtotalPaise ? String(c.minSubtotalPaise / 100) : "", maxUses: c.maxUses ? String(c.maxUses) : "", startsAt: c.startsAt?.slice(0, 10) ?? "", endsAt: c.endsAt?.slice(0, 10) ?? "", active: c.active, showOnStore: c.showOnStore });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = (v: string) => (v.trim() ? Number(v) : null);
    const r = await api("POST", "/api/portal/store/coupons", { id: edit === "new" ? undefined : edit, coupon: { code: f.code, kind: f.kind, value: Number(f.value) || 0, maxDiscountRupees: n(f.maxDiscount), minSubtotalRupees: Number(f.minSubtotal) || 0, maxUses: n(f.maxUses), startsAt: f.startsAt || null, endsAt: f.endsAt || null, active: f.active, showOnStore: f.showOnStore } });
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setEdit(null); setMsg({ ok: "Coupon saved." }); router.refresh();
  }
  return (
    <>
      <div className="card p0 mb12">
        <table className="os-dns"><thead><tr><th>Code</th><th>Discount</th><th>Min. order</th><th>Used</th><th>Valid</th><th>Status</th><th /></tr></thead>
          <tbody>{coupons.length ? coupons.map((c) => (
            <tr key={c.id}><td className="mono"><b>{c.code}</b></td><td>{describe(c)}</td><td>{c.minSubtotalPaise ? `₹${c.minSubtotalPaise / 100}` : "—"}</td><td>{c.used}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
              <td className="small">{c.startsAt ? new Date(c.startsAt).toLocaleDateString("en-IN") : "Now"} – {c.endsAt ? new Date(c.endsAt).toLocaleDateString("en-IN") : "no end"}</td>
              <td><span className={`chip ${c.active ? "c-active" : "c-draft"}`}>{c.active ? "Active" : "Off"}</span></td><td><button className="link small" onClick={() => open(c)}>Edit</button></td></tr>
          )) : <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>No coupons yet.</td></tr>}</tbody></table>
      </div>
      {edit === null ? <button className="btn btn-orange" onClick={() => open()}>+ New coupon</button> : (
        <form className="card" style={{ padding: 20, maxWidth: 760 }} onSubmit={save}>
          <h3 style={{ marginTop: 0 }}>{edit === "new" ? "New coupon" : `Edit ${f.code}`}</h3>
          <div className="grid2">
            <div className="field"><label htmlFor="cc">Code</label><input id="cc" className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} maxLength={30} required placeholder="DIWALI10" /></div>
            <div className="field"><label htmlFor="ck">Type</label><select id="ck" className="input select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="percent">Percent off</option><option value="flat">Flat ₹ off</option><option value="free_shipping">Free shipping</option></select></div>
            {f.kind !== "free_shipping" && <div className="field"><label htmlFor="cv">{f.kind === "percent" ? "Percent" : "Amount (₹)"}</label><input id="cv" className="input" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.replace(/[^0-9.]/g, "") })} required /></div>}
            {f.kind === "percent" && <div className="field"><label htmlFor="cm">Max discount (₹, optional)</label><input id="cm" className="input" inputMode="decimal" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value.replace(/[^0-9.]/g, "") })} /></div>}
            <div className="field"><label htmlFor="cmin">Minimum order (₹)</label><input id="cmin" className="input" inputMode="decimal" value={f.minSubtotal} onChange={(e) => setF({ ...f, minSubtotal: e.target.value.replace(/[^0-9.]/g, "") })} /></div>
            <div className="field"><label htmlFor="cu">Total uses (optional)</label><input id="cu" className="input" inputMode="numeric" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value.replace(/\D/g, "") })} /></div>
            <div className="field"><label htmlFor="cs">Starts</label><input id="cs" type="date" className="input" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></div>
            <div className="field"><label htmlFor="ce">Ends</label><input id="ce" type="date" className="input" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></div>
          </div>
          <label className="row" style={{ gap: 8, marginTop: 12 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
          <label className="row" style={{ gap: 8, marginTop: 6 }}><input type="checkbox" checked={f.showOnStore} onChange={(e) => setF({ ...f, showOnStore: e.target.checked })} /> Show as an offer on product pages</label>
          <Msg m={msg} />
          <div className="row" style={{ gap: 8, marginTop: 14 }}><button className="btn btn-orange">Save coupon</button><button type="button" className="btn btn-outline" onClick={() => setEdit(null)}>Close</button></div>
        </form>
      )}
      {edit === null && <Msg m={msg} />}
    </>
  );
}

type Preview = { rows: Array<{ row: number; handle: string; title: string; variant: string; errors: string[] }>; products: number; valid: number; headerError?: string };

export function CsvImport() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [p, setP] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function send(mode: "preview" | "import", body: string) {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/portal/store/products/csv/?mode=${mode}`, { method: "POST", headers: { "content-type": "text/csv" }, body });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ err: j?.error?.message ?? "Upload failed" }); return; }
    if (mode === "preview") setP(j);
    else { setMsg({ ok: `Imported: ${j.created} new, ${j.updated} updated${j.skipped ? `, ${j.skipped} skipped (fix their errors and upload again)` : ""}.` }); setP(null); setText(null); router.refresh(); }
  }
  async function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > 2_000_000) { setMsg({ err: "File must be under 2 MB" }); return; }
    const t = await f.text(); setText(t); setName(f.name); await send("preview", t);
    if (ref.current) ref.current.value = "";
  }
  const bad = p?.rows.filter((r) => r.errors.length) ?? [];
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>Import / export</h3>
      <div className="row wrap" style={{ gap: 6 }}>
        <a className="btn btn-outline btn-sm" href="/api/portal/store/products/csv/"><Download size={14} aria-hidden /> Export CSV</a>
        <a className="btn btn-outline btn-sm" href="/api/portal/store/products/csv/?sample=1">Sample file</a>
        <input ref={ref} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button className="btn btn-outline btn-sm" onClick={() => ref.current?.click()} disabled={busy}><Upload size={14} aria-hidden /> {busy ? "Checking…" : "Import CSV"}</button>
      </div>
      <p className="tiny muted" style={{ margin: "8px 0 0" }}>Rows with the same handle become variants of one product. Matching handles update existing products; photos are kept.</p>
      {p && (
        <div style={{ marginTop: 12 }}>
          {p.headerError ? <p className="err-box small">{p.headerError}</p> : <>
            <p className="small" style={{ margin: "0 0 6px" }}><b>{name}</b>: {p.products} product(s), <span className="green">{p.valid} ready</span>{bad.length > 0 && <>, <span className="red">{bad.length} row(s) with errors</span></>}</p>
            {bad.length > 0 && (
              <div style={{ maxHeight: 220, overflow: "auto" }}>
                <table className="os-dns"><thead><tr><th>Row</th><th>Product</th><th>Problem</th></tr></thead>
                  <tbody>{bad.slice(0, 100).map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.title}{r.variant ? ` (${r.variant})` : ""}</td><td className="red small">{r.errors.join("; ")}</td></tr>)}</tbody></table>
              </div>
            )}
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <button className="btn btn-orange btn-sm" disabled={busy || !p.valid || !text} onClick={() => text && send("import", text)}>Import {p.valid} product(s)</button>
              <button className="btn btn-outline btn-sm" onClick={() => { setP(null); setText(null); }}>Cancel</button>
            </div>
          </>}
        </div>
      )}
      <Msg m={msg} />
    </div>
  );
}
