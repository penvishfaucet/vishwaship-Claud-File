import { PartnerCarousel } from "@/components/site/PartnerCarousel";
import { RateCalcV2 } from "@/components/site/RateCalcV2";
import { OfferStrip } from "@/components/site/OfferStrip";
import { accountHref, visiblePartners } from "@/lib/site-content";
import { siteAuth } from "@/server/site/auth";
import { b2bThresholdGrams, getSiteContent } from "@/server/site/content";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shipping Rate Calculator — Vishwaship",
  description: "Compare B2C parcel and B2B cargo courier rates by PIN code, weight and carton size.",
};

export default async function RateCalcPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const sp = await searchParams;
  const c = await getSiteContent({ preview: sp.preview === "1" });
  const partners = visiblePartners(c.partners);
  const threshold = await b2bThresholdGrams();
  const auth = await siteAuth();
  // Results are matched to logos by courier code (partner id) — e.g. "delhivery" → Delhivery logo.
  const logos = Object.fromEntries(c.partners.items.filter((p) => p.logoUrl).map((p) => [p.id, p.logoUrl]));
  return (
    <section className="w-sec" style={{ paddingTop: 48 }} aria-labelledby="rc-h">
      <div className="w-wrap">
        <span className="w-eyebrow">Rate calculator</span>
        <h1 id="rc-h" className="w-h2" style={{ fontSize: "clamp(30px,4vw,48px)" }}>Compare shipping rates</h1>
        <p className="w-lead">Enter your route and package details. We check serviceability and chargeable weight with the couriers enabled on Vishwaship and show the final price including GST.</p>
        <div style={{ marginTop: 22 }}><OfferStrip offers={c.offers} where="calculator" /></div>
        <div style={{ marginTop: 24 }}><PartnerCarousel partners={partners} heading={c.home.partnersHeading} compact /></div>
        {c.features.calculator
          ? <RateCalcV2 thresholdGrams={threshold} logos={logos} signedIn={!!auth.customer} loginHref={accountHref(c.links.customerLogin, "/login/")} />
          : <p className="w-card" role="status" style={{ marginTop: 24, padding: 24 }}>{c.features.unavailableText}</p>}
      </div>
    </section>
  );
}
