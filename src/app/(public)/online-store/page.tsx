import Link from "next/link";
import {
  ArrowRight, BadgeCheck, BadgeIndianRupee, Ban, Bike, Check, CircleDollarSign, Clock3, CreditCard, Globe, Headphones, Instagram, Landmark, Megaphone,
  MessageCircle, MessagesSquare, Package, PackageCheck, Palette, PhoneCall, Rocket, Search, ShieldCheck, ShoppingBag, Smartphone, Store, Truck, Undo2, UserRound, Wallet,
} from "lucide-react";
import { THEMES } from "@/lib/store-themes";
import { StoreHelpForm } from "@/components/site/StoreHelpForm";
import { siteAuth } from "@/server/site/auth";
import "@/styles/growth.css";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("/online-store/", "Growth Package: Online Store, Ads & Shipping — Vishwaship", "We build your online store, run your Meta & Google ads, make your Instagram & Facebook creatives and ship every order from ₹28. ₹0 monthly fee — 1.5% only on delivered orders. Refundable ₹2,499 + GST deposit.");

const FEATURES = [
  { icon: Store, t: "Your online store", d: "Built for you — your brand, products, cart, COD and online payments." },
  { icon: Megaphone, t: "Meta & Google Ads", d: "Our team plans, runs and reports your campaigns." },
  { icon: Instagram, t: "Instagram & Facebook creatives", d: "Posts and ad creatives made for your products.", nv: true },
  { icon: Truck, t: "Shipping from ₹28", d: "Pan-India couriers, lowest rate first, labels and pickup.", tag: "₹28" },
  { icon: MessageCircle, t: "WhatsApp COD confirmation", d: "Buyers confirm COD orders on WhatsApp — fewer fake orders.", nv: true },
  { icon: PhoneCall, t: "NDR calling", d: "We call buyers when a delivery fails and re-attempt." },
  { icon: Clock3, t: "24×7 NDR support team", d: "A team watching undelivered orders round the clock.", nv: true, tag: "24×7" },
  { icon: UserRound, t: "Dedicated account manager", d: "One person who knows your business." },
  { icon: MessagesSquare, t: "WhatsApp support group", d: "Talk to our team any time, in one group.", nv: true },
  { icon: CreditCard, t: "Your own Razorpay", d: "Prepaid money goes straight to your account." },
  { icon: Wallet, t: "COD paid in D+5", d: "COD cash reaches you within 5 days of delivery.", nv: true, tag: "D+5" },
  { icon: Package, t: "Orders, stock & P&L", d: "Process orders, inventory and profit in one dashboard." },
];

const FAQ = [
  ["Is there a monthly fee?", "No. You pay a refundable security deposit of ₹2,499 + GST once. After that we earn only 1.5% + GST on orders that are delivered."],
  ["What if an order comes back (RTO) or is cancelled?", "No fee. The 1.5% is charged only on delivered orders. RTO shipping is charged as per your courier rate."],
  ["How do I get my money?", "Prepaid: buyers pay into your own Razorpay account, so the money is yours at once (the 1.5% on delivered prepaid orders is taken from your Vishwaship wallet). COD: we deduct 1.5% + GST and pay the rest within 5 days of delivery (D+5)."],
  ["Who pays for the ads?", "You pay the ad budget directly to Meta / Google in your own ad account — minimum ₹1,000 a day. Vishwaship never takes your ad money."],
  ["When can I get the deposit back?", "Give us at least 3 months to grow your account. After that you can end the service and ask for the deposit back from your dashboard."],
  ["How do I pay the deposit?", "Online with Razorpay (UPI, card, net banking) from your dashboard → Online Store → Growth Package."],
];

