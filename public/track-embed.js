/*
 * Vishwaship branded tracking — put your tracking page on your own website.
 *   <div id="vishwaship-tracking"></div>
 *   <script src="https://vishwaship.in/track-embed.js" data-store="your-store" async></script>
 * Works on Shopify, WooCommerce / WordPress, Wix, Squarespace and any HTML page. Drawn inside your page (no iframe),
 * with your logo and colours; refreshes itself every minute while open. A link like yourpage?awb=1234567890
 * (or ?q= / ?order=) opens that shipment directly. Buyers can reach you (WhatsApp / call / email) or raise a request,
 * which arrives as an alert in your Vishwaship portal.
 */
(function () {
  var s = document.currentScript || document.querySelector('script[src*="track-embed.js"][data-store]');
  if (!s) return;
  var store = (s.getAttribute("data-store") || "").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  if (!store) return;
  var origin = new URL(s.src).origin;
  var holder = document.getElementById(s.getAttribute("data-target") || "vishwaship-tracking");
  if (!holder) { holder = document.createElement("div"); s.parentNode.insertBefore(holder, s); }

  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var color = function (v, d) { return /^#[0-9a-fA-F]{6}$/.test(v || "") ? v : d; };
  var day = function (iso) { try { return new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return ""; } };
  var when = function (iso) { try { return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
  var ago = function (iso) { var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
  var daysTo = function (iso) { return Math.ceil((new Date(iso).setHours(23, 59, 0, 0) - Date.now()) / 86400000); };
  var waNum = function (p) { var d = String(p || "").replace(/\D/g, ""); if (d.length === 10) d = "91" + d; return d.length >= 11 ? d : ""; };
  var DONE = ["delivered", "rto_delivered", "cancelled"];

  var STEPS = ["Order placed", "Picked up", "In transit", "Out for delivery", "Delivered"];
  var STEP_OF = { booked: 0, pickup_pending: 0, picked_up: 1, in_transit: 2, at_delivery_center: 2, reverse_in_transit: 2, out_for_delivery: 3, ndr: 3, delivered: 4, reverse_delivered: 4 };
  var HERO = {
    booked: ["box", "Your order is confirmed", "We are packing it and handing it to the courier."],
    pickup_pending: ["box", "Getting ready to ship", "The courier will pick up your parcel soon."],
    picked_up: ["truck", "Your parcel is on its way", "The courier has picked it up."],
    in_transit: ["truck", "On the move", "Your parcel is travelling to your city."],
    at_delivery_center: ["truck", "Almost there", "Your parcel has reached the delivery hub near you."],
    out_for_delivery: ["bike", "Out for delivery today", "Keep your phone handy — it arrives today."],
    ndr: ["alert", "We missed you", "The courier could not deliver. They will try again — keep your phone on, or ask us below."],
    delivered: ["done", "Delivered!", "Your parcel has been delivered. Enjoy!"],
    rto_initiated: ["back", "Returning to the seller", "This parcel is going back to the store."],
    rto_in_transit: ["back", "Returning to the seller", "This parcel is going back to the store."],
    rto_delivered: ["back", "Returned to the seller", "The parcel reached the store."],
    cancelled: ["alert", "Shipment cancelled", "Contact the store if you have questions."],
    lost: ["alert", "We are looking into it", "Please contact the store below."],
  };
  var ICON = {
    box: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 56 18v28L32 58 8 46V18Z" fill="var(--a)" opacity=".18"/><path d="M32 6 56 18 32 30 8 18Z" fill="var(--a)"/><path d="M8 18v28l24 12V30Z" fill="var(--p)"/><path d="M56 18v28L32 58V30Z" fill="var(--p)" opacity=".75"/></svg>',
    truck: '<svg viewBox="0 0 96 64" aria-hidden="true"><g class="vst-road"><rect x="0" y="56" width="96" height="3" rx="1.5" fill="#d7dde8"/><rect x="6" y="56.5" width="14" height="2" rx="1" fill="#fff"/><rect x="40" y="56.5" width="14" height="2" rx="1" fill="#fff"/><rect x="74" y="56.5" width="14" height="2" rx="1" fill="#fff"/></g><g class="vst-truck"><rect x="10" y="20" width="44" height="28" rx="4" fill="var(--a)"/><path d="M54 28h14l10 10v10H54Z" fill="var(--p)"/><rect x="58" y="31" width="10" height="7" rx="1.5" fill="#cfe3ff"/><circle cx="24" cy="50" r="6" fill="#1f2937"/><circle cx="24" cy="50" r="2.4" fill="#fff"/><circle cx="66" cy="50" r="6" fill="#1f2937"/><circle cx="66" cy="50" r="2.4" fill="#fff"/><rect x="2" y="26" width="6" height="2.5" rx="1.2" fill="var(--a)" opacity=".5"/><rect x="0" y="34" width="8" height="2.5" rx="1.2" fill="var(--a)" opacity=".35"/></g></svg>',
    bike: '<svg viewBox="0 0 96 64" aria-hidden="true"><g class="vst-road"><rect x="0" y="56" width="96" height="3" rx="1.5" fill="#d7dde8"/></g><g class="vst-truck"><circle cx="26" cy="48" r="9" fill="none" stroke="#1f2937" stroke-width="4"/><circle cx="70" cy="48" r="9" fill="none" stroke="#1f2937" stroke-width="4"/><path d="M26 48 40 30h20l10 18" fill="none" stroke="var(--p)" stroke-width="4" stroke-linejoin="round"/><rect x="40" y="16" width="20" height="16" rx="3" fill="var(--a)"/><circle cx="62" cy="14" r="5" fill="var(--p)"/></g></svg>',
    done: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="#16a34a"/><path class="vst-tick" d="M20 33l8 8 16-17" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    alert: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="#f59e0b"/><rect x="29" y="16" width="6" height="22" rx="3" fill="#fff"/><circle cx="32" cy="46" r="3.5" fill="#fff"/></svg>',
    back: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="var(--p)"/><path d="M40 22H26l6-6M26 22c10 0 16 6 16 13s-6 13-14 13" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  // header illustration: a parcel travelling a dotted route to a map pin, with a little truck
  var ART = '<svg class="vst-art" viewBox="0 0 220 150" aria-hidden="true">' +
    '<circle cx="150" cy="70" r="62" fill="#fff" opacity=".08"/><circle cx="150" cy="70" r="40" fill="#fff" opacity=".07"/>' +
    '<path class="vst-route" d="M28 120 C70 120 70 60 110 64 S170 40 196 28" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-dasharray="6 7" stroke-linecap="round"/>' +
    '<g class="vst-float"><path d="M196 6c-9 0-15 7-15 15 0 11 15 25 15 25s15-14 15-25c0-8-6-15-15-15Z" fill="var(--a)"/><circle cx="196" cy="21" r="5.5" fill="#fff"/></g>' +
    '<circle cx="28" cy="120" r="7" fill="#fff"/><circle cx="28" cy="120" r="3" fill="var(--p)"/>' +
    '<g class="vst-bob"><path d="M26 0 52 13v28L26 54 0 41V13Z" fill="#fff" opacity=".18"/><path d="M26 0 52 13 26 26 0 13Z" fill="#ffd9b8"/><path d="M0 13v28l26 13V26Z" fill="var(--a)"/><path d="M52 13v28L26 54V26Z" fill="var(--a)" opacity=".75"/><path d="M13 6.5 39 19.5v9" stroke="#fff" stroke-opacity=".75" stroke-width="3" fill="none"/></g>' +
    '<g class="vst-zip"><rect x="0" y="6" width="34" height="20" rx="3" fill="#fff"/><path d="M34 11h10l7 7v8H34Z" fill="#dbe7ff"/><circle cx="9" cy="28" r="4.5" fill="#1f2937"/><circle cx="42" cy="28" r="4.5" fill="#1f2937"/><rect x="5" y="11" width="18" height="4" rx="2" fill="var(--a)"/></g>' +
    "</svg>";
  var SVG = {
    live: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="3.5" fill="currentColor"/><path d="M6 13a6 6 0 0 1 12 0M3 13a9 9 0 0 1 18 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.5.3.1.2.1.7-.1 1.3Z" fill="currentColor"/></svg>',
    call: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1Z" fill="currentColor"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 10h6M9 14h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  var TOPICS = [["where", "Where is my order?"], ["delay", "Delivery is late"], ["reattempt", "Deliver again"], ["address", "Change address / phone"], ["damaged", "Damaged / wrong item"], ["return", "Return or exchange"], ["other", "Something else"]];

  // !important only where store themes like to restyle things (heading fonts/colours, buttons, inputs)
  var css = [
    ".vst{--p:#0b1f3a;--a:#f0712c;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif!important;color:#1f2937;max-width:820px;margin:0 auto;line-height:1.5;text-align:left;font-size:16px;letter-spacing:normal}",
    ".vst *{box-sizing:border-box;font-family:inherit!important;letter-spacing:normal!important;text-transform:none!important}",
    ".vst p,.vst ul,.vst li,.vst form{margin:0}",
    ".vst-card{position:relative;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 26px 60px -28px rgba(15,23,42,.45),0 2px 6px rgba(15,23,42,.06);border:1px solid #eef0f4}",
    ".vst-top{position:relative;display:flex;align-items:center;gap:12px;padding:24px 26px 50px;background:linear-gradient(130deg,var(--p) 0%,color-mix(in srgb,var(--p) 78%,var(--a)) 70%,color-mix(in srgb,var(--p) 55%,var(--a)) 100%);overflow:hidden}",
    ".vst-top:before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 12% 120%,rgba(255,255,255,.14),transparent 45%),radial-gradient(circle at 70% -30%,rgba(255,255,255,.12),transparent 40%)}",
    ".vst-txt{position:relative;z-index:1;flex:1;min-width:0}",
    ".vst-brand{display:flex;align-items:center;gap:10px}.vst-brand img{height:40px;max-width:150px;object-fit:contain;background:#fff;border-radius:10px;padding:4px}",
    ".vst-bn{font-size:15px;font-weight:700;color:#fff!important;opacity:.95}",
    ".vst-chip{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,.15);color:#fff!important;font-size:12px;font-weight:600}.vst-chip i{width:7px;height:7px;border-radius:50%;background:#4ade80;animation:vstPulse 1.8s infinite}",
    ".vst-h{display:block;font-size:34px!important;line-height:1.15!important;font-weight:800!important;color:#fff!important;margin:8px 0 0!important;text-shadow:0 2px 14px rgba(0,0,0,.18)}",
    ".vst-sub{color:rgba(255,255,255,.88)!important;font-size:15px;margin-top:6px!important}",
    ".vst-art{position:relative;z-index:1;width:230px;height:156px;flex:none;overflow:visible}",
    ".vst-route{animation:vstDash 2.4s linear infinite}.vst-float{animation:vstFloat 3s ease-in-out infinite}.vst-bob{animation:vstBob 3.4s ease-in-out infinite}.vst-zip{animation:vstZip 4s ease-in-out infinite}",
    ".vst-form{display:flex;gap:8px;margin:-30px 22px 0;position:relative;z-index:2;background:#fff;border-radius:18px;padding:8px;box-shadow:0 16px 34px -16px rgba(15,23,42,.45);border:1px solid #eef0f4}",
    ".vst input,.vst select,.vst textarea{font-size:16px!important;color:#111827!important;background:#fff!important;border:1px solid #e2e8f0!important;border-radius:12px!important;padding:11px 12px!important;outline:0!important;box-shadow:none!important;width:100%;min-height:0!important;height:auto!important;margin:0!important;max-width:none!important}",
    ".vst input:focus,.vst textarea:focus{border-color:var(--a)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 20%,transparent)!important}",
    ".vst .vst-form input{border:0!important;flex:1;min-width:0;box-shadow:none!important}",
    ".vst button{font-family:inherit!important;cursor:pointer;line-height:1.2!important;text-decoration:none!important;min-height:0!important;min-width:0!important;letter-spacing:normal!important;box-shadow:none}",
    ".vst .vst-go{border:0!important;border-radius:13px!important;padding:12px 24px!important;font-weight:700!important;font-size:15px!important;color:#fff!important;background:var(--a)!important;transition:transform .15s,filter .15s;white-space:nowrap;width:auto!important}.vst .vst-go:hover{filter:brightness(1.06);transform:translateY(-1px)}.vst .vst-go:disabled{opacity:.7}",
    ".vst-body{padding:20px 24px 4px}.vst-err{color:#b91c1c!important;font-size:14px;margin:4px 0 10px!important}.vst-err:empty{display:none}",
    ".vst-why{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}",
    ".vst-why div{border:1px solid #eef0f4;border-radius:16px;padding:14px;background:linear-gradient(180deg,#fff,#fafbfc);opacity:0;animation:vstUp .5s ease forwards}",
    ".vst-why svg,.vst-hb svg{width:22px;height:22px;display:block}.vst-why svg{color:var(--a);margin-bottom:6px}.vst-why b{display:block;font-size:14px;color:#0f172a!important}.vst-why span{font-size:12.5px;color:#64748b}",
    ".vst-tip{font-size:12.5px;color:#64748b!important;margin-top:12px!important;text-align:center}",
    ".vst-hero{display:flex;gap:16px;align-items:center;padding:16px;border-radius:18px;background:color-mix(in srgb,var(--a) 9%,#fff);border:1px solid color-mix(in srgb,var(--a) 22%,#fff);animation:vstUp .5s ease both}",
    ".vst-hero svg{width:96px;height:64px;flex:none;overflow:visible}.vst-ht{display:block;font-size:21px;font-weight:800;color:var(--p)!important}.vst-hero p{color:#475569!important;font-size:14px;margin-top:2px!important}",
    ".vst-truck{animation:vstDrive 1.6s ease-in-out infinite alternate}.vst-road{animation:vstRoad .8s linear infinite}",
    ".vst-tick{stroke-dasharray:40;stroke-dashoffset:40;animation:vstTick .6s .2s ease forwards}",
    ".vst-meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:#64748b;margin:12px 2px 0}.vst-meta b{color:#0f172a!important}",
    ".vst-live{display:inline-flex;align-items:center;gap:6px;color:#15803d!important;font-weight:700}.vst-live i{width:8px;height:8px;border-radius:50%;background:#22c55e;animation:vstPulse 1.8s infinite}",
    ".vst-steps{position:relative;display:flex;justify-content:space-between;margin:22px 4px 6px}",
    ".vst-steps:before{content:'';position:absolute;left:14px;right:14px;top:13px;height:4px;border-radius:4px;background:#e5e7eb}",
    ".vst-fill{position:absolute;left:14px;top:13px;height:4px;border-radius:4px;background:var(--a);width:0;transition:width 1.2s cubic-bezier(.2,.7,.2,1)}",
    ".vst-step{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:6px;width:20%;text-align:center;font-size:12px;color:#94a3b8}",
    ".vst-step i{width:30px;height:30px;border-radius:50%;background:#fff;border:3px solid #e5e7eb;display:grid;place-items:center;font-style:normal;font-size:14px;color:#fff;transition:all .4s}",
    ".vst-step.on i{background:var(--a);border-color:var(--a)}.vst-step.on{color:#0f172a;font-weight:600}",
    ".vst-step.now i{box-shadow:0 0 0 6px color-mix(in srgb,var(--a) 22%,transparent);animation:vstBeat 1.6s infinite}",
    ".vst-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}",
    ".vst-box{border:1px solid #eef0f4;border-radius:16px;padding:12px 14px;background:#fafbfc;animation:vstUp .5s .15s ease both}.vst-box span{display:block;font-size:12px;color:#64748b}.vst-box b{font-size:17px;color:#0f172a!important}.vst-box small{color:var(--a)!important;font-weight:700;font-size:13px}",
    ".vst-tl{list-style:none!important;margin:14px 0 0!important;padding:0!important}.vst-tl li{position:relative;list-style:none!important;padding:0 0 14px 26px!important;margin:0!important;opacity:0;animation:vstUp .45s ease forwards}",
    ".vst-tl li:before{content:'';position:absolute;left:6px;top:20px;bottom:-2px;width:2px;background:#e5e7eb}.vst-tl li:last-child:before{display:none}",
    ".vst-tl li:after{content:'';position:absolute;left:0;top:4px;width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #cbd5e1}",
    ".vst-tl li:first-child:after{border-color:var(--a);background:var(--a)}.vst-tl b{display:block;font-size:14px;color:#0f172a!important}.vst-tl span{font-size:12.5px;color:#64748b}",
    ".vst-tlh{display:flex;justify-content:space-between;align-items:center;margin-top:18px}.vst-tlh b{font-size:15px;color:#0f172a!important}",
    ".vst .vst-btn{border:1px solid #e2e8f0!important;background:#fff!important;border-radius:999px!important;padding:7px 13px!important;font-size:12.5px!important;font-weight:600!important;color:#0f172a!important;width:auto!important}",
    ".vst-help{margin:18px 24px 22px;border-radius:20px;padding:18px;background:linear-gradient(135deg,color-mix(in srgb,var(--p) 6%,#fff),color-mix(in srgb,var(--a) 9%,#fff));border:1px solid #eef0f4}",
    ".vst-help-h{display:block;font-size:18px;font-weight:800;color:var(--p)!important}.vst-help-s{font-size:13px;color:#64748b!important;margin-top:2px!important}",
    ".vst-hb{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:12px}",
    ".vst .vst-hb a,.vst .vst-hb button{display:flex!important;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:1px solid #e6eaf0!important;background:#fff!important;border-radius:14px!important;padding:13px 6px!important;font-size:13px!important;font-weight:700!important;color:#0f172a!important;text-decoration:none!important;transition:transform .15s,box-shadow .15s;width:100%!important}",
    ".vst .vst-hb a:hover,.vst .vst-hb button:hover{transform:translateY(-2px);box-shadow:0 10px 20px -14px rgba(15,23,42,.5)}",
    ".vst-hb .wa svg{color:#16a34a}.vst-hb .call svg{color:var(--p)}.vst-hb .mail svg{color:#2563eb}.vst-hb .tk svg{color:var(--a)}",
    ".vst-req{margin-top:12px!important;background:#fff;border:1px solid #e6eaf0;border-radius:16px;padding:14px;animation:vstUp .35s ease both}",
    ".vst-req label{display:block;font-size:12.5px;font-weight:600;color:#334155!important;margin:0 0 4px!important}",
    ".vst-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}.vst-full{margin-bottom:10px}",
    ".vst-tops{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}",
    ".vst .vst-tops button{border:1px solid #e2e8f0!important;background:#fff!important;border-radius:999px!important;padding:7px 12px!important;font-size:13px!important;font-weight:600!important;color:#334155!important;width:auto!important}",
    ".vst .vst-tops button.on{background:var(--a)!important;border-color:var(--a)!important;color:#fff!important}",
    ".vst-ok{display:flex;gap:10px;align-items:flex-start;padding:12px;border-radius:14px;background:#ecfdf3;border:1px solid #bbf7d0;color:#14532d!important;font-size:14px;margin-top:12px;animation:vstUp .35s ease both}.vst-ok b{color:#14532d!important}",
    ".vst-ok svg{width:28px;height:28px;flex:none}",
    ".vst-faq{margin-top:12px}.vst-faq details{border-top:1px solid rgba(15,23,42,.08);padding:10px 2px;margin:0}.vst-faq summary{cursor:pointer;font-size:14px;font-weight:600;color:#0f172a!important;list-style:none;display:block}.vst-faq summary::-webkit-details-marker{display:none}",
    ".vst-faq summary:after{content:'+';float:right;color:var(--a);font-weight:800}.vst-faq details[open] summary:after{content:'\\2013'}.vst-faq p{font-size:13.5px;color:#475569!important;margin-top:6px!important}",
    ".vst-foot{padding:12px 24px;border-top:1px solid #f1f3f6;font-size:12.5px;color:#64748b;background:#fcfcfd}",
    ".vst-pw{font-size:11px;color:#a0aec0;text-align:right;padding:6px 6px 0}",
    ".vst-conf{position:absolute;inset:0;pointer-events:none;overflow:hidden}.vst-conf i{position:absolute;top:-10px;width:8px;height:12px;border-radius:2px;animation:vstFall 2.4s ease-in forwards}",
    ".vst-skel{height:14px;border-radius:7px;background:linear-gradient(90deg,#f1f5f9,#e2e8f0,#f1f5f9);background-size:200% 100%;animation:vstShim 1.2s infinite;margin:10px 0}",
    "@keyframes vstUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
    "@keyframes vstDrive{from{transform:translateX(-4px)}to{transform:translateX(6px)}}@keyframes vstRoad{from{transform:translateX(0)}to{transform:translateX(-34px)}}",
    "@keyframes vstTick{to{stroke-dashoffset:0}}@keyframes vstPulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 9px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}",
    "@keyframes vstBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}@keyframes vstFall{to{transform:translateY(460px) rotate(540deg);opacity:0}}@keyframes vstShim{to{background-position:-200% 0}}",
    "@keyframes vstDash{to{stroke-dashoffset:-26}}@keyframes vstFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}",
    "@keyframes vstBob{0%,100%{transform:translate(84px,74px) rotate(-3deg)}50%{transform:translate(84px,66px) rotate(3deg)}}@keyframes vstZip{0%,100%{transform:translate(140px,104px)}50%{transform:translate(124px,104px)}}",
    ".vst-bob{transform:translate(84px,74px)}.vst-zip{transform:translate(140px,104px)}",
    "@media (prefers-reduced-motion:reduce){.vst *{animation:none!important;transition:none!important}.vst-tl li,.vst-why div{opacity:1}.vst-tick{stroke-dashoffset:0}}",
    "@media (max-width:640px){.vst-top{padding:20px 18px 48px}.vst-h{font-size:26px!important}.vst-art{width:118px;height:80px;position:absolute;right:-4px;top:12px;opacity:.5}.vst-txt{padding-right:40px}.vst-form{margin:-30px 12px 0}.vst-body{padding:16px}.vst-why{grid-template-columns:1fr}.vst-grid{grid-template-columns:1fr}.vst-step{font-size:10.5px}.vst-hero svg{width:72px;height:48px}.vst-ht{font-size:18px}.vst-help{margin:14px 12px 16px;padding:14px}.vst-hb{grid-template-columns:1fr 1fr}.vst-row{grid-template-columns:1fr}.vst .vst-go{padding:12px 16px!important}}",
  ].join("");
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var brand = null, current = "", timer = null, lastStatus = "", shown = null, reqOpen = false, topic = "where", sent = null;

  function hero(sh) {
    var h = HERO[sh.status] || ["truck", sh.statusLabel || "On its way", ""];
    return '<div class="vst-hero">' + (ICON[h[0]] || ICON.truck) + '<div><span class="vst-ht">' + esc(h[1]) + "</span><p>" + esc(h[2]) + "</p></div></div>";
  }
  function steps(sh) {
    var idx = STEP_OF[sh.status];
    if (idx == null) return "";
    var out = '<div class="vst-steps" role="list" aria-label="Delivery progress"><div class="vst-fill" data-w="' + (idx / 4) + '"></div>';
    for (var i = 0; i < STEPS.length; i++) out += '<div role="listitem" class="vst-step' + (i <= idx ? " on" : "") + (i === idx && sh.status !== "delivered" ? " now" : "") + '"><i>' + (i <= idx ? "&#10003;" : "") + "</i>" + STEPS[i] + "</div>";
    return out + "</div>";
  }
  function why() {
    var items = [[SVG.live, "Live updates", "This page refreshes itself — no need to reload."], [SVG.cal, "Delivery date", "See when your parcel will reach you."], [SVG.help, "Quick help", "Message, call or raise a request below."]];
    return '<div class="vst-why">' + items.map(function (x, i) { return '<div style="animation-delay:' + i * 90 + 'ms">' + x[0] + "<b>" + x[1] + "</b><span>" + x[2] + "</span></div>"; }).join("") + '</div><p class="vst-tip">Your AWB / tracking number is in the SMS, WhatsApp or email you got when the order shipped.</p>';
  }
  function helpBlock(b, sh, q) {
    var ref = sh ? (sh.orderNumber || sh.awb) : q;
    var wa = waNum(b.supportPhone);
    var waText = encodeURIComponent("Hi " + (b.businessName || "") + ", I need help with my order" + (ref ? " " + ref : "") + (sh && sh.awb ? " (AWB " + sh.awb + ")" : "") + ".");
    var h = '<div class="vst-help"><span class="vst-help-h">Need help with your order?</span><p class="vst-help-s">' + esc(b.businessName || "The store") + " is here for you" + (b.supportHours ? " · " + esc(b.supportHours) : "") + ".</p>";
    h += '<div class="vst-hb">';
    if (wa) h += '<a class="wa" target="_blank" rel="noopener" href="https://wa.me/' + wa + "?text=" + waText + '">' + SVG.wa + "WhatsApp</a>";
    if (b.supportPhone) h += '<a class="call" href="tel:' + esc(String(b.supportPhone).replace(/[^+0-9]/g, "")) + '">' + SVG.call + "Call us</a>";
    if (b.supportEmail) h += '<a class="mail" href="mailto:' + esc(b.supportEmail) + "?subject=" + encodeURIComponent("Help with order " + (ref || "")) + '">' + SVG.mail + "Email</a>";
    h += '<button type="button" class="tk" data-req aria-expanded="' + reqOpen + '">' + SVG.ticket + "Raise a request</button></div>";
    if (sent) {
      h += '<div class="vst-ok" role="status">' + ICON.done + "<div><b>Request sent!</b><br>" + esc(b.businessName || "The store") + " has your request about order <b>" + esc(sent.order) + "</b> (" + esc(sent.topic) + ") and will contact you soon.</div></div>";
    } else if (reqOpen) {
      h += '<form class="vst-req" data-reqform><label>What do you need help with?</label><div class="vst-tops">' + TOPICS.map(function (t) { return '<button type="button" data-topic="' + t[0] + '" class="' + (t[0] === topic ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div>";
      h += '<div class="vst-row"><div><label for="vst-n">Your name</label><input id="vst-n" name="name" required minlength="2" maxlength="60" autocomplete="name"></div><div><label for="vst-ph">Mobile number</label><input id="vst-ph" name="phone" required inputmode="tel" minlength="8" maxlength="18" autocomplete="tel"></div></div>';
      h += '<div class="vst-full"><label for="vst-r">AWB or order ID</label><input id="vst-r" name="ref" required minlength="3" maxlength="40" value="' + esc(ref || "") + '"></div>';
      h += '<div class="vst-full"><label for="vst-m">Message (optional)</label><textarea id="vst-m" name="message" rows="3" maxlength="400" placeholder="Tell us a little more…"></textarea></div>';
      h += '<p class="vst-err" data-reqerr></p><button class="vst-go">Send request</button></form>';
    }
    h += '<div class="vst-faq">' +
      "<details><summary>When will my order arrive?</summary><p>Track with your AWB or order ID above — you will see the expected delivery date and every update from the courier.</p></details>" +
      "<details><summary>The courier missed me. What now?</summary><p>The courier usually tries again the next working day. Choose “Deliver again” in Raise a request and we will arrange it.</p></details>" +
      "<details><summary>Can I change my address or phone?</summary><p>Yes, while the parcel has not gone out for delivery. Raise a request with the new details.</p></details></div>";
    return h + "</div>";
  }
  function render(data, q, err, loading) {
    var b = (data && data.brand) || brand || {};
    brand = b;
    var sh = data ? data.shipment : shown;
    shown = sh || null;
    var p = color(b.primaryColor, "#0b1f3a"), a = color(b.accentColor, "#f0712c");
    var h = '<div class="vst" style="--p:' + p + ";--a:" + a + '"><div class="vst-card">';
    h += '<div class="vst-top"><div class="vst-txt"><div class="vst-brand">' + (b.logo && /^data:image\//.test(b.logo) ? '<img alt="" src="' + esc(b.logo) + '">' : "") + '<span class="vst-bn">' + esc(b.businessName || "") + "</span></div>";
    h += '<span class="vst-chip"><i></i>Live order tracking</span><span class="vst-h" role="heading" aria-level="2">' + esc(b.headline || "Track your order") + '</span><p class="vst-sub">' + esc(b.message || "Enter your AWB or order ID to see where your parcel is, live.") + "</p></div>" + ART + "</div>";
    h += '<form class="vst-form" role="search" data-track><input name="q" required maxlength="40" autocomplete="off" placeholder="AWB number or order ID" value="' + esc(q || "") + '" aria-label="AWB number or order ID"><button class="vst-go">Track</button></form>';
    h += '<div class="vst-body">';
    if (loading) h += '<div class="vst-skel" style="width:60%"></div><div class="vst-skel"></div><div class="vst-skel" style="width:80%"></div>';
    if (err) h += '<p class="vst-err" role="status">' + esc(err) + "</p>";
    if (sh) {
      var ev = sh.events || [];
      if (ev.length > 1 && new Date(ev[0].at) <= new Date(ev[ev.length - 1].at)) ev = ev.slice().reverse();
      h += hero(sh) + steps(sh);
      var last = ev[0];
      var eta = sh.etaDate && DONE.indexOf(sh.status) < 0 ? sh.etaDate : null;
      var dleft = eta ? daysTo(eta) : null;
      h += '<div class="vst-grid">';
      h += '<div class="vst-box"><span>' + (sh.status === "delivered" ? "Delivered on" : "Expected delivery") + "</span><b>" + (sh.status === "delivered" && last ? esc(day(last.at)) : eta ? esc(day(eta)) : "Updating soon") + "</b>" + (dleft != null && dleft >= 0 ? " <small>" + (dleft === 0 ? "today" : dleft === 1 ? "tomorrow" : "in " + dleft + " days") + "</small>" : "") + "</div>";
      h += '<div class="vst-box"><span>Latest update</span><b>' + esc(last ? (last.location || last.status) : sh.statusLabel) + "</b>" + (last ? '<span style="margin-top:2px">' + esc(last.location ? last.status + " · " : "") + esc(when(last.at)) + "</span>" : "") + "</div></div>";
      h += '<div class="vst-meta"><span>Order <b>' + esc(sh.orderNumber) + "</b></span>" + (sh.awb ? "<span>AWB <b>" + esc(sh.awb) + "</b></span>" : "") + (sh.carrierName ? "<span>via <b>" + esc(sh.carrierName) + "</b></span>" : "") + (DONE.indexOf(sh.status) < 0 ? '<span class="vst-live"><i></i>Live · updated ' + esc(ago(sh.checkedAt || new Date().toISOString())) + "</span>" : "") + "</div>";
      if (ev.length) {
        h += '<div class="vst-tlh"><b>Tracking history</b><button type="button" class="vst-btn" data-copy>Copy link</button></div><ul class="vst-tl">';
        h += ev.map(function (e, i) { return '<li style="animation-delay:' + Math.min(i * 70, 700) + 'ms"><b>' + esc(e.status) + "</b><span>" + esc(e.location || "") + (e.location ? " · " : "") + esc(when(e.at)) + "</span></li>"; }).join("") + "</ul>";
      }
    } else if (!loading) h += why();
    h += "</div>" + helpBlock(b, sh, q);
    if (b.footerText) h += '<div class="vst-foot">' + esc(b.footerText) + "</div>";
    if (sh && sh.status === "delivered" && lastStatus !== "delivered") {
      h += '<div class="vst-conf">';
      for (var c = 0; c < 26; c++) h += '<i style="left:' + Math.round(Math.random() * 100) + "%;background:" + (c % 3 ? a : c % 2 ? p : "#22c55e") + ";animation-delay:" + Math.round(Math.random() * 600) + 'ms"></i>';
      h += "</div>";
    }
    h += '</div><div class="vst-pw">Tracking by Vishwaship</div></div>';
    // keep what the buyer is typing in the request form across a live refresh
    var keep = {};
    holder.querySelectorAll("[data-reqform] [name]").forEach(function (el) { keep[el.name] = el.value; });
    holder.innerHTML = h;
    Object.keys(keep).forEach(function (k) { var el = holder.querySelector('[data-reqform] [name="' + k + '"]'); if (el && keep[k]) el.value = keep[k]; });
    lastStatus = sh ? sh.status : lastStatus;
    wire(sh, q);
  }
  function wire(sh, q) {
    var fill = holder.querySelector(".vst-fill");
    if (fill) requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = "calc((100% - 28px) * " + Number(fill.getAttribute("data-w")) + ")"; }); });
    holder.querySelector("[data-track]").addEventListener("submit", function (ev) { ev.preventDefault(); lastStatus = ""; sent = null; load(this.q.value.trim(), true); });
    var cp = holder.querySelector("[data-copy]");
    if (cp) cp.addEventListener("click", function () {
      var u = new URL(location.href); u.searchParams.set("awb", (sh && (sh.awb || sh.orderNumber)) || q);
      (navigator.clipboard ? navigator.clipboard.writeText(u.toString()) : Promise.reject()).then(function () { cp.textContent = "Link copied ✓"; }, function () { cp.textContent = u.toString(); });
    });
    holder.querySelector("[data-req]").addEventListener("click", function () {
      reqOpen = !reqOpen; sent = null; render(null, current, "", false);
      var n = reqOpen && holder.querySelector("#vst-n"); if (n) { n.focus(); n.scrollIntoView({ block: "center", behavior: "smooth" }); }
    });
    holder.querySelectorAll("[data-topic]").forEach(function (btn) {
      btn.addEventListener("click", function () { topic = btn.getAttribute("data-topic"); holder.querySelectorAll("[data-topic]").forEach(function (x) { x.className = x === btn ? "on" : ""; }); });
    });
    var rf = holder.querySelector("[data-reqform]");
    if (rf) rf.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var btn = rf.querySelector(".vst-go"), er = rf.querySelector("[data-reqerr]");
      btn.disabled = true; btn.textContent = "Sending…"; er.textContent = "";
      fetch(origin + "/api/public/track-widget/request/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ store: store, topic: topic, name: rf.elements.name.value, phone: rf.elements.phone.value, ref: rf.elements.ref.value, message: rf.elements.message.value }) })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .then(function (r) {
          if (r.j.ok) { sent = { order: r.j.order, topic: r.j.topic }; reqOpen = false; render(null, current, "", false); return; }
          er.textContent = r.j.error === "not_found" ? "We couldn’t find that AWB / order ID for this store." : r.j.error === "rate_limited" ? "You have sent a few requests already — the store will contact you soon." : "Please check your name and mobile number.";
          btn.disabled = false; btn.textContent = "Send request";
        })
        .catch(function () { er.textContent = "Couldn’t send right now. Please try WhatsApp or call."; btn.disabled = false; btn.textContent = "Send request"; });
    });
  }
  function load(q, show) {
    current = q;
    if (show && q) { shown = null; render(null, q, "", true); }
    var url = origin + "/api/public/track-widget/?store=" + encodeURIComponent(store) + (q ? "&q=" + encodeURIComponent(q) : "");
    fetch(url).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); }).then(function (r) {
      if (q !== current) return;
      if (r.status === 404 && r.j.error === "unknown_store") { holder.innerHTML = '<p style="color:#b91c1c;font-family:system-ui,sans-serif">Tracking is not set up yet — check the data-store name in the code from Vishwaship.</p>'; return; }
      // a background refresh that fails keeps showing the last result
      if (!show && !r.j.shipment) return;
      var err = r.j.error === "not_found" ? "We couldn’t find that order. Check the AWB or order ID and try again." : r.j.error === "rate_limited" ? "Too many searches. Please wait a few minutes." : "";
      render(r.j, q, err, false);
      clearInterval(timer);
      var sh = r.j.shipment;
      // live refresh every minute while visible; skipped while the buyer is typing a request
      if (sh && DONE.indexOf(sh.status) < 0) timer = setInterval(function () { if (document.visibilityState === "visible" && !holder.querySelector("[data-reqform]")) load(current, false); }, 60000);
    }).catch(function () { if (q === current && show) render(null, q, "Tracking is unavailable right now. Please try again.", false); });
  }
  var params = new URLSearchParams(location.search);
  load((params.get("awb") || params.get("q") || params.get("order") || params.get("tracking") || "").trim().slice(0, 40), true);
})();
