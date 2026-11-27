"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { statusLabel } from "@/lib/status";
import { COD_DISPLAY, codDisplay } from "@/lib/order-view";
import type { OrderRow } from "@/server/orders/view";
import { CodStatusText, CopyBtn, Dialog, ago, inr, istFull } from "./ui";
import { OneShipment, type PodCardData } from "@/components/tracking/ShipmentTracking";
import type { Milestone, ScanLine } from "@/lib/tracking-timeline";
import { ShareTracking } from "@/components/portal/ShareTracking";

type Timeline = {
  orderNumber: string; carrier: string; service: string; awb: string | null; lr: string | null; status: string; etaDate: string | null; deliveredAt: string | null;
  lastLocation: string | null; lastEventAt: string | null; lastSyncAt: string | null; lastSyncError: string | null; syncFailures: number; demo: boolean;
  destination: { city?: string; state?: string; pincode?: string };
  pickup?: { status: string; date: string | null; requestId: string | null; agentName: string | null; agentPhone: string | null };
  delivery?: { name: string | null; phone: string | null } | null;
  events: Array<{ status: string; raw: string | null; location: string | null; at: string; remark: string | null; source: string }>;
  amendments: Array<{ at: string; previous: string; next: string }>;
  milestones?: Milestone[]; scans?: ScanLine[]; pod?: Omit<PodCardData, "href"> | null;
  share?: { url: string; orderNumber: string; buyerMobile: string | null; business: string; supportPhone: string; supportEmail: string } | null;
};

