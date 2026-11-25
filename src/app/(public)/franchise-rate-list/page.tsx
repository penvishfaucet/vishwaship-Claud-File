import { ArrowRight, Building2, Package, ShoppingBag, Store, Users } from "lucide-react";
import { FeatureShowcase } from "@/components/franchise-rates/FeatureShowcase";
import { FranchiseRateChart } from "@/components/franchise-rates/FranchiseRateChart";
import { Reveal } from "@/components/franchise-rates/Reveal";
import { RateCalcV3 } from "@/components/site/RateCalcV3";
import { accountHref } from "@/lib/site-content";
import { getFranchiseRateSettings } from "@/server/franchise-rates/settings";
import { siteAuth } from "@/server/site/auth";
import { getSiteContent } from "@/server/site/content";
import "@/styles/franchise.css";
import "@/styles/franchise-integrations.css";
import "@/styles/franchise-live.css";

export const dynamic = "force-dynamic";

// Footer-only page (not in the header menu). Hidden from search so Google never shows partner prices
// next to the standard calculator; anyone with the link can open it.
export const metadata = {
  title: "Franchise Rate List — Vishwaship",
  description: "Shipping rate calculator and zone-wise rate list for franchise partners, bulk shippers, e-commerce, D2C and Shopify sellers.",
  robots: { index: false, follow: true },
};

const AUDIENCE = [
  { icon: Building2, label: "Franchise partners" },
  { icon: Package, label: "Bulk orders · minimum monthly volume" },
  { icon: ShoppingBag, label: "E-commerce sellers" },
  { icon: Users, label: "D2C brands" },
  { icon: Store, label: "Shopify sellers" },
];

export default async function FranchiseRateListPage() {
  const [c, auth, s] = await Promise.all([getSiteContent(), siteAuth(), getFranchiseRateSettings()]);
  const logos = Object.fromEntries(c.partners.items.filter((p) => p.logoUrl).map((p) => [p.id, p.logoUrl]));
  const wa = `https://wa.me/${c.footer.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}`;
  return (
    <div className="fr">
      <Reveal />
      <section className="fr-hero">
        <div className="fr-glow" aria-hidden="true" />
        <div className="w-wrap fr-hero-in">
          <span className="w-eyebrow fr-up">Franchise rate list</span>
          <h1 className="fr-h1 fr-up" style={{ ["--i" as string]: 1 }}>Rate calculator for<br /><span>franchise &amp; bulk shippers.</span></h1>
          <p className="fr-lead fr-up" style={{ ["--i" as string]: 2 }}>Check your exact shipping price for any route — prepaid or COD — across 20+ courier partners. Built for:</p>
          <ul className="fr-aud fr-up" style={{ ["--i" as string]: 3 }}>
            {AUDIENCE.map(({ icon: Icon, label }) => <li key={label}><Icon size={16} /> {label}</li>)}
          </ul>
          <nav className="fr-jump fr-up" style={{ ["--i" as string]: 4 }} aria-label="On this page">
            <a href="#calculator">Rate calculator</a><a href="#features">Features</a><a href="#integrations">Integrations</a><a href="#price-list">Price list</a>
          </nav>
        </div>
      </section>

      <section className="w-sec fr-calc-sec" id="calculator">
        <div className="w-wrap">
          <div className="fr-calc-card" data-reveal>
            <div className="fr-calc-h">
              <span className="w-eyebrow">Rate calculator</span>
              <h2 className="w-h2">Know your partner rate. Before you ship.</h2>
              <p className="w-lead">Enter pincodes and box details. Choose <b>COD</b> to see the price including the COD charge.</p>
            </div>
            {c.features.calculator
              ? <RateCalcV3 logos={logos} signedIn={!!auth.customer} loginHref={accountHref(c.links.customerLogin, "/login/")} endpoint="/api/franchise-rate-list/rates" />
              : <p className="w-card" role="status" style={{ padding: 24 }}>{c.features.unavailableText}</p>}
          </div>
        </div>
      </section>

      <section className="w-sec fr-feat-sec" id="features">
        <div className="w-wrap">
          <span className="w-eyebrow">Everything you get</span>
          <h2 className="w-h2">More than shipping. A complete growth toolkit.</h2>
          <FeatureShowcase />
        </div>
      </section>

      <div className="w-wrap">
        <div className="vs-cta fr-cta" data-reveal>
          <div style={{ position: "relative", zIndex: 1 }}>
            <span className="w-eyebrow">Become a partner</span>
            <h2>Let’s grow together.</h2>
            <p>Talk to our partner team about volumes, onboarding and your brand website.</p>
          </div>
          <div className="row wrap" style={{ gap: 12, position: "relative", zIndex: 1 }}>
            <a className="w-btn pri" href={wa} target="_blank" rel="noreferrer">WhatsApp us <ArrowRight size={18} /></a>
            <a className="w-btn ghost fr-btn-ghost" href={accountHref(c.links.signUp, "/signup/")}>Create account</a>
          </div>
        </div>
      </div>

      <section className="w-sec fr-price-sec" id="price-list">
        <div className="w-wrap">
          <span className="w-eyebrow">Shipping price list</span>
          <h2 className="w-h2">Zone-wise shipping rates.</h2>
          <FranchiseRateChart card={s.card} marginBps={s.marginBps} />
        </div>
      </section>
    </div>
  );
}
