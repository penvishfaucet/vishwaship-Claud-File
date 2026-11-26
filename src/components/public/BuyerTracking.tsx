import { BrandLogo } from "@/components/BrandLogo";
import type { TrackingPageSettings } from "@/lib/tracking-page";
import { carrierLogo } from "@/lib/site";
import { statusLabel } from "@/lib/status";
import type { Milestone, ScanLine } from "@/lib/tracking-timeline";
import { OneShipment } from "@/components/tracking/ShipmentTracking";

export type BuyerShipment = {
  orderNumber: string; awb: string | null; carrierCode: string; carrierName: string; status: string;
  etaDate: string | null; events: Array<{ status: string; location: string | null; at: string }>;
  milestones?: Milestone[]; scans?: ScanLine[];
};

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const STEPS = ["booked", "picked_up", "in_transit", "out_for_delivery", "delivered"];

/**
 * Buyer-facing view: order number, carrier, AWB, status, ETA and scan timeline only.
 * Never shows addresses, phone numbers, prices or account data.
 * `brand` null → plain Vishwaship styling.
 */
export function BuyerTracking({ brand, shipment, footer, preview, children }: { brand: TrackingPageSettings | null; shipment: BuyerShipment | null; footer: string; preview?: boolean; children?: React.ReactNode }) {
  const primary = brand?.primaryColor ?? "#0b1f3a";
  const accent = brand?.accentColor ?? "#f0712c";
  const stepIdx = shipment ? Math.max(0, STEPS.findIndex((s) => s === (shipment.status === "pickup_pending" ? "booked" : shipment.status === "at_delivery_center" ? "in_transit" : shipment.status))) : 0;
  return (
    <div style={{ minHeight: "100vh", background: "#f4f3ef", fontFamily: "var(--font-roboto), Roboto, system-ui, sans-serif" }}>
      <header style={{ background: primary, color: "#fff", padding: "18px 20px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          {brand?.logo ? <img src={brand.logo} alt="" style={{ height: 40, width: "auto", borderRadius: 6, background: "#fff", padding: 2 }} /> : <BrandLogo height={52} />}
          <b style={{ fontSize: 20 }}>{brand?.businessName ?? "Vishwaship"}</b>
          {preview && <span style={{ marginLeft: "auto", background: accent, color: "#fff", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>PREVIEW</span>}
        </div>
      </header>
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 40px" }}>
        <h1 style={{ color: primary, fontSize: 26, margin: "0 0 6px" }}>{brand?.headline || "Track your order"}</h1>
        {brand?.message && <p style={{ color: "#4b5160", margin: "0 0 16px", whiteSpace: "pre-wrap" }}>{brand.message}</p>}
        {children}
        {!shipment ? null : (
          <section style={{ background: "#fff", border: "1px solid #e7e5df", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7183" }}>Order</div>
                <div style={{ fontWeight: 700 }}>{shipment.orderNumber}</div>
                {(brand?.showCarrier ?? true) && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>{carrierLogo(shipment.carrierCode) && <img src={carrierLogo(shipment.carrierCode)!} alt="" style={{ height: 22 }} />}<span style={{ fontSize: 13 }}>{shipment.carrierName} · <span style={{ fontFamily: "monospace" }}>{shipment.awb}</span></span></div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: accent }}>{statusLabel(shipment.status)}</div>
                {shipment.etaDate && <div style={{ fontSize: 13, color: "#6b7183" }}>Expected by {new Date(shipment.etaDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })}</div>}
              </div>
            </div>
            {shipment.milestones && shipment.scans ? (
              <div className="st-buyer" style={{ marginTop: 14, borderTop: "1px solid #efede8" }}>
                <OneShipment s={{ id: shipment.awb ?? shipment.orderNumber, awb: shipment.awb, carrierName: shipment.carrierName, statusLabel: statusLabel(shipment.status), milestones: shipment.milestones, scans: shipment.scans }} labelled={false} />
              </div>
            ) : (<>
            <div aria-hidden style={{ display: "flex", gap: 4, margin: "18px 0 6px" }}>
              {STEPS.map((s, i) => <div key={s} style={{ flex: 1, height: 6, borderRadius: 4, background: i <= stepIdx ? accent : "#e7e5df" }} />)}
            </div>
            <ol style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
              {[...shipment.events].reverse().map((e, i) => (
                <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #efede8" }}>
                  <span style={{ fontWeight: i === 0 ? 700 : 500 }}>{e.status}{e.location ? <span style={{ color: "#6b7183", fontWeight: 400 }}> · {e.location}</span> : null}</span>
                  <span style={{ fontSize: 12, color: "#6b7183", whiteSpace: "nowrap" }}>{fmt(e.at)}</span>
                </li>
              ))}
            </ol>
            </>)}
          </section>
        )}
        {brand && (brand.supportEmail || brand.supportPhone) && (
          <section style={{ marginTop: 16, background: "#fff", border: "1px solid #e7e5df", borderRadius: 16, padding: 16, fontSize: 14 }}>
            <b style={{ color: primary }}>Need help with your order?</b>
            <div style={{ marginTop: 6 }}>
              {brand.supportPhone && <div>Call <a href={`tel:${brand.supportPhone.replace(/\s/g, "")}`} style={{ color: accent, fontWeight: 700 }}>{brand.supportPhone}</a>{brand.supportHours ? ` (${brand.supportHours})` : ""}{brand.supportPhone.replace(/\D/g, "").length >= 10 && <> · <a href={`https://wa.me/${(() => { const d = brand.supportPhone.replace(/\D/g, ""); return d.length === 10 ? `91${d}` : d; })()}`} target="_blank" rel="noopener" style={{ color: accent, fontWeight: 700 }}>WhatsApp</a></>}</div>}
              {brand.supportEmail && <div>Email <a href={`mailto:${brand.supportEmail}`} style={{ color: accent, fontWeight: 700 }}>{brand.supportEmail}</a></div>}
            </div>
          </section>
        )}
        <p style={{ textAlign: "center", fontSize: 12, color: "#9aa0ad", marginTop: 24 }}>{brand?.footerText ? `${brand.footerText} · ` : ""}{footer}</p>
      </main>
    </div>
  );
}

/** Map events to buyer-safe labels. */
export function toBuyerEvents(events: Array<{ status: string; location: string | null; occurredAt: Date }>) {
  return events.map((e) => ({ status: statusLabel(e.status), location: e.location, at: e.occurredAt.toISOString() }));
}
