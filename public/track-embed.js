/*
 * Vishwaship branded tracking — embed on your own website.
 *   <div id="vishwaship-tracking"></div>
 *   <script src="https://vishwaship.in/track-embed.js" data-store="your-store" async></script>
 * Shows your branded tracking page inside your page. Buyers type their AWB or order ID.
 * A link like yourpage?awb=1234567890 (or ?q= / ?order=) opens that shipment directly.
 */
(function () {
  var s = document.currentScript || document.querySelector('script[src*="track-embed.js"][data-store]');
  if (!s) return;
  var store = (s.getAttribute("data-store") || "").replace(/[^a-z0-9-]/gi, "");
  if (!store) return;
  var origin = new URL(s.src).origin;
  var holder = document.getElementById(s.getAttribute("data-target") || "vishwaship-tracking");
  if (!holder) { holder = document.createElement("div"); s.parentNode.insertBefore(holder, s); }
  var p = new URLSearchParams(location.search);
  var q = (p.get("awb") || p.get("q") || p.get("order") || p.get("tracking") || "").trim().slice(0, 40);
  var f = document.createElement("iframe");
  f.src = origin + "/t/" + encodeURIComponent(store) + "/" + (q ? "?q=" + encodeURIComponent(q) : "");
  f.title = "Track your order";
  f.style.cssText = "width:100%;border:0;min-height:" + (s.getAttribute("data-min-height") || "640") + "px;display:block;background:transparent";
  f.setAttribute("allow", "clipboard-write");
  holder.appendChild(f);
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || e.source !== f.contentWindow) return;
    var d = e.data || {};
    if (d.type === "vishwaship-track-height" && d.height > 200 && d.height < 20000) f.style.height = Math.ceil(d.height) + "px";
  });
})();
