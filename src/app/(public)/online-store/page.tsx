import { ArrowRight, BadgeIndianRupee, Check, Globe, Instagram, LayoutTemplate, Megaphone, PackageCheck, Palette, Search, ShoppingCart, Smartphone, Truck } from "lucide-react";
import Link from "next/link";
import { THEMES } from "@/lib/store-themes";
import { StoreHelpForm } from "@/components/site/StoreHelpForm";
import { siteAuth } from "@/server/site/auth";

export const metadata = {
  title: "Complete E-commerce Solution — Vishwaship",
  description: "Your own online store built for you, shipping on every order, and your Meta, Google, Instagram and Facebook handled by our team. ₹2,499 + GST a month and 1.5% only on delivered orders.",
  alternates: { canonical: "/online-store/" },
};

export default async function OnlineStoreLanding() {
  const auth = await siteAuth().catch(() => ({ customer: null, staff: null }));
  const start = auth.customer ? "/portal/store/" : "/signup/?next=/portal/store/";
  return (
    <>
      <section className="w-sec" style={{ paddingTop: 56 }} aria-labelledby="os-h">
        <div className="w-wrap" style={{ maxWidth: 960, textAlign: "center" }}>
          <span className="w-eyebrow">Complete e-commerce solution</span>
          <h1 id="os-h" className="w-h2" style={{ fontSize: "clamp(32px,5vw,54px)" }}>Your online business, fully handled</h1>
          <p className="w-lead" style={{ margin: "0 auto", maxWidth: 680 }}>We build your website, ship every order and run your Meta &amp; Google ads and your Instagram &amp; Facebook pages. ₹2,499 + GST a month, and 1.5% only on orders that get delivered.</p>
          <div className="w-btns" style={{ justifyContent: "center", marginTop: 24 }}>
            <Link className="w-btn pri" href={start}>Start 15-Day Free Trial <ArrowRight size={18} aria-hidden="true" /></Link>
            <a className="w-btn sec" href="/s/demo/" target="_blank" rel="noopener">View Demo Store</a>
            <a className="w-btn sec" href="#help">Request help</a>
          </div>
          <p className="small" style={{ marginTop: 12, color: "var(--mut)" }}>No credit card needed. Your store link works from day one; connect your own domain any time.</p>
        </div>
      </section>

      <section className="w-sec" aria-labelledby="os-get">
        <div className="w-wrap">
          <span className="w-eyebrow">What you get</span>
          <h2 id="os-get" className="w-h2">One team for your whole online business</h2>
          <div className="w-grid4">
            <div className="w-feat"><div className="ic"><Globe size={22} aria-hidden="true" /></div><h3 className="w-h3">We build your website</h3><p>Your own store with your brand, products, cart, Cash on Delivery and online payments, ready on phone and computer.</p></div>
            <div className="w-feat"><div className="ic"><Truck size={22} aria-hidden="true" /></div><h3 className="w-h3">Shipping on every order</h3><p>Rates from all our courier partners, lowest first. Book, print labels, pickup, tracking, COD and RTO in one place.</p></div>
            <div className="w-feat"><div className="ic"><Megaphone size={22} aria-hidden="true" /></div><h3 className="w-h3">Meta &amp; Google Ads handled</h3><p>Our team plans, runs and reports your Facebook, Instagram and Google ad campaigns.</p></div>
            <div className="w-feat"><div className="ic"><Instagram size={22} aria-hidden="true" /></div><h3 className="w-h3">Instagram &amp; Facebook handled</h3><p>We manage your business pages so buyers find you and reach your store.</p></div>
          </div>
        </div>
      </section>

      <section className="w-sec" aria-labelledby="os-price">
        <div className="w-wrap" style={{ maxWidth: 720 }}>
          <span className="w-eyebrow">Pricing</span>
          <h2 id="os-price" className="w-h2">Simple pricing</h2>
          <div className="w-feat" style={{ padding: 24 }}>
            <p style={{ margin: 0, color: "#0b1f4b" }}><b style={{ fontSize: 36, color: "var(--navy, #0b1f4b)" }}>₹2,499</b> <span>+ GST / month</span></p>
            <p style={{ margin: "6px 0 14px", color: "#C94A0A" }}><b>+ 1.5% (+ GST) only on delivered orders</b></p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {["No charge on RTO or cancelled orders — you pay 1.5% only when an order is delivered",
                "Website building, store hosting and your own store link included",
                "Meta & Google Ads and Instagram & Facebook handled by our team",
                "Shipping charged per order at your courier rate, from your wallet",
                "15-day free trial — no credit card needed"].map((x) => (
                <li key={x} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><Check size={18} aria-hidden="true" style={{ flex: "none", color: "var(--green, #15803d)", marginTop: 2 }} /><span>{x}</span></li>
              ))}
            </ul>
            <p className="small" style={{ margin: "14px 0 0", color: "var(--mut)" }}>Your ad budget (the amount Meta or Google charges for showing your ads) is paid separately by you.</p>
            <div className="w-btns" style={{ marginTop: 16 }}><Link className="w-btn pri" href={start}>Start 15-Day Free Trial <ArrowRight size={18} aria-hidden="true" /></Link></div>
          </div>
        </div>
      </section>

      <section className="w-sec" aria-labelledby="os-how">
        <div className="w-wrap">
          <span className="w-eyebrow">How it works</span>
          <h2 id="os-how" className="w-h2">Live in 7 simple steps</h2>
          <div className="w-grid4">
            <div className="w-feat"><div className="ic"><LayoutTemplate size={22} aria-hidden="true" /></div><h3 className="w-h3">Name your store</h3><p>Pick a store name and link. Your progress saves as you go.</p></div>
            <div className="w-feat"><div className="ic"><Palette size={22} aria-hidden="true" /></div><h3 className="w-h3">Choose a theme</h3><p>Add your logo, colours and fonts. Edit sections and preview on desktop and mobile.</p></div>
            <div className="w-feat"><div className="ic"><ShoppingCart size={22} aria-hidden="true" /></div><h3 className="w-h3">Add products</h3><p>Photos, prices, stock and weight — weight is used for exact courier rates.</p></div>
            <div className="w-feat"><div className="ic"><BadgeIndianRupee size={22} aria-hidden="true" /></div><h3 className="w-h3">Set up checkout</h3><p>Cash on Delivery with your own fees and limits; online payments with your own Razorpay.</p></div>
            <div className="w-feat"><div className="ic"><Globe size={22} aria-hidden="true" /></div><h3 className="w-h3">Connect a domain</h3><p>Use the free store link or connect your own domain with step-by-step DNS help.</p></div>
            <div className="w-feat"><div className="ic"><Search size={22} aria-hidden="true" /></div><h3 className="w-h3">Get found</h3><p>SEO titles, descriptions and a sitemap for every published store.</p></div>
            <div className="w-feat"><div className="ic"><Truck size={22} aria-hidden="true" /></div><h3 className="w-h3">Ship every order</h3><p>Compare couriers, book, print labels and track — from the same dashboard.</p></div>
            <div className="w-feat"><div className="ic"><PackageCheck size={22} aria-hidden="true" /></div><h3 className="w-h3">Buyers track orders</h3><p>Order tracking on your own store, with WhatsApp COD confirmation.</p></div>
          </div>
        </div>
      </section>

      <section className="w-sec" aria-labelledby="os-themes">
        <div className="w-wrap">
          <span className="w-eyebrow">Themes</span>
          <h2 id="os-themes" className="w-h2">Start with a design you like</h2>
          <div className="w-grid4">
            {THEMES.map((t) => (
              <a key={t.key} className="w-feat" href={`/s/demo/?theme=${t.key}`} target="_blank" rel="noopener" style={{ display: "block" }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>{Object.entries(t.config.colors).map(([k, c]) => <span key={k} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: "1px solid rgba(0,0,0,.08)" }} />)}</div>
                <h3 className="w-h3">{t.name}</h3><p>{t.tagline}</p>
                <span className="small" style={{ color: "var(--o2, #f0712c)", fontWeight: 600 }}>Preview <ArrowRight size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /></span>
              </a>
            ))}
          </div>
          <p className="small" style={{ marginTop: 12, color: "var(--mut)" }}><Smartphone size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> Every theme works on phones, tablets and computers.</p>
        </div>
      </section>

      <section className="w-sec" id="help" aria-labelledby="os-help">
        <div className="w-wrap" style={{ maxWidth: 720 }}>
          <span className="w-eyebrow">Need help?</span>
          <h2 id="os-help" className="w-h2">We&apos;ll help you set up your store</h2>
          <p className="w-lead">Share your details and our team will call you back.</p>
          <StoreHelpForm />
        </div>
      </section>
    </>
  );
}
