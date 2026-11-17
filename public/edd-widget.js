/* Vishwaship EDD widget — <div data-vishwaship-edd="KEY"></div><script src="https://YOUR-VISHWASHIP-HOST/edd-widget.js" async></script> */
(function () {
  var s = document.currentScript, base = s ? new URL(s.src).origin : "";
  function el(t, a, c) { var e = document.createElement(t); for (var k in a) e.setAttribute(k, a[k]); if (c) e.textContent = c; return e; }
  function fmt(d) { return new Date(d + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
  document.querySelectorAll("[data-vishwaship-edd]").forEach(function (box) {
    if (box.dataset.ready) return; box.dataset.ready = "1";
    var key = box.getAttribute("data-vishwaship-edd"), color = box.getAttribute("data-color") || "#f0712c";
    var f = el("form", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center;font:14px system-ui,sans-serif" });
    var lab = el("label", { style: "width:100%;font-weight:600" }, box.getAttribute("data-heading") || "Check delivery date");
    var inp = el("input", { inputmode: "numeric", maxlength: "6", placeholder: "PIN code", "aria-label": "Delivery PIN code", style: "padding:8px 10px;border:1px solid #ccc;border-radius:6px;width:120px" });
    var btn = el("button", { type: "submit", style: "padding:8px 14px;border:0;border-radius:6px;color:#fff;cursor:pointer;background:" + color }, box.getAttribute("data-button") || "Check");
    var out = el("div", { role: "status", "aria-live": "polite", style: "width:100%;margin-top:4px" });
    f.appendChild(lab); f.appendChild(inp); f.appendChild(btn); f.appendChild(out); box.appendChild(f);
    f.addEventListener("submit", function (e) {
      e.preventDefault(); var pin = inp.value.trim();
      if (!/^[1-9]\d{5}$/.test(pin)) { out.textContent = "Enter a valid 6-digit PIN code."; return; }
      out.textContent = "Checking…"; btn.disabled = true;
      fetch(base + "/api/public/edd/?key=" + encodeURIComponent(key) + "&pin=" + pin).then(function (r) { return r.json(); }).then(function (j) {
        out.textContent = j.error ? j.error : j.serviceable ? "Delivery by " + fmt(j.date) + (j.courier ? " via " + j.courier : "") : "Sorry, we do not deliver to this PIN code yet.";
      }).catch(function () { out.textContent = "Could not check right now. Please try again."; }).finally(function () { btn.disabled = false; });
    });
  });
})();
