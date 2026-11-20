/*
 * Vishwaship branded tracking — put your tracking page on your own website.
 *   <div id="vishwaship-tracking"></div>
 *   <script src="https://vishwaship.in/track-embed.js" data-store="your-store" async></script>
 * The tracker is drawn inside your page (no iframe), with your logo and colours. Buyers type their AWB or
 * order ID. A link like yourpage?awb=1234567890 (or ?q= / ?order=) opens that shipment directly.
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
  var STEPS = ["booked", "picked_up", "in_transit", "out_for_delivery", "delivered"];
  var NAMES = ["Booked", "Picked up", "In transit", "Out for delivery", "Delivered"];

  var css = ".vst{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937;max-width:720px;margin:0 auto;line-height:1.45}" +
    ".vst *{box-sizing:border-box}.vst-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:20px;box-shadow:0 8px 24px -12px rgba(0,0,0,.18)}" +
    ".vst-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}.vst-head img{height:44px;max-width:180px;object-fit:contain}.vst-head b{font-size:20px}" +
    ".vst h2{margin:4px 0 6px;font-size:22px}.vst p{margin:0 0 10px;color:#4b5563}" +
    ".vst form{display:flex;gap:8px;margin:10px 0 14px}.vst input{flex:1;min-width:0;padding:12px 14px;border:1px solid #d1d5db;border-radius:10px;font-size:16px}" +
    ".vst button{padding:12px 20px;border:0;border-radius:10px;color:#fff;font-weight:700;font-size:15px;cursor:pointer}" +
    ".vst-res{border-top:1px solid #eef0f3;padding-top:14px;margin-top:6px}.vst-status{display:inline-block;padding:6px 14px;border-radius:999px;font-weight:700;color:#fff;margin:6px 0}" +
    ".vst-bar{display:flex;gap:6px;margin:14px 0}.vst-bar i{flex:1;height:8px;border-radius:999px;background:#e5e7eb}" +
    ".vst-steps{display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-top:-6px}" +
    ".vst-tl{list-style:none;margin:14px 0 0;padding:0}.vst-tl li{position:relative;padding:0 0 12px 22px;border-left:2px solid #e5e7eb;margin-left:6px}" +
    ".vst-tl li:before{content:'';position:absolute;left:-7px;top:3px;width:12px;height:12px;border-radius:50%;background:#cbd5e1}.vst-tl li:first-child:before{background:var(--vst-acc)}" +
    ".vst-tl b{display:block;font-size:14px}.vst-tl span{font-size:12px;color:#6b7280}.vst-err{color:#b91c1c;margin:6px 0}" +
    ".vst-foot{margin-top:14px;font-size:13px;color:#6b7280;border-top:1px solid #eef0f3;padding-top:10px}.vst-pw{margin-top:8px;font-size:11px;color:#9ca3af;text-align:right}" +
    "@media(max-width:520px){.vst form{flex-direction:column}.vst-steps span:nth-child(2),.vst-steps span:nth-child(4){display:none}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var brand = null;
  function render(data, q, err) {
    var b = (data && data.brand) || brand || {};
    brand = b;
    var pri = color(b.primaryColor, "#0b1f3a"), acc = color(b.accentColor, "#f0712c");
    var sh = data && data.shipment;
    var h = '<div class="vst" style="--vst-acc:' + acc + '"><div class="vst-card">';
    h += '<div class="vst-head">' + (b.logo && /^data:image\//.test(b.logo) ? '<img alt="' + esc(b.businessName) + '" src="' + esc(b.logo) + '">' : "") + '<b style="color:' + pri + '">' + esc(b.businessName || "") + "</b></div>";
    h += '<h2 style="color:' + pri + '">' + esc(b.headline || "Track your order") + "</h2>" + (b.message ? "<p>" + esc(b.message) + "</p>" : "");
    h += '<form><input name="q" required maxlength="40" placeholder="Enter AWB or order ID" value="' + esc(q || "") + '" aria-label="AWB or order ID"><button style="background:' + acc + '">Track</button></form>';
    if (err) h += '<p class="vst-err" role="status">' + esc(err) + "</p>";
    if (sh) {
      var idx = Math.max(0, STEPS.indexOf(sh.status));
      var bar = ""; for (var i = 0; i < STEPS.length; i++) bar += '<i style="' + (i <= idx && STEPS.indexOf(sh.status) >= 0 ? "background:" + acc : "") + '"></i>';
      h += '<div class="vst-res"><div style="font-size:13px;color:#6b7280">Order <b style="color:#111827">' + esc(sh.orderNumber) + "</b>" + (sh.awb ? " · AWB " + esc(sh.awb) : "") + (sh.carrierName ? " · " + esc(sh.carrierName) : "") + "</div>";
      h += '<span class="vst-status" style="background:' + pri + '">' + esc(sh.statusLabel || sh.status) + "</span>";
      if (sh.etaDate && sh.status !== "delivered") h += '<div style="font-size:14px">Expected by <b>' + esc(day(sh.etaDate)) + "</b></div>";
      h += '<div class="vst-bar">' + bar + '</div><div class="vst-steps">' + NAMES.map(function (n) { return "<span>" + n + "</span>"; }).join("") + "</div>";
      if (sh.events && sh.events.length) h += '<ul class="vst-tl">' + sh.events.map(function (e) { return "<li><b>" + esc(e.status) + "</b><span>" + esc(e.location || "") + (e.location ? " · " : "") + esc(when(e.at)) + "</span></li>"; }).join("") + "</ul>";
      h += "</div>";
    }
    var help = [b.supportPhone ? "Call " + esc(b.supportPhone) : "", b.supportEmail ? "Email " + esc(b.supportEmail) : "", b.supportHours ? esc(b.supportHours) : ""].filter(Boolean).join(" · ");
    if (help || b.footerText) h += '<div class="vst-foot">' + (help ? "Need help? " + help : "") + (b.footerText ? "<div>" + esc(b.footerText) + "</div>" : "") + "</div>";
    h += '<div class="vst-pw">Tracking by Vishwaship</div></div></div>';
    holder.innerHTML = h;
    holder.querySelector("form").addEventListener("submit", function (ev) { ev.preventDefault(); load(this.q.value.trim()); });
  }
  function load(q) {
    var url = origin + "/api/public/track-widget/?store=" + encodeURIComponent(store) + (q ? "&q=" + encodeURIComponent(q) : "");
    fetch(url).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); }).then(function (r) {
      if (r.status === 404 && r.j.error === "unknown_store") { holder.innerHTML = '<p class="vst-err">Tracking page not found — check data-store, and publish the page in Vishwaship.</p>'; return; }
      var err = r.j.error === "not_found" ? "We couldn’t find that order. Check the AWB or order ID." : r.j.error === "rate_limited" ? "Too many searches. Please try again in a few minutes." : "";
      render(r.j, q, err);
    }).catch(function () { render(null, q, "Tracking is unavailable right now. Please try again."); });
  }
  var p = new URLSearchParams(location.search);
  load((p.get("awb") || p.get("q") || p.get("order") || p.get("tracking") || "").trim().slice(0, 40));
})();
