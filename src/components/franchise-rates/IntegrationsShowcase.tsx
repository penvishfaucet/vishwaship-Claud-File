import { BarChart3, CheckCircle2, Code2, CreditCard, MousePointer2, Wallet, Zap } from "lucide-react";

/* Hub: "Your Brand" in the middle, each tool switches on in turn and data flows along the lines. */
const NODES = [
  { key: "rzp", name: "Razorpay", sub: "Payments", x: 120, y: 70, color: "#2b6cf6" },
  { key: "cf", name: "Cashfree", sub: "Payments", x: 120, y: 200, color: "#5a2ee6" },
  { key: "gk", name: "GoKwik", sub: "1-click checkout", x: 120, y: 330, color: "#0f9d74" },
  { key: "px", name: "Meta Pixel", sub: "Ads tracking", x: 780, y: 70, color: "#1877f2" },
  { key: "ga", name: "Google Analytics", sub: "GA4", x: 780, y: 200, color: "#f29900" },
  { key: "api", name: "Vishwaship API", sub: "Orders · AWB · tracking", x: 780, y: 330, color: "#f0712c" },
];
const CX = 450, CY = 200;
const path = (x: number, y: number) => {
  const sx = x < CX ? x + 95 : x - 95;
  const ex = x < CX ? CX - 92 : CX + 92;
  const mx = (sx + ex) / 2;
  return `M${sx} ${y} C${mx} ${y}, ${mx} ${CY}, ${ex} ${CY}`;
};

function IntegrationHub() {
  return (
    <div className="ih" aria-hidden="true">
      <svg className="ih-svg" viewBox="0 0 900 400" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="ihGlow"><stop offset="0" stopColor="#f0712c" stopOpacity=".35" /><stop offset="1" stopColor="#f0712c" stopOpacity="0" /></radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r="150" fill="url(#ihGlow)" className="ih-pulse" />
        {NODES.map((n, i) => (
          <g key={n.key} style={{ ["--i" as string]: i }}>
            <path d={path(n.x, n.y)} className="ih-line" />
            <path d={path(n.x, n.y)} className="ih-flow" style={{ stroke: n.color }} />
            <circle r="5" fill={n.color} className="ih-dot">
              <animateMotion dur={`${2.2 + (i % 3) * 0.4}s`} repeatCount="indefinite" path={path(n.x, n.y)} keyPoints={n.x < CX ? "0;1" : "1;0"} keyTimes="0;1" calcMode="linear" />
            </circle>
          </g>
        ))}
      </svg>
      <div className="ih-core">
        <span className="ih-ring" /><span className="ih-ring r2" />
        <b>YOUR<span>BRAND</span></b>
        <small>yourbrand.com</small>
      </div>
      {NODES.map((n, i) => (
        <div key={n.key} className={`ih-node ${n.x < CX ? "l" : "r"}`} style={{ left: `${(n.x / 900) * 100}%`, top: `${(n.y / 400) * 100}%`, ["--i" as string]: i, ["--c" as string]: n.color }}>
          <span className="ih-logo">{n.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
          <div className="ih-txt"><b>{n.name}</b><small>{n.sub}</small></div>
          <span className="ih-tog"><i /></span>
          <span className="ih-ok"><CheckCircle2 size={12} /> Connected</span>
        </div>
      ))}
    </div>
  );
}

/* One-click checkout: sheet slides up, details auto-fill, gateway is picked, cursor pays, success. */
function OneClickCheckout() {
  return (
    <div className="oc fr-phone" aria-hidden="true">
      <div className="fr-notch" />
      <div className="oc-screen">
        <div className="oc-top"><span className="br-logo sm">YOUR<b>BRAND</b></span><small>Cart · 1 item</small></div>
        <div className="oc-prod"><span className="oc-img" /><div><b>Cotton Kurta Set</b><small>Size M · Qty 1</small></div><b>₹1,299</b></div>
        <div className="oc-sheet">
          <div className="oc-grab" />
          <div className="oc-h"><Zap size={14} /> 1-click checkout</div>
          <div className="oc-row oc-f1"><small>Mobile</small><b>+91 98•••• 4210 ✓</b></div>
          <div className="oc-row oc-f2"><small>Address</small><b>12, MG Road, Jaipur 302001</b></div>
          <div className="oc-pay">
            <span className="oc-gw g1">Razorpay</span>
            <span className="oc-gw g2">Cashfree</span>
            <span className="oc-gw g3">GoKwik</span>
          </div>
          <div className="oc-btn">Pay ₹1,299 <MousePointer2 className="fr-cursor oc-cursor" size={24} /><span className="fr-tap oc-tap" /></div>
        </div>
        <div className="oc-done">
          <span className="oc-check"><CheckCircle2 size={44} /></span>
          <b>Order placed!</b>
          <small>Shipping with Vishwaship · AWB generated</small>
          <span className="oc-conf">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ ["--a" as string]: `${i * 30}deg` }} />)}</span>
        </div>
      </div>
    </div>
  );
}