export default async function OnlineStoreLanding() {
  const auth = await siteAuth().catch(() => ({ customer: null, staff: null }));
  const start = auth.customer ? "/portal/store/managed-ads/" : "/signup/?next=/portal/store/managed-ads/";
  return (
    <div className="gp">
      {/* hero */}
      <section className="gp-hero" aria-labelledby="gp-h">
        <div className="gp-wrap">
          <div>
            <span className="gp-eye"><Rocket size={16} aria-hidden="true" /> Vishwaship Growth Package</span>
            <h1 id="gp-h">Your brand online. <em>We grow it.</em></h1>
            <p>Website + Ads + Creatives + Shipping — one team, one dashboard.</p>
            <div className="gp-pills">
              <span className="gp-pill"><BadgeIndianRupee size={15} aria-hidden="true" />₹0 monthly fee</span>
              <span className="gp-pill"><PackageCheck size={15} aria-hidden="true" />1.5% only on delivered</span>
              <span className="gp-pill"><Truck size={15} aria-hidden="true" />Shipping from ₹28</span>
            </div>
            <div className="gp-btns">
              <Link className="gp-btn or" href={start}>Start now <ArrowRight size={18} aria-hidden="true" /></Link>
              <a className="gp-btn wh" href="/s/demo/" target="_blank" rel="noopener"><ShoppingBag size={18} aria-hidden="true" />View demo store</a>
            </div>
          </div>
          <div className="gp-vis" aria-hidden="true">
            <div className="gp-phone">
              <div className="bar">Your Brand</div>
              <div className="img"><ShoppingBag size={46} /></div>
              <div className="ln" /><div className="ln s" />
              <div className="buy">Buy now</div>
              <div className="ln" /><div className="ln s" />
            </div>
            <div className="gp-chip c1"><span className="ic"><ShoppingBag size={17} /></span><span>New order ₹1,299<small>from Instagram ad</small></span></div>
            <div className="gp-chip c2"><span className="ic"><MessageCircle size={17} /></span><span>COD confirmed<small>on WhatsApp</small></span></div>
            <div className="gp-chip c3"><span className="ic"><Bike size={17} /></span><span>Out for delivery<small>via best courier</small></span></div>
            <div className="gp-chip c4"><span className="ic"><BadgeCheck size={17} /></span><span>Delivered ✓<small>COD paid D+5</small></span></div>
          </div>
        </div>
      </section>

      {/* numbers */}
      <div className="gp-wrap">
        <div className="gp-stats">
          <div className="gp-stat"><b>₹0</b><span>Monthly fee</span></div>
          <div className="gp-stat"><b>1.5%</b><span>Only on delivered</span></div>
          <div className="gp-stat"><b>₹28</b><span>Shipping starts</span></div>
          <div className="gp-stat"><b>D+5</b><span>COD payout</span></div>
          <div className="gp-stat"><b>24×7</b><span>NDR support</span></div>
        </div>
      </div>

      {/* everything included */}
      <section className="gp-sec" aria-labelledby="gp-all">
        <div className="gp-wrap gp-center">
          <span className="gp-eye">Everything included</span>
          <h2 id="gp-all" className="gp-h2">We work like your digital marketing agency + shipping partner</h2>
          <div className="gp-grid" style={{ textAlign: "left" }}>
            {FEATURES.map((f) => (
              <div key={f.t} className={`gp-tile${f.nv ? " nv" : ""}`}>
                {f.tag && <span className="gp-tag">{f.tag}</span>}
                <div className="ic"><f.icon size={26} aria-hidden="true" /></div>
                <h3>{f.t}</h3><p>{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* money flow */}
      <section className="gp-sec alt" aria-labelledby="gp-money">
        <div className="gp-wrap gp-center">
          <span className="gp-eye">How you get paid</span>
          <h2 id="gp-money" className="gp-h2">We earn only when your order is delivered</h2>
          <div className="gp-flows" style={{ textAlign: "left" }}>
            <div className="gp-flow">
              <h3><span className="b" style={{ background: "#1d3a8a" }}>PREPAID</span>Online payment</h3>
              <div className="gp-steps">
                <div className="gp-node"><span className="ic"><Smartphone size={18} aria-hidden="true" /></span>Buyer pays online</div>
                <div className="gp-arrow" aria-hidden="true" />
                <div className="gp-node"><span className="ic"><Landmark size={18} aria-hidden="true" /></span><span>Money goes to <b>your Razorpay</b></span></div>
                <div className="gp-arrow" aria-hidden="true" />
                <div className="gp-node ok"><span className="ic"><PackageCheck size={18} aria-hidden="true" /></span>Delivered → 1.5% + GST from wallet</div>
              </div>
            </div>
            <div className="gp-flow">
              <h3><span className="b" style={{ background: "#C94A0A" }}>COD</span>Cash on delivery</h3>
              <div className="gp-steps">
                <div className="gp-node"><span className="ic"><MessageCircle size={18} aria-hidden="true" /></span>Buyer confirms on WhatsApp</div>
                <div className="gp-arrow" aria-hidden="true" />
                <div className="gp-node"><span className="ic"><Truck size={18} aria-hidden="true" /></span>Delivered, cash collected</div>
                <div className="gp-arrow" aria-hidden="true" />
                <div className="gp-node ok"><span className="ic"><CircleDollarSign size={18} aria-hidden="true" /></span><span>You get COD − 1.5% in <b>D+5</b></span></div>
              </div>
            </div>
            <div className="gp-flow">
              <h3><span className="b" style={{ background: "#15803d" }}>₹0</span>No delivery, no fee</h3>
              <div className="gp-steps">
                <div className="gp-node zero"><span className="ic"><Undo2 size={18} aria-hidden="true" /></span>RTO — returned to you: ₹0 fee</div>
                <div className="gp-node zero"><span className="ic"><Ban size={18} aria-hidden="true" /></span>Cancelled order: ₹0 fee</div>
                <div className="gp-node zero"><span className="ic"><BadgeIndianRupee size={18} aria-hidden="true" /></span>No monthly fee: ₹0</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* steps */}
      <section className="gp-sec" aria-labelledby="gp-steps">
        <div className="gp-wrap gp-center">
          <span className="gp-eye">Go live in 5 steps</span>
          <h2 id="gp-steps" className="gp-h2">From sign-up to sales</h2>
          <div className="gp-time">
            {[[ShieldCheck, "Pay deposit", "₹2,499 + GST, refundable — Razorpay"], [Globe, "We build your store", "Your brand, products and payments"], [Megaphone, "Ads go live", "Meta & Google, from ₹1,000 a day"],
              [Truck, "Orders ship", "WhatsApp COD confirm, best courier"], [Wallet, "You get paid", "Prepaid instantly · COD in D+5"]].map(([Icon, t, d]) => {
              const I = Icon as typeof ShieldCheck;
              return <div key={t as string} className="gp-tstep"><div className="n"><I size={26} aria-hidden="true" /></div><div><h3>{t as string}</h3><p>{d as string}</p></div></div>;
            })}
          </div>
        </div>
      </section>

      {/* pricing */}
      <section className="gp-sec alt" id="gp-price" aria-labelledby="gp-p">
        <div className="gp-wrap" style={{ maxWidth: 980 }}>
          <div className="gp-center"><span className="gp-eye">Pricing</span><h2 id="gp-p" className="gp-h2">Simple and fair</h2></div>
          <div className="gp-price">
            <div className="l">
              <span className="gp-eye" style={{ color: "#FFB48A" }}>Refundable security deposit</span>
              <div className="big">₹2,499 <span style={{ fontSize: 20, fontWeight: 500 }}>+ GST</span></div>
              <div className="sub">One time · ₹0 monthly fee</div>
              <div className="fee"><b>1.5%</b> <span style={{ color: "#fff" }}>+ GST only on delivered orders</span><div style={{ color: "#dbe6ff", fontSize: 13.5, marginTop: 4 }}>No fee on RTO or cancelled orders</div></div>
              <div className="gp-btns"><Link className="gp-btn or" href={start}>Pay with Razorpay <ArrowRight size={18} aria-hidden="true" /></Link></div>
            </div>
            <div className="r">
              <ul>
                <li><Check size={18} aria-hidden="true" />Online store website built &amp; managed</li>
                <li><Check size={18} aria-hidden="true" />Meta &amp; Google Ads run by our team</li>
                <li><Check size={18} aria-hidden="true" />Instagram &amp; Facebook creatives</li>
                <li><Check size={18} aria-hidden="true" />Shipping from ₹28, pan-India</li>
                <li><Check size={18} aria-hidden="true" />WhatsApp COD confirmation &amp; NDR calling</li>
                <li><Check size={18} aria-hidden="true" />24×7 NDR team, account manager, WhatsApp group</li>
                <li className="c"><Clock3 size={18} aria-hidden="true" />Minimum 3 months to grow your account</li>
                <li className="c"><Megaphone size={18} aria-hidden="true" />Minimum ad budget ₹1,000 / day — paid by you to Meta / Google</li>
                <li className="c"><ShieldCheck size={18} aria-hidden="true" />Deposit refundable after 3 months when you end the service</li>
              </ul>
              <p className="gp-note">We work with entrepreneurs ready to invest at least ₹1,000 a day in ads. Shipping is charged per order from your Vishwaship wallet at your courier rate.</p>
            </div>
          </div>
        </div>
      </section>

      {/* themes */}
      <section className="gp-sec" aria-labelledby="gp-themes">
        <div className="gp-wrap">
          <div className="gp-center"><span className="gp-eye"><Palette size={15} aria-hidden="true" /> Store designs</span><h2 id="gp-themes" className="gp-h2">Start with a design you like</h2></div>
          <div className="gp-grid">
            {THEMES.map((t) => (
              <a key={t.key} className="gp-tile" href={`/s/demo/?theme=${t.key}`} target="_blank" rel="noopener" style={{ display: "block", textDecoration: "none" }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>{Object.entries(t.config.colors).map(([k, c]) => <span key={k} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: "1px solid rgba(0,0,0,.12)" }} />)}</div>
                <h3>{t.name}</h3><p>{t.tagline}</p>
                <span style={{ color: "#C94A0A", fontWeight: 700, fontSize: 14 }}>Preview <ArrowRight size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /></span>
              </a>
            ))}
          </div>
          <p style={{ marginTop: 14, color: "#3d4b66", fontSize: 14 }}><Search size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> SEO-ready, works on phones, tablets and computers. Connect your own domain any time.</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="gp-sec alt" aria-labelledby="gp-faq">
        <div className="gp-wrap">
          <div className="gp-center"><span className="gp-eye">Questions</span><h2 id="gp-faq" className="gp-h2">Good to know</h2></div>
          <div className="gp-faq">
            {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </div>
      </section>

      {/* help */}
      <section className="gp-sec" id="help" aria-labelledby="gp-help">
        <div className="gp-wrap" style={{ maxWidth: 720 }}>
          <div className="gp-center"><span className="gp-eye"><Headphones size={15} aria-hidden="true" /> Talk to us</span><h2 id="gp-help" className="gp-h2">We&apos;ll call you back</h2>
            <p className="gp-lead">Share your details and our team will explain the package and set up your store.</p></div>
          <div style={{ marginTop: 20 }}><StoreHelpForm /></div>
        </div>
      </section>
    </div>
  );
}
