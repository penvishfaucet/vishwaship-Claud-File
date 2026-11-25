import Link from "next/link";
import { ArrowRight, Headset, MapPin, Package, Scale, Truck } from "lucide-react";
import { getSiteContent } from "@/server/site/content";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = pageMeta("/about-us/", "About Us — Vishwaship", "Vishwaship brings shipping-rate comparison, booking, pickup coordination, tracking and support into one platform, run from our Haridwar head office.");

export default async function AboutPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const sp = await searchParams;
  const c = await getSiteContent({ preview: sp.preview === "1" });
  const a = c.about;
  return (
    <>
      <section className="ab-hero" aria-labelledby="ab-h">
        {a.imageUrl && <img src={a.imageUrl} alt="The Vishwaship team and shipments" fetchPriority="high" />}
        <div className="w-wrap in">
          <span className="w-eyebrow">About us</span>
          <h1 id="ab-h">{a.heading}</h1>
          <p className="w-lead">{a.intro}</p>
        </div>
      </section>

      <section className="w-sec">
        <div className="w-wrap w-split" style={{ alignItems: "start" }}>
          <div className="w-prose">
            <span className="w-eyebrow" style={{ marginBottom: 16 }}>Who we are</span>
            {a.paragraphs.filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            <span className="w-eyebrow">What we do</span>
            {[
              { icon: Scale, t: "Rate comparison", d: "Compare available courier services for your route and package." },
              { icon: Package, t: "Booking", d: "Book B2C parcels and B2B cargo from one account." },
              { icon: Truck, t: "Pickup coordination", d: "Schedule pickups from your saved warehouses." },
              { icon: MapPin, t: "Tracking", d: "Follow every shipment by AWB, order or LR number." },
              { icon: Headset, t: "Customer support", d: "Regional and Pan-India support from our head office." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="w-card ab-svc">
                <span className="ic"><Icon size={22} aria-hidden="true" /></span>
                <span><b>{t}</b><span>{d}</span></span>
              </div>
            ))}
            <Link className="w-btn out" href="/customer-care/" style={{ justifySelf: "start" }}>Meet our support team <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section className="w-sec tight" style={{ paddingTop: 0 }}>
        <div className="w-wrap">
          <div className="w-quote">
            <p className="w-slogan"><span>{c.home.heroLine1}</span><span className="o" style={{ color: "var(--o)" }}>{c.home.heroLine2}</span></p>
            <p className="w-lead" style={{ margin: "18px auto 0", color: "#d6deec" }}>{a.closingText}</p>
            <div className="w-btns">
              <Link className="w-btn pri" href="/shipping-rate-calculator/">Check Your Rates <ArrowRight size={18} aria-hidden="true" /></Link>
              <Link className="w-btn sec" href="/customer-care/">Contact Support</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
