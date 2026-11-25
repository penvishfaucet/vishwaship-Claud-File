import {
  BarChart3, Bot, CheckCheck, CreditCard, FileSpreadsheet, Globe, Lock, Mail, MapPin, MousePointer2, Package, PhoneCall,
  Plug, Scale, ShieldCheck, Store, Truck, Wallet, Webhook,
} from "lucide-react";
import { CARRIERS } from "@/lib/site";
import { IntegrationsShowcase } from "./IntegrationsShowcase";

/* ------------------------------------------------------------------ */
/* COD confirmation: WhatsApp chat, a cursor taps "Confirm order".     */
/* ------------------------------------------------------------------ */
function CodConfirmDemo() {
  return (
    <div className="fr-phone" aria-hidden="true">
      <div className="fr-notch" />
      <div className="wa-top">
        <span className="wa-av"><img src="/brand/logo-icon.png" alt="" /></span>
        <div><b>Vishwaship <CheckCheck size={12} className="wa-tick" /></b><small>Business account</small></div>
      </div>
      <div className="wa-body">
        <div className="wa-day">TODAY</div>
        <div className="wa-in cod-a1">
          <b>COD order confirmation 📦</b>
          <p>Hi Priya, your order <b>#YB20418</b> from <b>Your Brand</b> for <b>₹1,299 (Cash on Delivery)</b> is ready to ship.</p>
          <p>Please confirm so we can dispatch it today.</p>
          <span className="wa-time">10:42</span>
        </div>
        <div className="wa-btns cod-a1">
          <span className="wa-btn cod-yes">✅ Confirm order</span>
          <span className="wa-btn">❌ Cancel order</span>
          <MousePointer2 className="fr-cursor cod-cursor" size={26} />
          <span className="fr-tap cod-tap" />
        </div>
        <div className="wa-out cod-a2">✅ Confirm order<span className="wa-time">10:43 <CheckCheck size={12} /></span></div>
        <div className="wa-in cod-a3"><p>Thank you! 🎉 Your order is <b>confirmed</b> and will be shipped today. 🚚</p><span className="wa-time">10:43</span></div>
      </div>
      <div className="wa-input"><span>Message</span></div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* NDR AI calling: live call + transcript resolving a failed delivery. */
/* ------------------------------------------------------------------ */
function NdrAiDemo() {
  return (
    <div className="fr-ndr" aria-hidden="true">
      <div className="fr-phone dark">
        <div className="fr-notch" />
        <div className="call">
          <small className="call-lbl">Vishwaship AI · NDR call</small>
          <div className="call-av"><span className="ring r1" /><span className="ring r2" /><Bot size={34} /></div>
          <b>Calling Rahul S.</b>
          <small className="call-time">AWB 14829301 · 00:38</small>
          <div className="wave">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ ["--d" as string]: `${(i % 6) * 0.12}s` }} />)}</div>
          <div className="call-btns"><span className="cb mute" /><span className="cb end"><PhoneCall size={18} /></span><span className="cb spk" /></div>
        </div>
      </div>
      <div className="ndr-log">
        <div className="ndr-chip"><Truck size={14} /> Delivery failed · Customer not available</div>
        <div className="ndr-msg ai n1"><Bot size={14} /> Namaste Rahul ji, aapka parcel aaj deliver nahi ho paaya. Kya hum kal dobara bhej dein?</div>
        <div className="ndr-msg cu n2">Haan, kal 11 baje ke baad bhej dijiye.</div>
        <div className="ndr-msg ai n3"><Bot size={14} /> Done! Kal 11 AM ke baad re-attempt schedule ho gaya hai.</div>
        <div className="ndr-ok n4"><CheckCheck size={16} /> NDR resolved · Re-attempt booked automatically</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Branded website: your logo, checkout, pixel, analytics, Razorpay.   */