/** Track: provider events, timestamps, locations, current status, ETA and sync health with Retry. */
export function TrackDialog({ shipmentId, onClose, onChanged, admin }: { shipmentId: string; onClose: () => void; onChanged: () => void; admin?: boolean }) {
  const api = admin ? "/api/admin" : "/api/portal";
  const [d, setD] = useState<Timeline | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await fetch(`${api}/shipments/${shipmentId}/timeline`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { setD(j); setErr(null); } else setErr(j.error?.message ?? "Could not load tracking");
  }, [shipmentId, api]);
  useEffect(() => { void load(); }, [load]);
  async function retry() {
    setBusy(true); setNote(null);
    const r = await fetch(`${api}/shipments/${shipmentId}/refresh`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setNote(r.ok ? (j.inserted ? `${j.inserted} new update(s) from the courier.` : "Already up to date.") : (j.error?.message ?? "Sync failed"));
    await load(); onChanged();
  }
  return (
    <Dialog title={d ? `Track ${d.awb ?? d.orderNumber}` : "Track shipment"} sub={d ? `${d.carrier} · ${d.service} · Order ${d.orderNumber}` : undefined} onClose={onClose}>
      {err && <p className="t-bad small" role="alert">{err}</p>}
      {!d && !err && <p className="small muted" role="status">Loading tracking…</p>}
      {d && (
        <>
          <div className="tk-hero">
            <div><span className="tiny">Current status</span><b>{statusLabel(d.status)}</b></div>
            <div><span className="tiny">{d.deliveredAt ? "Delivered on" : "Estimated delivery"}</span>
              <b>{d.deliveredAt ? istFull(d.deliveredAt) : d.etaDate ? new Date(d.etaDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short" }) : "Not shared yet"}</b></div>
            <div className="wide"><span className="tiny">Last scanned at</span><b>{d.lastLocation ?? "No scan yet"}</b>{d.lastEventAt && <span className="tiny">{istFull(d.lastEventAt)}</span>}</div>
          </div>
          <div className="tk-people">
            <div className="tk-person">
              <span className="tiny">Pickup executive{d.pickup?.requestId ? ` · PR ${d.pickup.requestId}` : ""}</span>
              {d.pickup?.agentName || d.pickup?.agentPhone
                ? <><b>{d.pickup.agentName ?? "Courier executive"}</b>{d.pickup.agentPhone && <a className="ov-btn orange sm" href={`tel:${d.pickup.agentPhone}`}>Call {d.pickup.agentPhone}</a>}</>
                : <span className="small muted">{d.pickup?.date ? `Pickup on ${new Date(d.pickup.date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" })} · details appear when the courier assigns someone` : "Shown once the courier assigns a pickup executive"}</span>}
            </div>
            <div className="tk-person">
              <span className="tiny">Delivery executive</span>
              {d.delivery?.name || d.delivery?.phone
                ? <><b>{d.delivery.name ?? "Courier executive"}</b>{d.delivery.phone && <a className="ov-btn orange sm" href={`tel:${d.delivery.phone}`}>Call {d.delivery.phone}</a>}</>
                : <span className="small muted">Shown when the courier shares it on the delivery day</span>}
            </div>
          </div>
          <dl className="ov-kv">
            {d.awb && <><dt>AWB</dt><dd className="ov-awb"><span className="mono">{d.awb}</span><CopyBtn value={d.awb} label="AWB" /></dd></>}
            {d.lr && <><dt>LR / LRN</dt><dd className="ov-awb"><span className="mono">{d.lr}</span><CopyBtn value={d.lr} label="LR number" /></dd></>}
            <dt>Destination</dt><dd>{[d.destination.city, d.destination.state, d.destination.pincode].filter(Boolean).join(", ") || "—"}</dd>
            <dt>Last sync</dt><dd className={d.lastSyncError ? "t-bad" : undefined}>{d.lastSyncAt ? `${ago(d.lastSyncAt)} (${istFull(d.lastSyncAt)})` : "Not synced yet"}{d.lastSyncError ? ` · Failed: ${d.lastSyncError}` : ""}</dd>
          </dl>
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="ov-btn ghost sm" onClick={retry} disabled={busy || !d.awb}><RefreshCw size={14} aria-hidden /> {busy ? "Checking courier…" : d.lastSyncError ? "Retry sync" : "Refresh from courier"}</button>
            {note && <span className="small muted" role="status">{note}</span>}
          </div>
          {d.share && (
            <section className="tk-share" aria-label="Buyer tracking page">
              <span className="tiny">Buyer tracking page</span>
              <b>{d.share.business || "Your store"}</b>
              <span className="small muted">{[d.share.supportPhone, d.share.supportEmail].filter(Boolean).join(" · ") || "Add a mobile and email in your profile so buyers can reach you"}</span>
              <a className="small link" href={d.share.url} target="_blank" rel="noopener" style={{ wordBreak: "break-all" }}>{d.share.url}</a>
              <ShareTracking url={d.share.url} orderNumber={d.share.orderNumber} business={d.share.business} buyerMobile={d.share.buyerMobile} />
            </section>
          )}
          {d.demo && <p className="tiny muted">Demo courier: scans are simulated for testing.</p>}
          {d.amendments.length > 0 && (
            <section>
              <h3 className="small b" style={{ marginBottom: 6 }}>Delivery address changes (confirmed by courier)</h3>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.amendments.map((a, i) => <li key={i}>{istFull(a.at)}: {a.previous} → <b>{a.next}</b></li>)}</ul>
            </section>
          )}
          <section aria-label="Tracking history">
            <h3 className="small b" style={{ marginBottom: 10 }}>Shipment tracking</h3>
            {d.milestones && d.scans ? (
              <div className="st-dialog">
                <OneShipment labelled={false} s={{ id: shipmentId, awb: d.awb, carrierName: d.carrier, statusLabel: statusLabel(d.status), milestones: d.milestones, scans: d.scans,
                  pod: d.pod ? { ...d.pod, href: `${api}/shipments/${shipmentId}/pod` } : null }} />
              </div>
            ) : d.events.length === 0 ? <p className="small muted">No courier scans yet.</p> : (
              <ol className="ov-tl">
                {d.events.map((e, i) => (
                  <li key={i} className={i === 0 ? "now" : undefined}>
                    <div className="b small">{statusLabel(e.status)}{e.raw && e.raw.toLowerCase() !== e.status.replace(/_/g, " ") ? <span className="muted" style={{ fontWeight: 400 }}> · {e.raw}</span> : null}</div>
                    {e.location && <div className="small tk-loc">📍 {e.location}</div>}
                    <div className="tiny muted">{istFull(e.at)}</div>
                    {e.remark && <div className="tiny">{e.remark}</div>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </Dialog>
  );
}

type CodHistory = {
  orderNumber: string; paymentType: string; codPaise: number;
  confirmation: null | { status: string; sentAt: string | null; expiresAt: string | null; decidedAt: string | null; buyerResponse: string | null; buttonLabel: string | null; cancellationStatus: string | null; cancellationReason: string | null; cancellationAt: string | null };
  messages: Array<{ at: string; updatedAt: string; status: string; to: string; template: string | null; error: string | null; response: string | null; respondedAt: string | null; demo: boolean }>;
  activity: Array<{ action: string; at: string }>;
  refund: null | { amountPaise: number; at: string; memo: string | null };
};
const ACTIVITY: Record<string, string> = {
  "cod.confirmed": "Buyer confirmed", "cod.rejected": "Buyer rejected", "cod.no_response": "No response before the deadline", "cod.send_failed": "Message could not be sent",
  "cod.cancelled_with_carrier": "Courier confirmed cancellation", "cod.cancellation_failed": "Courier did not cancel", "shipment.cancel": "Shipment cancelled", "shipment.cancel_failed": "Cancellation failed", "order.cancel": "Order cancelled",
};

/** WhatsApp COD confirmation: buyer status, message history, cancellation and refund. */
export function CodDialog({ row, onClose, admin }: { row: OrderRow; onClose: () => void; admin?: boolean }) {
  const [d, setD] = useState<CodHistory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${admin ? "/api/admin" : "/api/portal"}/orders/${row.id}/cod`, { cache: "no-store" }).then(async (r) => { const j = await r.json().catch(() => ({})); if (r.ok) setD(j); else setErr(j.error?.message ?? "Could not load"); });
  }, [row.id]);
  const st = codDisplay(row.cod);
  return (
    <Dialog title="WhatsApp COD confirmation" sub={`Order ${row.orderNumber} · COD ${inr(row.codPaise)}`} onClose={onClose}>
      <dl className="ov-kv">
        <dt>Buyer confirmation</dt><dd><CodStatusText s={st.buyer} />{st.reason ? <span className="small muted" style={{ fontWeight: 400 }}> · {st.reason}</span> : null}</dd>
        {st.cancellation && <><dt>Shipment cancellation</dt><dd><CodStatusText s={st.cancellation} /></dd></>}
        {d?.confirmation?.buttonLabel && <><dt>Buyer reply</dt><dd>“{d.confirmation.buttonLabel}” · {istFull(d.confirmation.decidedAt)}</dd></>}
        {d?.confirmation?.sentAt && <><dt>Sent</dt><dd>{istFull(d.confirmation.sentAt)}</dd></>}
        {d?.confirmation?.expiresAt && d.confirmation.status === "pending" && <><dt>Response window ends</dt><dd>{istFull(d.confirmation.expiresAt)}</dd></>}
        {d?.confirmation?.cancellationReason && <><dt>Cancellation detail</dt><dd style={{ fontWeight: 400 }}>{d.confirmation.cancellationReason}</dd></>}
        {d?.refund && <><dt>Wallet refund</dt><dd className="t-ok">{inr(d.refund.amountPaise)} · {istFull(d.refund.at)}</dd></>}
      </dl>
      {!admin && (st.buyer === "setup_required" || st.buyer === "disabled") && <p className="small"><Link className="ov-link" href="/portal/notifications/cod/">Open COD Confirmation settings →</Link></p>}
      {err && <p className="t-bad small" role="alert">{err}</p>}
      {d && d.messages.length > 0 && (
        <section>
          <h3 className="small b" style={{ marginBottom: 6 }}>Messages (to the delivery recipient)</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            {d.messages.map((m, i) => (
              <li key={i}>{istFull(m.at)} · to {m.to} · <b>{m.status === "read" ? "Read" : m.status[0].toUpperCase() + m.status.slice(1)}</b>{m.demo ? " (demo — not delivered)" : ""}
                {m.error ? <span className="t-bad"> · {m.error}</span> : null}{m.response ? <> · reply “{m.response === "confirm" ? "Confirm Order" : "Cancel Order"}” {istFull(m.respondedAt)}</> : null}</li>
            ))}
          </ul>
        </section>
      )}
      {d && d.activity.length > 0 && (
        <section>
          <h3 className="small b" style={{ marginBottom: 6 }}>Activity</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.activity.map((a, i) => <li key={i}>{istFull(a.at)} · {ACTIVITY[a.action] ?? a.action}</li>)}</ul>
        </section>
      )}
      {!d && !err && <p className="small muted" role="status">Loading…</p>}
      <p className="tiny muted">Statuses: {Object.values(COD_DISPLAY).map((x) => x.label).join(" · ")}</p>
    </Dialog>
  );
}

/** Shipping charge breakdown: quote lines, GST, booked amount, later adjustments, final total. */
export function BreakdownDialog({ row, onClose, admin }: { row: OrderRow; onClose: () => void; admin?: boolean }) {
  const b = row.breakdown!;
  const pre = b.lines.reduce((t, l) => t + l.amount, 0);
  return (
    <Dialog title="Shipping charge breakdown" sub={`Order ${row.orderNumber}${row.shipment?.awb ? ` · AWB ${row.shipment.awb}` : ""}`} onClose={onClose}>
      <table className="ov-break">
        <tbody>
          {b.lines.map((l, i) => <tr key={i}><td>{l.label}</td><td>{inr(l.amount)}</td></tr>)}
          {b.lines.length > 0 && <tr><td>Subtotal (before GST)</td><td>{inr(pre)}</td></tr>}
          {b.gst != null && <tr><td>GST</td><td>{inr(b.gst)}</td></tr>}
          <tr><td><b>Booked amount</b> <span className="tiny muted">(debited from wallet at booking)</span></td><td><b>{inr(b.booked)}</b></td></tr>
          {b.adjustment && <tr><td>{b.adjustment.label} <span className="tiny muted">· {istFull(b.adjustment.at)}</span></td><td>{b.adjustment.amount >= 0 ? "+" : ""}{inr(b.adjustment.amount)}</td></tr>}
          <tr className="tot"><td>Total charged</td><td>{inr(b.total)}</td></tr>
        </tbody>
      </table>
      {row.payment === "fod" && <p className="small">Freight payable by the receiver at delivery (FOD): <b>{inr(row.receiverFreightPaise)}</b></p>}
      {b.quoteTotal != null && b.quoteTotal !== b.booked && row.payment !== "fod" && <p className="tiny muted">Quoted total was {inr(b.quoteTotal)}; the booked amount above is what was actually charged.</p>}
      {!admin && <p className="small"><Link className="ov-link" href="/portal/billing/">View in Billing →</Link></p>}
    </Dialog>
  );
}

export function PickupDialog({ row, onClose, admin }: { row: OrderRow; onClose: () => void; admin?: boolean }) {
  const p = row.pickup;
  return (
    <Dialog title={p?.label ?? "Pickup address"} sub="Pickup warehouse" onClose={onClose}>
      {p ? (
        <dl className="ov-kv">
          <dt>Address</dt><dd style={{ fontWeight: 400 }}>{[p.line1, p.line2, p.city, p.state, p.pincode].filter(Boolean).join(", ")}</dd>
          {p.contactName && <><dt>Contact</dt><dd>{p.contactName}</dd></>}
          {p.mobile && <><dt>Mobile</dt><dd><a className="ov-link" href={`tel:${p.mobile}`}>{p.mobile}</a></dd></>}
        </dl>
      ) : <p className="small muted">No pickup address on this order.</p>}
      {!admin && <p className="small"><Link className="ov-link" href="/portal/addresses/">Manage pickup addresses →</Link></p>}
    </Dialog>
  );
}
