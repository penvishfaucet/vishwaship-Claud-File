"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp, Download, FileCheck2, KeyRound, Route } from "lucide-react";
import { type Milestone, type ScanLine, fmtScanTime } from "@/lib/tracking-timeline";

export type PodCardData = {
  state: "available" | "pending" | "unsupported" | "failed" | "not_delivered";
  receiverName: string | null; receiverRelation: string | null; deliveredAt: string | null;
  mime: string | null; hasSignature: boolean;
  deliveryMode: "otp" | "pod" | null;
  /** Base URL of the POD file route (customer or admin). */
  href: string;
};
export type TrackShipment = {
  id: string; awb: string | null; carrierName: string; statusLabel: string;
  milestones: Milestone[]; scans: ScanLine[]; pod?: PodCardData | null;
};

const VISIBLE = 6;

/** Reference-style tracking: milestone stepper, then every courier scan (oldest first) with Show more / Show less. */
export function ShipmentTracking({ shipments, title = "Shipment tracking" }: { shipments: TrackShipment[]; title?: string }) {
  const many = shipments.length > 1;
  return (
    <section className="card st-card" aria-label="Shipment tracking">
      <h2 className="st-h"><span className="st-ico" aria-hidden><Route size={16} /></span>{title}{many ? ` (${shipments.length} Shipments)` : ""}</h2>
      {shipments.length === 0 ? <p className="small muted st-pad">No shipment yet.</p> : shipments.map((s) => <OneShipment key={s.id} s={s} labelled={many} />)}
    </section>
  );
}

/** One shipment's stepper + scans (+ POD card). Used inside ShipmentTracking and on the public tracking pages. */
export function OneShipment({ s, labelled }: { s: TrackShipment; labelled: boolean }) {
  const [open, setOpen] = useState(false);
  const hidden = Math.max(0, s.scans.length - VISIBLE);
  const shown = open ? s.scans : s.scans.slice(-VISIBLE);
  return (
    <div className="st-ship">
      {labelled && <div className="st-sub"><b>{s.carrierName}</b>{s.awb ? <span className="mono"> · {s.awb}</span> : null}<span className="st-chip">{s.statusLabel}</span></div>}
      <ol className="st-steps">
        {s.milestones.map((m, i) => (
          <li key={m.key + i} className={`st-step ${m.done ? "done" : ""} t-${m.tone}`}>
            <span className="st-dot" aria-hidden />
            <div><div className="st-lbl">{m.label}</div>{m.at && <div className="st-at">{fmtScanTime(m.at)}</div>}</div>
          </li>
        ))}
      </ol>
      {s.scans.length === 0 ? <p className="small muted st-pad">No courier scans yet. Updates appear here automatically.</p> : (
        <>
          {hidden > 0 && open === false && <p className="tiny muted st-note">Showing the latest {VISIBLE} of {s.scans.length} updates</p>}
          <ul className="st-scans">
            {shown.map((x, i) => <li key={x.at + i}><time dateTime={x.at}>{x.when}</time><span>{x.text}</span></li>)}
          </ul>
          {hidden > 0 && (
            <button type="button" className="st-more" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? <>Show less <ChevronUp size={14} /></> : <>Show more ({hidden}) <ChevronDown size={14} /></>}
            </button>
          )}
        </>
      )}
      {s.pod && <PodCard pod={s.pod} awb={s.awb} />}
    </div>
  );
}

export function PodCard({ pod, awb }: { pod: PodCardData; awb: string | null }) {
  if (pod.state === "not_delivered") return null;
  const isPdf = pod.mime === "application/pdf";
  return (
    <div className="st-pod" aria-label="Proof of Delivery">
      <div className="st-pod-h"><FileCheck2 size={16} aria-hidden /><b>Proof of Delivery</b>
        {pod.deliveryMode === "otp" ? <span className="st-mode otp"><KeyRound size={12} aria-hidden /> OTP based delivery</span>
          : pod.deliveryMode === "pod" ? <span className="st-mode pod"><FileCheck2 size={12} aria-hidden /> POD based delivery</span> : null}
      </div>
      {pod.state === "available" ? (
        <div className="st-pod-body">
          <a className="st-pod-prev" href={pod.href} target="_blank" rel="noopener">
            {isPdf ? <span className="st-pod-pdf">PDF</span> : <img src={pod.href} alt={`Proof of delivery${awb ? ` for AWB ${awb}` : ""}`} loading="lazy" />}
          </a>
          <div className="st-pod-info">
            <dl className="kv-list" style={{ margin: 0 }}>
              {pod.receiverName && <><dt>Received by</dt><dd>{pod.receiverName}{pod.receiverRelation ? ` (${pod.receiverRelation})` : ""}</dd></>}
              {pod.deliveredAt && <><dt>Delivered</dt><dd>{fmtScanTime(pod.deliveredAt)}</dd></>}
            </dl>
            <div className="row wrap" style={{ gap: 8 }}>
              <a className="btn btn-orange btn-sm" href={`${pod.href}?download=1`}><Download size={15} /> Download POD</a>
              {pod.hasSignature && <a className="btn btn-outline btn-sm" href={`${pod.href}?part=signature`} target="_blank" rel="noopener">Signature</a>}
            </div>
          </div>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          {pod.deliveryMode === "otp" ? "Delivered after the receiver confirmed the OTP. Couriers usually do not upload a POD document for OTP deliveries; if they do, it will appear here."
            : pod.state === "pending" ? "Delivered — the courier usually shares the POD within a few hours. It will appear here automatically."
            : pod.state === "unsupported" ? "POD not available from this courier."
            : "The courier has not shared a POD for this shipment. Raise a ticket if you need one."}
        </p>
      )}
    </div>
  );
}
