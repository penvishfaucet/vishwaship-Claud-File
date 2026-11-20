/*
 * Vishwaship branded tracking — put your tracking page on your own website.
 *   <div id="vishwaship-tracking"></div>
 *   <script src="https://vishwaship.in/track-embed.js" data-store="your-store" async></script>
 * Works on Shopify, WooCommerce / WordPress, Wix, Squarespace and any HTML page. Drawn inside your page (no iframe),
 * with your logo and colours; refreshes itself every minute while open. A link like yourpage?awb=1234567890
 * (or ?q= / ?order=) opens that shipment directly.
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
  var daysTo = function (iso) { var d = Math.ceil((new Date(iso).setHours(23, 59, 0, 0) - Date.now()) / 86400000); return d; };

  var STEPS = [["booked", "Order placed"], ["picked_up", "Picked up"], ["in_transit", "In transit"], ["out_for_delivery", "Out for delivery"], ["delivered", "Delivered"]];
  var STEP_OF = { booked: 0, pickup_pending: 0, picked_up: 1, in_transit: 2, at_delivery_center: 2, reverse_in_transit: 2, out_for_delivery: 3, ndr: 3, delivered: 4, reverse_delivered: 4 };
  var HERO = {
    booked: ["box", "Your order is confirmed", "We are packing it and handing it to the courier."],
    pickup_pending: ["box", "Getting ready to ship", "The courier will pick up your parcel soon."],
    picked_up: ["truck", "Your parcel is on its way", "The courier has picked it up."],
    in_transit: ["truck", "On the move", "Your parcel is travelling to your city."],
    at_delivery_center: ["truck", "Almost there", "Your parcel has reached the delivery hub near you."],
    out_for_delivery: ["bike", "Out for delivery today", "Keep your phone handy — it arrives today."],
    ndr: ["alert", "We missed you", "The courier could not deliver. They will try again — keep your phone on."],
    delivered: ["done", "Delivered!", "Your parcel has been delivered. Enjoy!"],
    rto_initiated: ["back", "Returning to the seller", "This parcel is going back to the store."],
    rto_in_transit: ["back", "Returning to the seller", "This parcel is going back to the store."],
    rto_delivered: ["back", "Returned to the seller", "The parcel reached the store."],
    cancelled: ["alert", "Shipment cancelled", "Contact the store if you have questions."],
    lost: ["alert", "We are looking into it", "Please contact the store."],
  };
  var ICON = {
    box: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 56 18v28L32 58 8 46V18Z" fill="var(--a)" opacity=".18"/><path d="M32 6 56 18 32 30 8 18Z" fill="var(--a)"/><path d="M8 18v28l24 12V30Z" fill="var(--p)"/><path d="M56 18v28L32 58V30Z" fill="var(--p)" opacity=".75"/></svg>',
    truck: '<svg viewBox="0 0 96 64" aria-hidden="true"><g class="vst-road"><rect x="0" y="56" width="96" height="3" rx="1.5" fill="#d7dde8"/><rect x="6" y="56.5" width="14" height="2" rx="1" fill="#fff"/><rect x="40" y="56.5" width="14" height="2" rx="1" fill="#fff"/><rect x="74" y="56.5" width="14" height="2" rx="1" fill="#fff"/></g><g class="vst-truck"><rect x="10" y="20" width="44" height="28" rx="4" fill="var(--a)"/><path d="M54 28h14l10 10v10H54Z" fill="var(--p)"/><rect x="58" y="31" width="10" height="7" rx="1.5" fill="#cfe3ff"/><circle cx="24" cy="50" r="6" fill="#1f2937"/><circle cx="24" cy="50" r="2.4" fill="#fff"/><circle cx="66" cy="50" r="6" fill="#1f2937"/><circle cx="66" cy="50" r="2.4" fill="#fff"/><rect x="2" y="26" width="6" height="2.5" rx="1.2" fill="var(--a)" opacity=".5"/><rect x="0" y="34" width="8" height="2.5" rx="1.2" fill="var(--a)" opacity=".35"/></g></svg>',
    bike: '<svg viewBox="0 0 96 64" aria-hidden="true"><g class="vst-road"><rect x="0" y="56" width="96" height="3" rx="1.5" fill="#d7dde8"/></g><g class="vst-truck"><circle cx="26" cy="48" r="9" fill="none" stroke="#1f2937" stroke-width="4"/><circle cx="70" cy="48" r="9" fill="none" stroke="#1f2937" stroke-width="4"/><path d="M26 48 40 30h20l10 18" fill="none" stroke="var(--p)" stroke-width="4" stroke-linejoin="round"/><rect x="40" y="16" width="20" height="16" rx="3" fill="var(--a)"/><circle cx="62" cy="14" r="5" fill="var(--p)"/></g></svg>',
    done: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="#16a34a"/><path class="vst-tick" d="M20 33l8 8 16-17" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    alert: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="#f59e0b"/><rect x="29" y="16" width="6" height="22" rx="3" fill="#fff"/><circle cx="32" cy="46" r="3.5" fill="#fff"/></svg>',
    back: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="var(--p)"/><path d="M40 22H26l6-6M26 22c10 0 16 6 16 13s-6 13-14 13" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  var css = [
    ".vst{--p:#0b1f3a;--a:#f0712c;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1f2937;max-width:760px;margin:0 auto;line-height:1.5;text-align:left;font-size:16px}",
    ".vst *{box-sizing:border-box}.vst p,.vst h2,.vst h3{margin:0}",
    ".vst-card{background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 22px 48px -22px rgba(15,23,42,.35),0 2px 6px rgba(15,23,42,.06);border:1px solid #eef0f4}",
    ".vst-top{position:relative;padding:22px 24px 26px;color:#fff;background:linear-gradient(135deg,var(--p),color-mix(in srgb,var(--p) 70%,var(--a)));overflow:hidden}",
    ".vst-top:after{content:'';position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;background:rgba(255,255,255,.08)}",
    ".vst-brand{display:flex;align-items:center;gap:12px;position:relative;z-index:1}.vst-brand img{height:42px;max-width:150px;object-fit:contain;background:#fff;border-radius:10px;padding:4px}.vst-brand b{font-size:18px}",
    ".vst-top h2{font-size:26px;font-weight:800;margin-top:14px;position:relative;z-index:1}.vst-top p{opacity:.85;margin-top:4px;position:relative;z-index:1}",
    ".vst-form{display:flex;gap:8px;margin:-22px 20px 0;position:relative;z-index:2;background:#fff;border-radius:16px;padding:8px;box-shadow:0 12px 28px -14px rgba(15,23,42,.4)}",
    ".vst-form input{flex:1;min-width:0;border:0;outline:0;font-size:16px;padding:10px 12px;background:transparent;color:#111827}",
    ".vst-form button{border:0;border-radius:12px;padding:11px 22px;font-weight:700;font-size:15px;color:#fff;background:var(--a);cursor:pointer;transition:transform .15s,filter .15s}.vst-form button:hover{filter:brightness(1.05);transform:translateY(-1px)}",
    ".vst-body{padding:18px 22px 22px}.vst-err{color:#b91c1c;font-size:14px;margin:4px 0}",
    ".vst-hero{display:flex;gap:16px;align-items:center;padding:16px;border-radius:18px;background:color-mix(in srgb,var(--a) 9%,#fff);border:1px solid color-mix(in srgb,var(--a) 22%,#fff);animation:vstUp .5s ease both}",
    ".vst-hero svg{width:96px;height:64px;flex:none;overflow:visible}.vst-hero h3{font-size:21px;font-weight:800;color:var(--p)}.vst-hero p{color:#475569;font-size:14px;margin-top:2px}",
    ".vst-truck{animation:vstDrive 1.6s ease-in-out infinite alternate}.vst-road{animation:vstRoad .8s linear infinite}",
    ".vst-tick{stroke-dasharray:40;stroke-dashoffset:40;animation:vstTick .6s .2s ease forwards}",
    ".vst-meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:#64748b;margin:12px 2px 0}.vst-meta b{color:#0f172a}",
    ".vst-live{display:inline-flex;align-items:center;gap:6px;color:#15803d;font-weight:700}.vst-live i{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:vstPulse 1.8s infinite}",
    ".vst-steps{position:relative;display:flex;justify-content:space-between;margin:22px 4px 6px}",
    ".vst-steps:before{content:'';position:absolute;left:14px;right:14px;top:13px;height:4px;border-radius:4px;background:#e5e7eb}",
    ".vst-fill{position:absolute;left:14px;top:13px;height:4px;border-radius:4px;background:var(--a);width:0;transition:width 1.2s cubic-bezier(.2,.7,.2,1)}",
    ".vst-step{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:6px;width:20%;text-align:center;font-size:12px;color:#94a3b8}",
    ".vst-step i{width:30px;height:30px;border-radius:50%;background:#fff;border:3px solid #e5e7eb;display:grid;place-items:center;font-style:normal;font-size:14px;color:#fff;transition:all .4s}",
    ".vst-step.on i{background:var(--a);border-color:var(--a)}.vst-step.on{color:#0f172a;font-weight:600}",
    ".vst-step.now i{box-shadow:0 0 0 6px color-mix(in srgb,var(--a) 22%,transparent);animation:vstBeat 1.6s infinite}",
    ".vst-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}",
    ".vst-box{border:1px solid #eef0f4;border-radius:16px;padding:12px 14px;background:#fafbfc;animation:vstUp .5s .15s ease both}.vst-box span{display:block;font-size:12px;color:#64748b}.vst-box b{font-size:17px;color:#0f172a}.vst-box small{color:var(--a);font-weight:700}",
    ".vst-tl{list-style:none;margin:16px 0 0;padding:0}.vst-tl li{position:relative;padding:0 0 14px 26px;opacity:0;animation:vstUp .45s ease forwards}",
    ".vst-tl li:before{content:'';position:absolute;left:6px;top:20px;bottom:-2px;width:2px;background:#e5e7eb}.vst-tl li:last-child:before{display:none}",
    ".vst-tl li:after{content:'';position:absolute;left:0;top:4px;width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #cbd5e1}",
    ".vst-tl li:first-child:after{border-color:var(--a);background:var(--a)}.vst-tl b{display:block;font-size:14px;color:#0f172a}.vst-tl span{font-size:12.5px;color:#64748b}",
    ".vst-tlh{display:flex;justify-content:space-between;align-items:center;margin-top:18px}.vst-tlh h3{font-size:15px;color:#0f172a}",
    ".vst-btn{border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:600;color:#0f172a;cursor:pointer}",
    ".vst-foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:14px 22px;border-top:1px solid #f1f3f6;font-size:13px;color:#64748b;background:#fcfcfd}.vst-foot a{color:var(--p);font-weight:600;text-decoration:none}",
    ".vst-pw{font-size:11px;color:#a0aec0;text-align:right;padding:6px 6px 0}",
    ".vst-conf{position:absolute;inset:0;pointer-events:none;overflow:hidden}.vst-conf i{position:absolute;top:-10px;width:8px;height:12px;border-radius:2px;animation:vstFall 2.4s ease-in forwards}",
    ".vst-skel{height:14px;border-radius:7px;background:linear-gradient(90deg,#f1f5f9,#e2e8f0,#f1f5f9);background-size:200% 100%;animation:vstShim 1.2s infinite;margin:10px 0}",
    "@keyframes vstUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
    "@keyframes vstDrive{from{transform:translateX(-4px)}to{transform:translateX(6px)}}@keyframes vstRoad{from{transform:translateX(0)}to{transform:translateX(-34px)}}",
    "@keyframes vstTick{to{stroke-dashoffset:0}}@keyframes vstPulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 9px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}",
    "@keyframes vstBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}@keyframes vstFall{to{transform:translateY(360px) rotate(540deg);opacity:0}}@keyframes vstShim{to{background-position:-200% 0}}",
    "@media (prefers-reduced-motion:reduce){.vst *{animation:none!important;transition:none!important}.vst-tl li{opacity:1}.vst-tick{stroke-dashoffset:0}}",
    "@media (max-width:560px){.vst-top{padding:18px 18px 26px}.vst-top h2{font-size:22px}.vst-form{margin:-22px 12px 0}.vst-body{padding:16px}.vst-grid{grid-template-columns:1fr}.vst-step{font-size:10.5px}.vst-hero svg{width:72px;height:48px}.vst-hero h3{font-size:18px}}",
  ].join("");
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var brand = null, current = "", timer = null, lastStatus = "";
  function hero(sh) {
    var h = HERO[sh.status] || ["truck", sh.statusLabel || "On its way", ""];
    return '<div class="vst-hero">' + (ICON[h[0]] || ICON.truck) + "<div><h3>" + esc(h[1]) + "</h3><p>" + esc(h[2]) + "</p></div></div>";
  }
  function steps(sh) {
    var idx = STEP_OF[sh.status];
    if (idx == null) return "";
    var out = '<div class="vst-steps" role="list" aria-label="Delivery progress"><div class="vst-fill" data-w="' + (idx / 4 * 100) + '"></div>';
    for (var i = 0; i < STEPS.length; i++) out += '<div role="listitem" class="vst-step' + (i <= idx ? " on" : "") + (i === idx && sh.status !== "delivered" ? " now" : "") + '"><i>' + (i <= idx ? "&#10003;" : "") + "</i>" + STEPS[i][1] + "</div>";
    return out + "</div>";
  }
  function render(data, q, err, loading) {
    var b = (data && data.brand) || brand || {};
    brand = b;
    var sh = data && data.shipment;
    var p = color(b.primaryColor, "#0b1f3a"), a = color(b.accentColor, "#f0712c");
    var h = '<div class="vst" style="--p:' + p + ";--a:" + a + '"><div class="vst-card" style="position:relative">';
    h += '<div class="vst-top"><div class="vst-brand">' + (b.logo && /^data:image\//.test(b.logo) ? '<img alt="" src="' + esc(b.logo) + '">' : "") + "<b>" + esc(b.businessName || "") + "</b></div>";
    h += "<h2>" + esc(b.headline || "Track your order") + "</h2>" + (b.message ? "<p>" + esc(b.message) + "</p>" : "<p>Enter your AWB or order ID to see live updates.</p>") + "</div>";
    h += '<form class="vst-form" role="search"><input name="q" required maxlength="40" autocomplete="off" placeholder="AWB number or order ID" value="' + esc(q || "") + '" aria-label="AWB number or order ID"><button>Track</button></form>';
    h += '<div class="vst-body">';
    if (loading) h += '<div class="vst-skel" style="width:60%"></div><div class="vst-skel"></div><div class="vst-skel" style="width:80%"></div>';
    if (err) h += '<p class="vst-err" role="status">' + esc(err) + "</p>";
    if (sh) {
      // newest first, whatever order the API sends
      if (sh.events && sh.events.length > 1 && new Date(sh.events[0].at) <= new Date(sh.events[sh.events.length - 1].at)) sh.events = sh.events.slice().reverse();
      h += hero(sh) + steps(sh);
      var last = sh.events && sh.events[0];
      var eta = sh.etaDate && ["delivered", "rto_delivered", "cancelled"].indexOf(sh.status) < 0 ? sh.etaDate : null;
      var dleft = eta ? daysTo(eta) : null;
      h += '<div class="vst-grid">';
      h += '<div class="vst-box"><span>' + (sh.status === "delivered" ? "Delivered" : "Expected delivery") + "</span><b>" + (sh.status === "delivered" && last ? esc(day(last.at)) : eta ? esc(day(eta)) : "Updating soon") + "</b>" + (dleft != null && dleft >= 0 ? " <small>" + (dleft === 0 ? "today" : dleft === 1 ? "tomorrow" : "in " + dleft + " days") + "</small>" : "") + "</div>";
      h += '<div class="vst-box"><span>Latest update</span><b>' + esc(last ? (last.location || last.status) : sh.statusLabel) + "</b>" + (last ? '<span style="margin-top:2px">' + esc(when(last.at)) + "</span>" : "") + "</div></div>";
      h += '<div class="vst-meta"><span>Order <b>' + esc(sh.orderNumber) + "</b></span>" + (sh.awb ? "<span>AWB <b>" + esc(sh.awb) + "</b></span>" : "") + (sh.carrierName ? "<span>via <b>" + esc(sh.carrierName) + "</b></span>" : "") + ([ "delivered", "rto_delivered", "cancelled" ].indexOf(sh.status) < 0 ? '<span class="vst-live"><i></i>Live · updated ' + esc(ago(sh.checkedAt || new Date().toISOString())) + "</span>" : "") + "</div>";
      if (sh.events && sh.events.length) {
        h += '<div class="vst-tlh"><h3>Tracking history</h3><button type="button" class="vst-btn" data-copy>Copy link</button></div><ul class="vst-tl">';
        h += sh.events.map(function (e, i) { return '<li style="animation-delay:' + Math.min(i * 70, 700) + 'ms"><b>' + esc(e.status) + "</b><span>" + esc(e.location || "") + (e.location ? " · " : "") + esc(when(e.at)) + "</span></li>"; }).join("") + "</ul>";
      }
    }
    h += "</div>";
    var help = [b.supportPhone ? '<a href="tel:' + esc(String(b.supportPhone).replace(/\s/g, "")) + '">Call ' + esc(b.supportPhone) + "</a>" : "", b.supportEmail ? '<a href="mailto:' + esc(b.supportEmail) + '">' + esc(b.supportEmail) + "</a>" : "", b.supportHours ? esc(b.supportHours) : ""].filter(Boolean).join(" · ");
    if (help || b.footerText) h += '<div class="vst-foot"><span>' + (help ? "Need help? " + help : "") + "</span>" + (b.footerText ? "<span>" + esc(b.footerText) + "</span>" : "") + "</div>";
    if (sh && sh.status === "delivered" && lastStatus !== "delivered") {
      h += '<div class="vst-conf">';
      for (var c = 0; c < 26; c++) h += '<i style="left:' + Math.round(Math.random() * 100) + "%;background:" + (c % 3 ? a : c % 2 ? p : "#22c55e") + ";animation-delay:" + Math.round(Math.random() * 600) + 'ms"></i>';
      h += "</div>";
    }
    h += '</div><div class="vst-pw">Tracking by Vishwaship</div></div>';
    holder.innerHTML = h;
    lastStatus = sh ? sh.status : lastStatus;
    var fill = holder.querySelector(".vst-fill");
    if (fill) requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = "calc((100% - 28px) * " + (Number(fill.getAttribute("data-w")) / 100) + ")"; }); });
    holder.querySelector("form").addEventListener("submit", function (ev) { ev.preventDefault(); lastStatus = ""; load(this.q.value.trim(), true); });
    var cp = holder.querySelector("[data-copy]");
    if (cp) cp.addEventListener("click", function () {
      var u = new URL(location.href); u.searchParams.set("awb", (sh && (sh.awb || sh.orderNumber)) || q);
      (navigator.clipboard ? navigator.clipboard.writeText(u.toString()) : Promise.reject()).then(function () { cp.textContent = "Link copied"; }, function () { cp.textContent = u.toString(); });
    });
  }
  function load(q, show) {
    current = q;
    if (show && q) render(null, q, "", true);
    var url = origin + "/api/public/track-widget/?store=" + encodeURIComponent(store) + (q ? "&q=" + encodeURIComponent(q) : "");
    fetch(url).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); }).then(function (r) {
      if (q !== current) return;
      if (r.status === 404 && r.j.error === "unknown_store") { holder.innerHTML = '<p style="color:#b91c1c;font-family:system-ui,sans-serif">Tracking is not set up yet — check the data-store name in the code from Vishwaship.</p>'; return; }
      var err = r.j.error === "not_found" ? "We couldn’t find that order. Check the AWB or order ID and try again." : r.j.error === "rate_limited" ? "Too many searches. Please wait a few minutes." : "";
      render(r.j, q, err, false);
      clearInterval(timer);
      var sh = r.j.shipment;
      if (sh && ["delivered", "rto_delivered", "cancelled"].indexOf(sh.status) < 0) timer = setInterval(function () { if (document.visibilityState === "visible") load(current, false); }, 60000);
    }).catch(function () { if (q === current) render(null, q, "Tracking is unavailable right now. Please try again.", false); });
  }
  var params = new URLSearchParams(location.search);
  load((params.get("awb") || params.get("q") || params.get("order") || params.get("tracking") || "").trim().slice(0, 40), true);
})();
