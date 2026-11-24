"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUY_ACTIVE, type CartLine, clearBuyNow, clearCart, readAttribution, readBuyNow } from "./cart";
import { useCartState } from "./cart";
import { browserIds, track } from "./Tracking";

import { rupees } from "@/lib/store-themes";
type Quote = { lines: Array<{ productId: string; variantId: string | null; title: string; variantTitle: string | null; qty: number; unitPaise: number }>; subtotalPaise: number; discountPaise: number; shippingPaise: number; codFeePaise: number; totalPaise: number; coupon: string | null; codAllowed: boolean; codReason: string | null; onlineAllowed: boolean; onlineMethod: string | null; codFeeIfCod: number };
type Pay = { keyId: string; orderId: string; amount: number; name: string; prefill: { name: string; contact: string; email: string } };
declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void } } }
type GatewayStart = { gateway: "cashfree"; mode: "test" | "live"; sessionId: string } | { gateway: "phonepe"; redirectUrl: string } | { gateway: "paytm"; action: string; fields: Record<string, string> };

function loadScript(src: string): Promise<boolean> {
  return new Promise((res) => { const s = document.createElement("script"); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.body.appendChild(s); });
}

/** Hand the buyer to Cashfree / PhonePe / Paytm. They come back to our pay-return URL, which checks the payment with the gateway. */
async function goToGateway(s: GatewayStart): Promise<boolean> {
  if (s.gateway === "phonepe") { if (!s.redirectUrl.startsWith("https://")) return false; window.location.href = s.redirectUrl; return true; }
  if (s.gateway === "paytm") {
    const f = document.createElement("form"); f.method = "POST"; f.action = s.action;
    for (const [k, v] of Object.entries(s.fields)) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); }
    document.body.appendChild(f); f.submit(); return true;
  }
  if (!window.Cashfree && !(await loadScript("https://sdk.cashfree.com/js/v3/cashfree.js"))) return false;
  if (!window.Cashfree) return false;
  await window.Cashfree({ mode: s.mode === "live" ? "production" : "sandbox" }).checkout({ paymentSessionId: s.sessionId, redirectTarget: "_self" });
  return true;
}

const STATES = ["Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"];

function newKey() {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res(true); s.onerror = () => res(false);
    document.body.appendChild(s);
  });
}