/* Live tracking events reaching the brand's own Meta Pixel and GA4. */
const EVENTS = [
  { src: "Meta Pixel", ev: "Purchase · ₹1,299", c: "#1877f2" },
  { src: "GA4", ev: "purchase · ₹1,299", c: "#f29900" },
  { src: "Meta Pixel", ev: "InitiateCheckout", c: "#1877f2" },
  { src: "GA4", ev: "add_to_cart", c: "#f29900" },
  { src: "Meta Pixel", ev: "ViewContent", c: "#1877f2" },
];
function LiveEvents() {
  return (
    <div className="le" aria-hidden="true">
      <div className="le-h"><span className="le-live"><i /> LIVE</span><b>Your tracking events</b></div>
      <div className="le-bars">{[38, 52, 44, 66, 58, 80, 72, 94].map((h, i) => <i key={i} style={{ ["--h" as string]: `${h}%`, ["--i" as string]: i }} />)}</div>
      <ul className="le-list">
        {EVENTS.map((e, i) => (
          <li key={i} style={{ ["--i" as string]: i, ["--c" as string]: e.c }}>
            <span className="le-src">{e.src}</span><span>{e.ev}</span><CheckCircle2 size={14} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* API: request typed out, then the response with the AWB. */
function ApiDemo() {
  return (
    <div className="api" aria-hidden="true">
      <div className="api-bar"><i /><i /><i /><span>vishwaship-api</span></div>
      <pre>
        <span className="api-l l1"><em className="m">POST</em> /api/v1/orders</span>
        <span className="api-l l2">{"{"} <em className="k">&quot;pickup&quot;</em>: <em className="s">&quot;302001&quot;</em>,</span>
        <span className="api-l l3">{"  "}<em className="k">&quot;delivery&quot;</em>: <em className="s">&quot;411001&quot;</em>,</span>
        <span className="api-l l4">{"  "}<em className="k">&quot;payment&quot;</em>: <em className="s">&quot;cod&quot;</em>, <em className="k">&quot;weightKg&quot;</em>: <em className="n">0.8</em> {"}"}</span>
        <span className="api-l l5 ok">← 201 Created</span>
        <span className="api-l l6">{"{"} <em className="k">&quot;awb&quot;</em>: <em className="s">&quot;14829301&quot;</em>, <em className="k">&quot;status&quot;</em>: <em className="s">&quot;booked&quot;</em> {"}"}</span>
        <span className="api-l l7 hook">⚡ webhook · shipment.delivered</span>
      </pre>
    </div>
  );
}

export function IntegrationsShowcase() {
  return (
    <div className="fr-int" id="integrations" data-reveal>
      <div className="fr-int-h">
        <span className="fr-pill"><Zap size={14} /> Bring your own tools</span>
        <h3>Your payments. Your pixels. Your checkout.</h3>
        <p>Connect the tools you already use — we provide everything through simple settings and our API.</p>
      </div>
      <IntegrationHub />
      <div className="fr-int-grid">
        <div className="fr-int-card" style={{ ["--i" as string]: 0 }}>
          <OneClickCheckout />
          <div className="fr-int-cap"><CreditCard size={18} /><div><b>One-click checkout</b><small>Razorpay, Cashfree or GoKwik — your own account</small></div></div>
        </div>
        <div className="fr-int-card" style={{ ["--i" as string]: 1 }}>
          <LiveEvents />
          <div className="fr-int-cap"><BarChart3 size={18} /><div><b>Meta Pixel &amp; Google Analytics</b><small>Every view, cart and purchase tracked</small></div></div>
          <div className="fr-int-mini"><Wallet size={16} /><span>Payments settle straight to <b>your</b> gateway account</span></div>
        </div>
        <div className="fr-int-card" style={{ ["--i" as string]: 2 }}>
          <ApiDemo />
          <div className="fr-int-cap"><Code2 size={18} /><div><b>Full API &amp; webhooks</b><small>Rates, orders, labels, tracking — all by API</small></div></div>
        </div>
      </div>
    </div>
  );
}
