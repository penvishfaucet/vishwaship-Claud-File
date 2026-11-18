import "@/styles/offers.css";
import { BadgeIndianRupee, Package, Truck } from "lucide-react";
import type { Offers } from "@/lib/site-content";

/**
 * Starting-price highlights (Admin → Website Content → Offers). Starting prices only — quote cards keep
 * showing the live calculated rate. Self-styled so it works on the public site and inside the portal.
 */
export function OfferStrip({ offers, variant = "light", where }: { offers: Offers; variant?: "light" | "dark" | "compact"; where: "home" | "calculator" | "dashboard" }) {
  const show = offers.visible && (where === "home" ? offers.showOnHome : where === "calculator" ? offers.showOnCalculator : offers.showOnDashboard);
  if (!show) return null;
  const items = [
    offers.codText && { icon: BadgeIndianRupee, label: offers.codText, price: "" },
    offers.parcelLabel && { icon: Package, label: offers.parcelLabel, price: offers.parcelPrice },
    offers.cargoLabel && { icon: Truck, label: offers.cargoLabel, price: offers.cargoPrice },
  ].filter(Boolean) as Array<{ icon: typeof Package; label: string; price: string }>;
  if (!items.length) return null;
  return (
    <section className={`vo vo-${variant}`} aria-label="Shipping offers">
      <ul>
        {items.map((it) => (
          <li key={it.label}>
            <span className="ic" aria-hidden="true"><it.icon size={20} /></span>
            <span className="tx">{it.label}{it.price && <> <b>{it.price}</b></>}</span>
          </li>
        ))}
      </ul>
      {offers.note && <p>{offers.note}</p>}
    </section>
  );
}
