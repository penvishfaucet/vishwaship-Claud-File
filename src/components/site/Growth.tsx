import Link from "next/link";
import { BadgeIndianRupee, Headphones, Megaphone, MessageCircle, PhoneCall, Store, Truck } from "lucide-react";
import "@/styles/growth.css";

/** The Vishwaship Growth Package in one line each (owner 2026-11-23). Used by the running bars and the home teaser. */
export const GROWTH_RUN = [
  ["🚀", "Create your online store & boost your sales"],
  ["₹0", "monthly fee — pay 1.5% only on delivered orders"],
  ["📣", "Meta & Google Ads run by our team"],
  ["🎨", "Instagram & Facebook creatives"],
  ["🚚", "Shipping from ₹28 · pan-India"],
  ["✅", "WhatsApp COD confirmation — fewer fake orders"],
  ["📞", "NDR calling + 24×7 NDR support team"],
  ["👤", "Dedicated account manager + WhatsApp group"],
  ["💸", "COD paid in D+5 · prepaid straight to your Razorpay"],
] as const;

/** Right-to-left running bar. Items are rendered twice so the loop is seamless; hover pauses it. */
export function GrowthRunBar({ href = "/online-store/", portal = false }: { href?: string; portal?: boolean }) {
  const items = [...GROWTH_RUN, ...GROWTH_RUN];
  return (
    <div className={`gp-run${portal ? " portal" : ""}`} role="region" aria-label="Vishwaship Growth Package">
      <Link href={href} aria-label="Create your online store and boost your sales — see the Growth Package">
        <span className="track" aria-hidden="true">
          {items.map(([a, b], i) => <span key={i} className="it"><b>{a}</b>{b}</span>)}
        </span>
      </Link>
    </div>
  );
}

/** Home page teaser for the Growth Package. */
export function GrowthHomeTeaser() {
  const mini = [
    [Store, "Your website"], [Megaphone, "Meta & Google Ads"], [Truck, "Shipping from ₹28"],
    [MessageCircle, "WhatsApp COD confirm"], [PhoneCall, "NDR calling"], [Headphones, "Account manager"],
  ] as const;
  return (
    <div className="gp">
      <div className="gp-home">
        <div>
          <span className="gp-eye">Vishwaship Growth Package</span>
          <h2>Create your online store &amp; boost your sales</h2>
          <p>Website, ads, creatives and shipping — one team. <b style={{ color: "#fff" }}>₹0 monthly fee.</b> We earn only <b style={{ color: "#FFB48A" }}>1.5% on delivered orders.</b></p>
          <div className="gp-btns">
            <Link className="gp-btn or" href="/online-store/">See the package</Link>
            <Link className="gp-btn wh" href="/online-store/#gp-price"><BadgeIndianRupee size={18} aria-hidden="true" />Pricing</Link>
          </div>
        </div>
        <div className="gp-mini">
          {mini.map(([Icon, t]) => <div key={t}><Icon size={24} aria-hidden="true" />{t}</div>)}
        </div>
      </div>
    </div>
  );
}
