import { Info } from "lucide-react";
import { readSettings } from "@/lib/store-themes";
import { type ProcessItem, ProcessBoard } from "@/components/portal/store/ProcessBoard";
import { PAYMENT_LABEL, STAGE_LABEL } from "@/server/store/orders";
import { AWB_DAYS, STEP_LABEL, processQueue } from "@/server/store/process";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Process Orders — Vishwaship" };
type SP = Promise<{ tab?: string; step?: string; kind?: string; delayed?: string; q?: string; from?: string; to?: string; courier?: string; duplicate?: string; sku?: string; group?: string }>;
const ist = (d: Date, withTime = true) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });

export default async function ProcessOrders({ searchParams }: { searchParams: SP }) {
  const { ctx, store } = await requireStorePage();
  const sp = await searchParams;
  const q = await processQueue(ctx.org.id, sp);
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const link = (over: Record<string, string | undefined>, keep = true) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...(keep ? sp : {}), tab: q.tab, step: q.step, ...over })) if (v) u.set(k, v);
    return `?${u.toString()}`;
  };
  const rows: ProcessItem[] = q.rows.map((o) => {
    const first = o.lines[0];
    return {
      id: o.id, number: o.number, at: ist(o.placedAt ?? o.createdAt), dispatchBy: ist(o.dispatchBy), delayed: o.delayed, duplicateOf: o.duplicateOf, step: o.step,
      product: { title: first ? `${first.title}${first.variantTitle ? ` (${first.variantTitle})` : ""}` : "—", sku: first?.sku ?? null, qty: first?.qty ?? 0, image: first?.image ?? null },
      moreItems: Math.max(0, o.lines.length - 1), items: o.items, cod: o.paymentMethod === "cod", totalPaise: o.totalPaise, payLabel: PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus,
      buyer: o.buyer.name, place: `${o.buyer.city} ${o.buyer.pincode}`, carrier: o.carrierName, awb: o.awb, handedOver: !!o.handedOverAt, awbAgeDays: o.awbAgeDays,
      shippingOrderId: o.shippingOrderId, stageLabel: STAGE_LABEL[o.stage],
    };
  });
  const cards = [
    { label: "Total non-dispatched orders", n: q.summary.total, href: link({ tab: "pending", step: "print" }, false) },
    { label: "In Print", n: q.summary.print, href: link({ tab: "pending", step: "print" }, false) },
    { label: "In Pack", n: q.summary.pack, href: link({ tab: "pending", step: "pack" }, false) },
    { label: "In Handover", n: q.summary.handover, href: link({ tab: "pending", step: "handover" }, false) },
    { label: "Delayed non-dispatched", n: q.summary.delayed, href: link({ tab: "pending", delayed: "1" }), hot: q.summary.delayed > 0 },
  ];
  const tabs = [
    { k: "pending", l: `Non-dispatched (${q.counts.pending})` }, { k: "expired", l: `Expired AWB (${q.counts.expired})` },
    { k: "pg", l: `Payment pending (${q.counts.pg})` }, { k: "cancelled", l: `Cancelled (${q.counts.cancelled})` },
  ];
  const filtered = !!(sp.q || sp.from || sp.to || sp.courier || sp.duplicate);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Process Orders</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Print the label, pack the parcel, hand it to the courier. Orders leave this list when the courier scans the pickup.</p></div></div>

      <div className="so-kpis po-kpis">
        {cards.map((c) => <a key={c.label} href={c.href} className={`card so-kpi${c.hot ? " hot" : ""}`}><b>{c.n}</b><span>{c.label}</span></a>)}
      </div>

      <nav className="tabs mb12 po-tabs" aria-label="Order lists">
        {tabs.map((t) => <a key={t.k} href={link({ tab: t.k, step: t.k === "pending" ? q.step : undefined, kind: undefined, delayed: undefined }, false)} className={q.tab === t.k ? "on" : ""} aria-current={q.tab === t.k ? "page" : undefined}>{t.l}</a>)}
      </nav>

      {q.tab === "pending" && (
        <div className="card mb12 po-bar">
          <div className="seg" role="tablist" aria-label="Step">
            {(["print", "pack", "handover"] as const).map((s) => <a key={s} role="tab" aria-selected={q.step === s} className={`po-seg${q.step === s ? " on" : ""}`} href={link({ step: s, kind: undefined, delayed: undefined, sku: undefined }, false)}>{STEP_LABEL[s]} <span className="n">{q.summary[s]}</span></a>)}
          </div>
          <span className="tiny muted po-hint" title="Print: book the courier and print labels. Pack: pack with the label on. Handover: give to the courier."><Info size={14} aria-hidden /> Print → Pack → Handover</span>
          <div className="row wrap" style={{ gap: 6, marginLeft: "auto" }}>
            <div className="seg">
              <a className={`po-seg${sp.kind === "single" ? " on" : ""}`} href={link({ kind: sp.kind === "single" ? undefined : "single" })}>Single ({q.stepCounts.single})</a>
              <a className={`po-seg${sp.kind === "clubbed" ? " on" : ""}`} href={link({ kind: sp.kind === "clubbed" ? undefined : "clubbed" })}>Clubbed ({q.stepCounts.clubbed})</a>
            </div>
            <a className={`btn btn-outline btn-sm${sp.delayed === "1" ? " po-on" : ""}`} href={link({ delayed: sp.delayed === "1" ? undefined : "1" })}>Delayed ({q.stepCounts.delayed})</a>
            <a className={`btn btn-outline btn-sm${sp.group === "1" ? " po-on" : ""}`} href={link({ group: sp.group === "1" ? undefined : "1" })}>Group by SKU</a>
          </div>
        </div>
      )}
      {q.tab === "expired" && <p className="note small mb12">Booked more than {AWB_DAYS} days ago and still not picked up. The AWB may no longer work with the courier: cancel the shipment and book it again.</p>}

      <form className="card mb12 po-filters" role="search">
        <input type="hidden" name="tab" value={q.tab} /><input type="hidden" name="step" value={q.step} />
        {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}{sp.delayed && <input type="hidden" name="delayed" value={sp.delayed} />}{sp.group && <input type="hidden" name="group" value={sp.group} />}
        <div className="field" style={{ flex: 2, minWidth: 180 }}><label htmlFor="q">Order / AWB / SKU / mobile</label><input id="q" name="q" type="search" className="input" defaultValue={sp.q ?? ""} enterKeyHint="search" /></div>
        <div className="field"><label htmlFor="f">From</label><input id="f" type="date" name="from" className="input" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="t">To</label><input id="t" type="date" name="to" className="input" defaultValue={sp.to ?? ""} /></div>
        <div className="field"><label htmlFor="c">Shipping partner</label><select id="c" name="courier" className="input select" defaultValue={sp.courier ?? ""}><option value="">All</option>{q.couriers.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div className="field"><label htmlFor="d">Duplicate</label><select id="d" name="duplicate" className="input select" defaultValue={sp.duplicate ?? ""}><option value="">All</option><option value="yes">Possible duplicates</option><option value="no">Not duplicate</option></select></div>
        <button className="btn btn-outline" style={{ minHeight: 42 }}>Apply</button>
        {filtered && <a className="small orange" href={link({ q: undefined, from: undefined, to: undefined, courier: undefined, duplicate: undefined })}>Clear</a>}
      </form>

      {sp.group === "1" && q.tab === "pending" && (
        <div className="card mb12" style={{ padding: 12 }}>
          <b className="small">Group by SKU · {q.skus.length} SKU(s) in this view</b>
          <ul className="dp-files">{q.skus.map((s) => (
            <li key={s.sku}><span className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}><b className="mono">{s.sku}</b> · {s.title}<span className="tiny muted"> · {s.orders} order(s)</span></span>
              <span className="row" style={{ gap: 6, flexShrink: 0 }}><b>{s.qty} pcs</b><a className="btn btn-outline btn-sm" href={link({ sku: sp.sku === s.sku ? undefined : s.sku })}>{sp.sku === s.sku ? "All SKUs" : "Only this"}</a></span></li>
          ))}</ul>
        </div>
      )}

      <ProcessBoard rows={rows} tab={q.tab} step={q.step} warehouseId={readSettings(store.settings).checkout.warehouseId} today={today} />
    </>
  );
}
