import Link from "next/link";
import { ArrowRight, Bell, Boxes, Check, IndianRupee, MapPin, Package, PackageSearch, Scale, Truck, Warehouse } from "lucide-react";
import { HeroMedia } from "@/components/site/HeroMedia";
import { HeroCtas } from "@/components/site/HeroCtas";
import { siteAuth } from "@/server/site/auth";
import { PartnerCarousel } from "@/components/site/PartnerCarousel";
import { accountHref, completeMobile, safeHref, visiblePartners } from "@/lib/site-content";
import { b2bThresholdGrams, getSiteContent } from "@/server/site/content";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Vishwaship — Big & Small, We Ship It All",
  description: "Compare courier rates, book parcels and cargo, schedule pickups and track shipments across India with Vishwaship.",
};

export default async function HomePage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const sp = await searchParams;
  const c = await getSiteContent({ preview: sp.preview === "1" });
  const h = c.home;
  const partners = visiblePartners(c.partners);
  const kg = (await b2bThresholdGrams()) / 1000;
  const regions = c.team.members.filter((m) => m.visible && m.name.trim());
  const signup = accountHref(c.links.signUp, "/signup/");
  const auth = await siteAuth();
  return (
    <>
      <section className="w-hero4" aria-labelledby="hero-h">
        <HeroMedia video={h.heroVideoUrl} poster={h.heroPosterUrl} mobile={h.heroMobileUrl} />
        <div className="w-wrap in">
          <div className="txt">
            <h1 id="hero-h" className="w-slogan"><span>{h.heroLine1}</span><span className="o">{h.heroLine2}</span></h1>
            <p className="w-lead">{h.heroText}</p>
            <HeroCtas links={c.links} auth={auth} text={{ primary: h.primaryCta, signup: h.secondaryCta, login: h.loginCta, dashboard: h.dashboardCta, track: h.trackCta }} />
            {c.offers.visible && c.offers.showOnHome && h.highlights.length > 0 && (
              <div className="w-hl">
                <ul>{h.highlights.map((x, i) => <li key={i}><b>{x.big}</b><span>{x.small}</span></li>)}</ul>
                {h.highlightNote && <p>{h.highlightNote}</p>}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="w-strip"><div className="w-wrap"><PartnerCarousel partners={partners} heading={h.partnersHeading} strip /></div></div>

      <section className="w-sec alt" aria-labelledby="svc-h">
        <div className="w-wrap">
          <span className="w-eyebrow">Services</span>
          <h2 id="svc-h" className="w-h2">{h.servicesHeading}</h2>
          <div className="w-grid2">
            <article className="w-card w-svc">
              <span className="tag">B2C</span>
              <div className="ic"><Package size={26} aria-hidden="true" /></div>
              <h3 className="w-h3">{h.b2cTitle}</h3>
              <p>{h.b2cText}</p>
              <ul><li><Check size={16} aria-hidden="true" />Shipments under {kg} kg are matched to parcel services</li><li><Check size={16} aria-hidden="true" />Prepaid and COD where the courier supports it</li></ul>
              <Link className="more" href="/shipping-rate-calculator/">Check parcel rates <ArrowRight size={16} aria-hidden="true" /></Link>
            </article>
            <article className="w-card w-svc navy">
              <span className="tag">B2B</span>
              <div className="ic"><Truck size={26} aria-hidden="true" /></div>
              <h3 className="w-h3">{h.b2bTitle}</h3>
              <p>{h.b2bText}</p>
              <ul><li><Check size={16} aria-hidden="true" />{kg} kg and above are matched to cargo services</li><li><Check size={16} aria-hidden="true" />Multiple cartons per consignment</li></ul>
              <Link className="more" href="/shipping-rate-calculator/">Check cargo rates <ArrowRight size={16} aria-hidden="true" /></Link>
            </article>
          </div>
        </div>
      </section>

      <section className="w-sec" aria-labelledby="calc-h">
        <div className="w-wrap w-split">
          <div>
            <span className="w-eyebrow">Rate calculator</span>
            <h2 id="calc-h" className="w-h2">{h.calcHeading}</h2>
            <p className="w-lead">{h.calcText}</p>
          </div>
          <form className="w-card w-form" action="/shipping-rate-calculator/" method="get">
            <div className="w-row">
              <div className="w-fld"><label htmlFor="q-o">Pickup PIN code</label><input id="q-o" name="o" className="w-in" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} placeholder="e.g. 249402" required /></div>
              <div className="w-fld"><label htmlFor="q-d">Delivery PIN code</label><input id="q-d" name="d" className="w-in" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} placeholder="e.g. 400001" required /></div>
            </div>
            <div className="w-fld" style={{ marginTop: 14 }}><label htmlFor="q-w">Actual weight (kg)</label><input id="q-w" name="w" className="w-in" inputMode="decimal" placeholder="e.g. 2.5" required /><span className="hint">Under {kg} kg → B2C parcel · {kg} kg or more → B2B cargo</span></div>
            <button className="w-btn pri" style={{ width: "100%", marginTop: 18 }}>Compare rates <ArrowRight size={18} aria-hidden="true" /></button>
          </form>
        </div>
      </section>

      <section className="w-sec alt" aria-labelledby="jr-h">
        <div className="w-wrap">
          <span className="w-eyebrow">How it works</span>
          <h2 id="jr-h" className="w-h2">{h.journeyHeading}</h2>
          <div className="w-journey">
            <div className="w-road" aria-hidden="true">
              <div className="w-lane">
                <svg className="w-truck" viewBox="0 0 96 56" fill="none">
                  <rect x="2" y="8" width="56" height="34" rx="4" fill="#0b2c6a" />
                  <rect x="8" y="14" width="44" height="6" rx="2" fill="#f0712c" />
                  <path d="M58 18h18l14 14v10H58z" fill="#13294b" />
                  <path d="M62 22h12l9 9H62z" fill="#cfe0ff" />
                  <g className="wheel"><circle cx="20" cy="44" r="8" fill="#0b2c6a" /><circle cx="20" cy="44" r="3" fill="#fff" /></g>
                  <g className="wheel"><circle cx="74" cy="44" r="8" fill="#0b2c6a" /><circle cx="74" cy="44" r="3" fill="#fff" /></g>
                </svg>
              </div>
            </div>
            <ol className="w-steps" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              <li className="w-step"><span className="num">1</span><h3 className="w-h3"><Scale size={18} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--o)" }} />Compare rates</h3><p>Enter PIN codes and package details to see available courier options and prices.</p></li>
              <li className="w-step"><span className="num">2</span><h3 className="w-h3"><Package size={18} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--o)" }} />Book</h3><p>Choose a service and book from your account. Labels are generated for the courier.</p></li>
              <li className="w-step"><span className="num">3</span><h3 className="w-h3"><Truck size={18} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--o)" }} />Pickup</h3><p>Schedule a pickup from your saved warehouse address.</p></li>
              <li className="w-step"><span className="num">4</span><h3 className="w-h3"><PackageSearch size={18} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--o)" }} />Track</h3><p>Follow shipment status with the AWB number until delivery.</p></li>
            </ol>
          </div>
        </div>
      </section>

      <section className="w-sec dark" aria-labelledby="ft-h">
        <div className="w-wrap">
          <span className="w-eyebrow">Features</span>
          <h2 id="ft-h" className="w-h2">{h.featuresHeading}</h2>
          <div className="w-grid4">
            <div className="w-feat"><div className="ic"><Warehouse size={22} aria-hidden="true" /></div><h3 className="w-h3">Pickup warehouses</h3><p>Save multiple pickup addresses, verify them by OTP and choose one per shipment.</p></div>
            <div className="w-feat"><div className="ic"><MapPin size={22} aria-hidden="true" /></div><h3 className="w-h3">Shipment tracking</h3><p>Track by AWB, order ID or LR number, and share a tracking page with your buyers.</p></div>
            <div className="w-feat"><div className="ic"><IndianRupee size={22} aria-hidden="true" /></div><h3 className="w-h3">Cash on Delivery</h3><p>Offer COD on supported services and follow remittances from your account.</p></div>
            <div className="w-feat"><div className="ic"><Bell size={22} aria-hidden="true" /></div><h3 className="w-h3">WhatsApp notifications</h3><p>Subscription-based WhatsApp updates for your buyers, such as out-for-delivery alerts.</p></div>
          </div>
        </div>
      </section>

      <section className="w-sec" aria-labelledby="care-h">
        <div className="w-wrap w-split" style={{ alignItems: "start" }}>
          <div>
            <span className="w-eyebrow">Customer care</span>
            <h2 id="care-h" className="w-h2">{h.careHeading}</h2>
            <p className="w-lead">{h.careText}</p>
            <div className="w-btns"><Link className="w-btn navy" href="/customer-care/">Meet the support team <ArrowRight size={18} aria-hidden="true" /></Link></div>
          </div>
          <ul className="w-card" style={{ listStyle: "none", margin: 0, padding: 8 }}>
            {regions.map((m) => {
              const ph = completeMobile(m.phone);
              return (
                <li key={m.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 12px", borderBottom: "1px solid var(--ln)", flexWrap: "wrap" }}>
                  <span className="w-chip o" style={{ minWidth: 86, justifyContent: "center" }}>{m.region}</span>
                  <span style={{ flex: "1 1 160px", minWidth: 0 }}><b style={{ display: "block" }}>{m.name}</b><span style={{ fontSize: 13.5, color: "var(--mut)" }}>{m.role}</span></span>
                  {ph ? <a className="w-btn ghost sm" href={`tel:+91${ph}`} aria-label={`Call ${m.name}`}>Call</a> : <span style={{ fontSize: 13, color: "var(--mut)" }}>Number coming soon</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="w-sec tight" style={{ paddingTop: 0 }}>
        <div className="w-wrap">
          <div className="w-cta">
            <div><h2 className="w-h2" style={{ margin: 0 }}>{h.ctaTitle}</h2><p>{h.ctaText}</p></div>
            <div className="w-btns" style={{ marginTop: 0 }}>
              {auth.customer ? <Link className="w-btn pri" href="/portal/orders/new/">Create Shipment</Link> : <a className="w-btn pri" href={signup}>{h.secondaryCta}</a>}
              <Link className="w-btn sec" href="/shipping-rate-calculator/"><Boxes size={18} aria-hidden="true" />Calculate rates</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