export function Checkout({ store, base, storeName, buyNow = false }: { store: string; base: string; storeName: string; buyNow?: boolean }) {
  const cartLines = useCartState(store);
  // Buy now checks out only the item picked on the product page; the cart is left as it is
  const [buyLines, setBuyLines] = useState<CartLine[] | null>(null);
  useEffect(() => {
    if (!buyNow) { try { sessionStorage.removeItem(BUY_ACTIVE(store)); } catch { /* ignore */ } return; }
    setBuyLines(readBuyNow(store));
    try { sessionStorage.setItem(BUY_ACTIVE(store), "1"); } catch { /* ignore */ }
  }, [buyNow, store]);
  const cart = buyNow ? buyLines : cartLines;
  const ckKey = `sf-ck:${store}${buyNow ? ":buy" : ""}`;
  const api = `/api/store/${store}/checkout/`;
  const [b, setB] = useState({ name: "", mobile: "", email: "", line1: "", line2: "", pincode: "", city: "", state: "" });
  const [method, setMethod] = useState<"cod" | "online" | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState("");
  const [q, setQ] = useState<Quote | null>(null);
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string>("");
  const began = useRef(false);
  const lines = useMemo(() => (cart ?? []).map((l: CartLine) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })), [cart]);

  // one checkout key per cart + details, kept across reloads so a retry never creates a second order
  useEffect(() => {
    try { keyRef.current = sessionStorage.getItem(ckKey) || newKey(); sessionStorage.setItem(ckKey, keyRef.current); }
    catch { keyRef.current = newKey(); }
  }, [ckKey]);

  const refresh = useCallback(async (c: string, m: "cod" | "online" | null) => {
    if (!lines.length) return;
    const r = await fetch(api, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines, coupon: c, paymentMethod: m === "cod" ? "cod" : undefined }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr({ msg: j?.error?.message ?? "Could not load prices", field: j?.error?.field });
      if (j?.error?.field === "coupon") { setCoupon(""); }
      return;
    }
    setErr(null); setQ(j);
    if (!began.current) { began.current = true; track({ name: "begin_checkout", value: j.totalPaise / 100, items: j.lines.map((l: Quote["lines"][number]) => ({ id: l.variantId ?? l.productId, name: l.title, price: l.unitPaise / 100, qty: l.qty })) }); }
    setMethod((cur) => cur ?? (j.onlineAllowed ? "online" : j.codAllowed ? "cod" : null));
  }, [api, lines]);

  useEffect(() => { void refresh(coupon, method); }, [refresh, coupon, method]);

  // PIN → city/state (same lookup the rest of Vishwaship uses)
  useEffect(() => {
    if (!/^[1-9]\d{5}$/.test(b.pincode)) return;
    let gone = false;
    fetch(`/api/public/pincode/${b.pincode}/`).then((r) => r.json()).then((j) => {
      if (gone || !j) return;
      const city = j.city ?? j.data?.city; const state = j.state ?? j.data?.state;
      setB((cur) => ({ ...cur, city: cur.city || city || "", state: cur.state || (STATES.find((s) => s.toLowerCase() === String(state ?? "").toLowerCase()) ?? cur.state) }));
    }).catch(() => {});
    return () => { gone = true; };
  }, [b.pincode]);

  if (cart === null) return <p className="sf-note" role="status">Loading…</p>;
  if (!cart.length) return <div className="sf-empty"><p>Your cart is empty.</p><a className="sf-btn" href={`${base}/shop/`}>Continue shopping</a></div>;

  const done = (orderId: string, number: string, token: string) => {
    void orderId;
    if (buyNow) clearBuyNow(store); else clearCart(store);
    try { sessionStorage.removeItem(ckKey); } catch { /* ignore */ }
    window.location.href = `${base}/order/${encodeURIComponent(number)}/?t=${encodeURIComponent(token)}`;
  };

  async function place(e: React.FormEvent) {
    e.preventDefault();
    if (!method) { setErr({ msg: "Choose a payment method" }); return; }
    setBusy(true); setErr(null);
    const r = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkoutKey: keyRef.current, lines, buyer: b, paymentMethod: method === "online" ? q?.onlineMethod : "cod", coupon, attribution: { ...readAttribution(store), ...browserIds(store) } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setErr({ msg: j?.error?.message ?? "Could not place the order", field: j?.error?.field }); if (j?.error?.message?.includes("cancelled")) { keyRef.current = newKey(); try { sessionStorage.setItem(ckKey, keyRef.current); } catch { /* ignore */ } } return; }
    if (j.kind === "placed") { done(j.orderId, j.number, j.token); return; }
    if (j.kind === "gateway") {
      if (!(await goToGateway(j.start as GatewayStart))) { setBusy(false); setErr({ msg: "Could not open the payment page. Check your connection and try again." }); }
      return;
    }
    const pay = j.razorpay as Pay;
    if (!(await loadRazorpay()) || !window.Razorpay) { setBusy(false); setErr({ msg: "Could not open the payment window. Check your connection and try again." }); return; }
    const rz = new window.Razorpay({
      key: pay.keyId, order_id: pay.orderId, amount: pay.amount, currency: "INR", name: pay.name || storeName, description: `Order ${j.number}`, prefill: pay.prefill,
      handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        const c = await fetch(api, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: j.orderId, token: j.token, rzOrderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }) });
        // even if this call fails, the webhook / reconcile confirms the payment; the order page shows the latest state
        void c;
        done(j.orderId, j.number, j.token);
      },
      modal: { ondismiss: () => { setBusy(false); setErr({ msg: "Payment was not completed. You can try again." }); } },
    });
    rz.on("payment.failed", () => { setBusy(false); setErr({ msg: "Payment failed. Please try again or choose another method." }); });
    rz.open();
  }

  const fld = (k: keyof typeof b, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label style={{ display: "grid", gap: 4 }}><span className="sf-note">{label}</span>
      <input className="sf-input" value={b[k]} onChange={(e) => setB({ ...b, [k]: k === "mobile" || k === "pincode" ? e.target.value.replace(/\D/g, "") : e.target.value })} {...extra} /></label>
  );

  return (
    <form className="sf-cartgrid" onSubmit={place}>
      <div style={{ display: "grid", gap: 14 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Delivery details</h2>
        {fld("name", "Full name", { required: true, autoComplete: "name", maxLength: 80 })}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {fld("mobile", "Mobile number", { required: true, inputMode: "numeric", maxLength: 10, autoComplete: "tel-national", placeholder: "10-digit mobile" })}
          {fld("email", "Email (optional)", { type: "email", autoComplete: "email", maxLength: 120 })}
        </div>
        {fld("line1", "House / flat, street", { required: true, autoComplete: "address-line1", maxLength: 200 })}
        {fld("line2", "Area, landmark (optional)", { autoComplete: "address-line2", maxLength: 200 })}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {fld("pincode", "PIN code", { required: true, inputMode: "numeric", maxLength: 6, autoComplete: "postal-code" })}
          {fld("city", "City", { required: true, autoComplete: "address-level2", maxLength: 60 })}
        </div>
        <label style={{ display: "grid", gap: 4 }}><span className="sf-note">State</span>
          <select className="sf-input" required value={b.state} onChange={(e) => setB({ ...b, state: e.target.value })}><option value="">Choose state</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>

        <h2 style={{ fontSize: 18, margin: "8px 0 0" }}>Payment</h2>
        {q && (
          <div role="radiogroup" aria-label="Payment method" style={{ display: "grid", gap: 8 }}>
            <label className="sf-summary" style={{ padding: 14, cursor: q.onlineAllowed ? "pointer" : "not-allowed", opacity: q.onlineAllowed ? 1 : 0.5 }}>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="radio" name="pm" checked={method === "online"} disabled={!q.onlineAllowed} onChange={() => setMethod("online")} /> <b>Pay online</b> <span className="sf-note">UPI, cards, netbanking</span></span>
              {!q.onlineAllowed && <span className="sf-note">Online payment is not available for this store yet.</span>}
            </label>
            <label className="sf-summary" style={{ padding: 14, cursor: q.codAllowed ? "pointer" : "not-allowed", opacity: q.codAllowed ? 1 : 0.5 }}>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="radio" name="pm" checked={method === "cod"} disabled={!q.codAllowed} onChange={() => setMethod("cod")} /> <b>Cash on Delivery</b>{q.codFeeIfCod > 0 && <span className="sf-note">+ {rupees(q.codFeeIfCod)} COD fee</span>}</span>
              {!q.codAllowed && q.codReason && <span className="sf-note">{q.codReason}</span>}
            </label>
          </div>
        )}
      </div>
      <aside className="sf-summary" aria-label="Order summary" style={{ alignSelf: "start" }}>
        <b>Order summary</b>
        {(q?.lines ?? []).map((l) => (
          <div className="row" key={`${l.productId}:${l.variantId ?? ""}`}><span>{l.title}{l.variantTitle ? ` (${l.variantTitle})` : ""} × {l.qty}</span><span>{rupees(l.unitPaise * l.qty)}</span></div>
        ))}
        <div style={{ display: "flex", gap: 6 }}>
          <label className="sr-only" htmlFor="cpn">Coupon code</label>
          <input id="cpn" className="sf-input" placeholder="Coupon code" value={couponInput} maxLength={30} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} style={{ padding: "8px 12px" }} />
          <button type="button" className="sf-btn ghost" style={{ padding: "8px 14px" }} onClick={() => setCoupon(couponInput.trim())} disabled={!couponInput.trim()}>Apply</button>
        </div>
        {q?.coupon && <div className="sf-note">Coupon <b>{q.coupon}</b> applied · <button type="button" className="sf-link" onClick={() => { setCoupon(""); setCouponInput(""); }}>Remove</button></div>}
        {q && <>
          <div className="row"><span>Subtotal</span><span>{rupees(q.subtotalPaise)}</span></div>
          {q.discountPaise > 0 && <div className="row"><span>Discount</span><span>− {rupees(q.discountPaise)}</span></div>}
          <div className="row"><span>Shipping</span><span>{q.shippingPaise ? rupees(q.shippingPaise) : "Free"}</span></div>
          {q.codFeePaise > 0 && <div className="row"><span>COD fee</span><span>{rupees(q.codFeePaise)}</span></div>}
          <div className="row" style={{ borderTop: "1px solid var(--sf-line)", paddingTop: 10 }}><b>Total</b><b>{rupees(q.totalPaise)}</b></div>
        </>}
        {err && <p role="alert" style={{ color: "#b42318", margin: 0, fontSize: 14 }}>{err.msg}</p>}
        <button className="sf-btn" disabled={busy || !q || !method}>{busy ? "Please wait…" : method === "cod" ? "Place order" : "Pay & place order"}</button>
        <p className="sf-note" style={{ margin: 0 }}>By placing the order you agree to the store&apos;s <a href={`${base}/policies/terms/`} style={{ textDecoration: "underline" }}>terms</a> and <a href={`${base}/policies/refund/`} style={{ textDecoration: "underline" }}>refund policy</a>.</p>
      </aside>
    </form>
  );
}