/* ------------------------------------------------------------------ */
function BrandSiteDemo() {
  return (
    <div className="fr-site" aria-hidden="true">
      <div className="br-win">
        <div className="br-bar"><i /><i /><i /><span className="br-url"><Lock size={11} /> www.yourbrand.com</span></div>
        <div className="br-nav"><span className="br-logo">YOUR<b>BRAND</b></span><span className="br-links"><i /><i /><i /></span><span className="br-cart">Cart · 2</span></div>
        <div className="br-hero"><div><b>New collection</b><small>Free shipping across India</small><span className="br-cta">Shop now</span></div><div className="br-art" /></div>
        <div className="br-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="br-prod" style={{ ["--i" as string]: i }}><span /><i /><b>₹{[899, 1299, 649, 1499][i]}</b></div>)}</div>
        <div className="br-checkout"><b>Checkout</b><span>Pay with <CreditCard size={12} /> Razorpay</span><span className="br-pay">Pay ₹2,198</span></div>
      </div>
      <span className="fr-badge b1"><Store size={14} /> Your logo &amp; brand</span>
      <span className="fr-badge b2"><CreditCard size={14} /> 1-click checkout</span>
      <span className="fr-badge b3"><BarChart3 size={14} /> Your Meta Pixel</span>
      <span className="fr-badge b4"><Globe size={14} /> Your Google Analytics</span>
      <div className="fr-mail">
        <Mail size={16} />
        <div><small>From: <b>Your Brand</b> &lt;orders@yourbrand.com&gt;</small><b>Your order has shipped! 🚚</b><small>Track it live · AWB 14829301</small></div>
      </div>
    </div>
  );
}

const MORE = [
  { icon: Truck, title: "Doorstep pickup", sub: "Pan-India, every day" },
  { icon: MapPin, title: "Live tracking", sub: "Branded tracking page" },
  { icon: FileSpreadsheet, title: "Bulk upload", sub: "Excel → 500 orders" },
  { icon: Plug, title: "Store integrations", sub: "Shopify · WooCommerce" },
  { icon: Wallet, title: "Fast COD remittance", sub: "Straight to your wallet" },
  { icon: Scale, title: "Weight disputes", sub: "We fight them for you" },
  { icon: Webhook, title: "API & webhooks", sub: "Plug into any system" },
  { icon: ShieldCheck, title: "Secure & audited", sub: "KYC-verified accounts" },
];

export function FeatureShowcase() {
  return (
    <>
      <div className="fr-feat" data-reveal>
        <div className="fr-feat-txt">
          <span className="fr-pill"><Package size={14} /> COD confirmation</span>
          <h3>Stop fake COD orders before they ship.</h3>
          <p>Every COD order gets an automatic WhatsApp confirmation. The customer taps once — confirmed orders ship, cancelled ones never leave your warehouse.</p>
          <ul className="fr-ticks"><li>Fewer RTOs</li><li>Your brand name in the message</li><li>Works on every COD order</li></ul>
        </div>
        <CodConfirmDemo />
      </div>

      <div className="fr-feat rev" data-reveal>
        <div className="fr-feat-txt">
          <span className="fr-pill"><Bot size={14} /> NDR AI calling</span>
          <h3>Our AI calls your customer when a delivery fails.</h3>
          <p>Missed delivery? Our AI agent calls the buyer in Hindi or English, gets a new time or address and books the re-attempt — automatically.</p>
          <ul className="fr-ticks"><li>Calls within minutes</li><li>Hindi + English</li><li>Re-attempt booked for you</li></ul>
        </div>
        <NdrAiDemo />
      </div>

      <div className="fr-feat" data-reveal>
        <div className="fr-feat-txt">
          <span className="fr-pill"><Globe size={14} /> Your own website</span>
          <h3>We build your brand a complete website.</h3>
          <p>Your logo, your products, your checkout. Connect your own payment gateway and marketing tools — shipping runs on Vishwaship in the background.</p>
          <ul className="fr-ticks"><li>One-click checkout: Razorpay, Cashfree or GoKwik</li><li>Your Meta Pixel &amp; Google Analytics</li><li>Order emails sent from your brand</li></ul>
        </div>
        <BrandSiteDemo />
      </div>

      <IntegrationsShowcase />

      <div className="fr-carriers" data-reveal aria-label="Courier partners">
        <div className="fr-marq">
          {[...CARRIERS, ...CARRIERS].map((c, i) => <img key={i} src={`/couriers/${c.code}.webp`} alt={i < CARRIERS.length ? c.name : ""} aria-hidden={i >= CARRIERS.length} />)}
        </div>
      </div>

      <div className="fr-more">
        {MORE.map(({ icon: Icon, title, sub }, i) => (
          <div key={title} className="fr-mini" data-reveal style={{ ["--i" as string]: i }}>
            <span className="fr-mini-ic"><Icon size={24} /></span>
            <b>{title}</b>
            <small>{sub}</small>
          </div>
        ))}
      </div>
    </>
  );
}
