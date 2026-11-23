import { PartnerCarousel } from "@/components/site/PartnerCarousel";
import { RateCalcV3 } from "@/components/site/RateCalcV3";
import { OfferStrip } from "@/components/site/OfferStrip";
import { accountHref, visiblePartners } from "@/lib/site-content";
import { siteAuth } from "@/server/site/auth";
import { getSiteContent } from "@/server/site/content";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = pageMeta("/shipping-rate-calculator/", "Shipping Rate Calculator — Compare Courier Rates | Vishwaship", "Compare B2C parcel and B2B cargo courier rates pincode to pincode, by weight and box size, and book the best courier in one click.");

export default async function RateCalcPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const sp = await searchParams;
  const c = await getSiteContent({ preview: sp.preview === "1" });
  const partners = visiblePartners(c.partners);
  const auth = await siteAuth();
  // Results are matched to logos by courier code (partner id) — e.g. "delhivery" → Delhivery logo.
  const logos = Object.fromEntries(c.partners.items.filter((p) => p.logoUrl).map((p) => [p.id, p.logoUrl]));
  return (
    <>
      <section className="pg-hero" aria-labelledby="rc-h">
        <div className="w-wrap">
          <span className="w-eyebrow">Rate calculator</span>
          <h1 id="rc-h">Compare shipping rates</h1>
          <p className="w-lead">Enter the pickup and delivery pincodes with your box details. We check B2C parcel and B2B cargo services together and show the final price including GST.</p>
          <div style={{ marginTop: 20 }}><OfferStrip offers={c.offers} where="calculator" /></div>
        </div>
      </section>
      <section className="w-sec" style={{ paddingTop: 8 }}>
        <div className="w-wrap">
          {c.features.calculator
            ? <RateCalcV3 logos={logos} signedIn={!!auth.customer} loginHref={accountHref(c.links.customerLogin, "/login/")} />
            : <p className="w-card" role="status" style={{ marginTop: 24, padding: 24 }}>{c.features.unavailableText}</p>}
          <div style={{ marginTop: 48 }}><PartnerCarousel partners={partners} heading={c.home.partnersHeading} compact /></div>
        </div>
      </section>
    </>
  );
}
