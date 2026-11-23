import Link from "next/link";
import { Download, FileSpreadsheet, FileText, Info } from "lucide-react";
import { formatINR } from "@/lib/money";
import { PRESETS, istFrom, istTo, presetRange, stateName, type PresetKey } from "@/lib/gst";
import { portalContext } from "@/server/portal/context";
import { AWB_VIEWS, awbCharges, documents, summary, type AwbView } from "@/server/gst/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "GST Invoices & Reports — Vishwaship" };

type SP = Promise<{ preset?: string; from?: string; to?: string; view?: string; q?: string }>;
const d = (x: Date | null | undefined) => (x ? x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");
const R = { textAlign: "right" as const };
const KIND: Record<string, string> = { invoice: "Invoice", credit_note: "Credit note", debit_note: "Debit note" };
const SHOW_ROWS = 300;
/** credit notes reduce the bill: shown with a minus sign (amounts are stored positive) */
const neg = (kind: string) => (kind === "credit_note" ? "−" : "");

export default async function GstPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const preset = (PRESETS.some((p) => p.key === sp.preset) ? sp.preset : "this_month") as PresetKey;
  const r = presetRange(preset, new Date(), { from: sp.from, to: sp.to });
  const from = istFrom(r.from), to = istTo(r.to);
  const view = (AWB_VIEWS.some((v) => v.key === sp.view) ? sp.view : "all") as AwbView;
  const q = sp.q?.trim().slice(0, 60) || undefined;
  const [s, docs, awb] = await Promise.all([summary(ctx.org.id, from, to), documents(ctx.org.id, from, to, q), awbCharges(ctx.org.id, from, to, view, q)]);
  const qs = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ preset, from: preset === "custom" ? r.from : undefined, to: preset === "custom" ? r.to : undefined, view, q, ...over })) if (v) u.set(k, v);
    return u.toString();
  };
  const dl = (format: string) => `/api/portal/billing/gst/?${new URLSearchParams({ preset: "custom", from: r.from, to: r.to, format })}`;
  const gstLines = (x: { cgstPaise: number; sgstPaise: number; utgstPaise: number; igstPaise: number }) => [
    ["CGST", x.cgstPaise], ["SGST", x.sgstPaise], ["UTGST", x.utgstPaise], ["IGST", x.igstPaise],
  ].filter(([, v]) => v) as Array<[string, number]>;
  const basis = AWB_VIEWS.find((v) => v.key === view)!;

  return (
    <>
      <div className="page-h">
        <div>
          <p className="small muted" style={{ margin: 0 }}>Billing</p>
          <h1>GST Invoices &amp; Reports</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Your Vishwaship invoices, GST split, AWB-wise spend and a download pack for your CA.</p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn btn-orange" href={dl("zip")}><Download size={16} aria-hidden /> Download for CA</a>
          <a className="btn btn-outline" href={dl("xlsx")}><FileSpreadsheet size={16} aria-hidden /> Excel only</a>
        </div>
      </div>

      <form className="card mb12 gst-filter" method="get">
        <div className="gst-presets" role="group" aria-label="Period">
          {PRESETS.map((p) => <Link key={p.key} href={`?${qs({ preset: p.key, from: undefined, to: undefined })}`} className={`chip${p.key === preset ? " on" : ""}`} aria-current={p.key === preset ? "true" : undefined}>{p.label}</Link>)}
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
          <input type="hidden" name="preset" value="custom" />
          <input type="hidden" name="view" value={view} />
          <label className="field" style={{ margin: 0 }}><span className="tiny muted">From</span><input className="input" type="date" name="from" defaultValue={r.from} /></label>
          <label className="field" style={{ margin: 0 }}><span className="tiny muted">To</span><input className="input" type="date" name="to" defaultValue={r.to} /></label>
          <label className="field grow" style={{ margin: 0, minWidth: 200 }}><span className="tiny muted">AWB, invoice or note number</span><input className="input" name="q" defaultValue={q ?? ""} placeholder="e.g. 1234567890 or VS/INV/2026-27/00012" /></label>
          <button className="btn btn-navy">Apply</button>
        </div>
        <p className="tiny muted" style={{ margin: "8px 0 0" }}>{r.label}: {d(from)} – {d(to)} · India time · Financial year April–March{ctx.org.gstin ? ` · Billing GSTIN ${ctx.org.gstin}` : " · No GSTIN on your profile (unregistered)"}</p>
      </form>

      <section className="gst-cards mb12" aria-label="Period summary">
        <div className="card gst-card"><span className="tiny muted">Payments &amp; wallet recharges · by payment date</span><b>{formatINR(s.payments.amountPaise)}</b><span className="tiny">{s.payments.count} recharge{s.payments.count === 1 ? "" : "s"}</span></div>
        <div className="card gst-card"><span className="tiny muted">Wallet usage &amp; adjustments</span><b>{formatINR(s.wallet.usedPaise - s.wallet.backPaise)}</b>
          <span className="tiny">Used {formatINR(s.wallet.usedPaise)} · returned {formatINR(s.wallet.backPaise)} · unused balance {formatINR(s.wallet.closingPaise)}</span></div>
        <div className="card gst-card"><span className="tiny muted">Taxable service value · invoices, by document date</span><b>{formatINR(s.invoices.taxablePaise)}</b><span className="tiny">{s.invoices.count} invoice{s.invoices.count === 1 ? "" : "s"}</span></div>
        <div className="card gst-card"><span className="tiny muted">GST charged on invoices</span><b>{formatINR(s.invoices.gstPaise)}</b><span className="tiny">{gstLines(s.invoices.split).map(([k, v]) => `${k} ${formatINR(v)}`).join(" · ") || "—"}</span></div>
        <div className="card gst-card"><span className="tiny muted">Credit &amp; debit notes</span><b>−{formatINR(s.creditNotes.totalPaise)} / +{formatINR(s.debitNotes.totalPaise)}</b>
          <span className="tiny">CN taxable {formatINR(s.creditNotes.taxablePaise)}, GST {formatINR(s.creditNotes.gstPaise)} · DN taxable {formatINR(s.debitNotes.taxablePaise)}, GST {formatINR(s.debitNotes.gstPaise)}</span></div>
        <div className="card gst-card hl"><span className="tiny muted">Net billed amount</span><b>{formatINR(s.net.totalPaise)}</b><span className="tiny">Taxable {formatINR(s.net.taxablePaise)} + GST {formatINR(s.net.gstPaise)}</span></div>
      </section>
      <p className="tiny muted mb12" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><Info size={14} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
        Recharges are money you added, not a service — GST is on the invoices for the services used. For you these invoices are purchases: match them with your GSTR-2B (shown as &quot;Not verified&quot; because Vishwaship has no access to your GST portal). Input tax credit eligibility is for your CA.{s.derived ? " Some older documents show a GST split worked out from your current GSTIN." : ""}</p>

      <h2 className="b" style={{ fontSize: 16, margin: "18px 0 8px" }}>Invoices, credit notes &amp; debit notes <span className="tiny muted">· by document date</span></h2>
      {docs.length === 0 ? <div className="card empty"><p className="muted">No invoices or notes in this period{q ? ` for “${q}”` : ""}.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Type</th><th>Number</th><th>Date</th><th>GST period</th><th>Original invoice</th><th>Place of supply</th><th style={R}>Taxable</th><th style={R}>CGST</th><th style={R}>SGST / UTGST</th><th style={R}>IGST</th><th style={R}>Total</th><th /></tr></thead>
          <tbody>{docs.map((x) => (
            <tr key={x.id}>
              <td className="small">{KIND[x.kind]}</td><td className="small mono b nw">{x.number}</td><td className="small nw">{d(x.docDate)}</td><td className="small">{x.tax.taxPeriod}</td>
              <td className="small mono">{x.originalNumber ?? "—"}</td><td className="small">{x.tax.placeOfSupply ? `${x.tax.placeOfSupply} ${stateName(x.tax.placeOfSupply)}` : "—"}</td>
              <td style={R} className="small">{x.kind === "credit_note" ? "−" : ""}{formatINR(x.taxablePaise)}</td><td style={R} className="small">{neg(x.kind)}{formatINR(x.tax.cgstPaise)}</td>
              <td style={R} className="small">{neg(x.kind)}{formatINR(x.tax.sgstPaise + x.tax.utgstPaise)}</td><td style={R} className="small">{neg(x.kind)}{formatINR(x.tax.igstPaise)}</td>
              <td style={R} className="small b">{x.kind === "credit_note" ? "−" : ""}{formatINR(x.totalPaise)}</td>
              <td><a className="btn btn-sm btn-outline nw" href={`/api/portal/billing/gst/document/${x.id}/`} target="_blank" rel="noreferrer"><FileText size={14} aria-hidden /> PDF</a></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      <h2 className="b" style={{ fontSize: 16, margin: "22px 0 8px" }}>AWB-wise charges <span className="tiny muted">· by {basis.basis}</span></h2>
      <nav className="gst-presets mb12" aria-label="Shipment view">
        {AWB_VIEWS.map((v) => <Link key={v.key} href={`?${qs({ view: v.key })}`} className={`chip${v.key === view ? " on" : ""}`} aria-current={v.key === view ? "true" : undefined}>{v.label}</Link>)}
      </nav>
      {awb.rows.length === 0 ? <div className="card empty"><p className="muted">No shipments in this view and period.</p></div> : (
        <>
          <div className="card p0 tbl-wrap"><table className="tbl">
            <thead><tr><th>AWB</th><th>Order</th><th>Status</th><th>Charge</th><th>Document</th><th style={R}>Taxable</th><th style={R}>GST</th><th style={R}>Amount</th><th style={R}>COD value (not a fee)</th></tr></thead>
            <tbody>{awb.rows.slice(0, SHOW_ROWS).map((x, i) => (
              <tr key={`${x.shipmentId}-${i}`}>
                <td className="small mono b nw">{x.awb}</td><td className="small mono">{x.orderNumber}</td><td className="small">{x.status.replace(/_/g, " ")}{x.deliveredAt ? <div className="tiny muted">{d(x.deliveredAt)}</div> : null}</td>
                <td className="small">{x.chargeLabel}{x.rateBps != null ? <span className="tiny muted"> · {x.rateBps / 100}%</span> : null}</td>
                <td className="small mono">{x.document ?? <span className="chip">Not invoiced yet</span>}</td>
                <td style={R} className="small">{formatINR(x.taxablePaise)}</td><td style={R} className="small">{formatINR(x.gstPaise)}</td><td style={R} className="small b">{formatINR(x.grossPaise)}</td>
                <td style={R} className="small muted">{x.codValuePaise ? <>{formatINR(x.codValuePaise)}<div className="tiny">{x.codRemittance}</div></> : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="tiny muted">{awb.rows.length > SHOW_ROWS ? `Showing ${SHOW_ROWS} of ${awb.rows.length} lines — the full list is in the Excel and CA download. ` : ""}{awb.truncated ? "Only the latest 5,000 shipments are included; choose a shorter period for the rest. " : ""}Credit notes show as negative amounts. &quot;Not invoiced yet&quot; = charged to your wallet, will appear on the next invoice.</p>
        </>
      )}

      {awb.nonShipment.length > 0 && (
        <>
          <h2 className="b" style={{ fontSize: 16, margin: "22px 0 8px" }}>Non-shipment services <span className="tiny muted">· by document date</span></h2>
          <div className="card p0 tbl-wrap"><table className="tbl">
            <thead><tr><th>Service</th><th>Reference</th><th>Document</th><th style={R}>Taxable</th><th style={R}>GST</th><th style={R}>Amount</th></tr></thead>
            <tbody>{awb.nonShipment.map((x, i) => (
              <tr key={i}><td className="small">{x.description}</td><td className="small mono">{x.orderNumber}</td><td className="small mono">{x.document}</td>
                <td style={R} className="small">{formatINR(x.taxablePaise)}</td><td style={R} className="small">{formatINR(x.gstPaise)}</td><td style={R} className="small b">{formatINR(x.grossPaise)}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </>
  );
}
