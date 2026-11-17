"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, MapPin, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { AddressForm, type SavedWarehouse } from "@/components/portal/AddressForm";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";
import type { OfferView } from "@/components/public/RateCalculator";

type WH = { id: string; label: string; city: string; pincode: string; verified: boolean; isDefault: boolean; mobileMasked?: string };
type Addr = { label: string; line1: string; line2?: string; pincode: string; city: string; state: string };
type Pkg = { count: string; l: string; b: string; h: string; w: string };
type Prod = { name: string; qty: string; price: string; hsn: string };
export type Library = {
  buyers: Array<{ id: string; name: string; mobile: string; email: string; addresses: Array<{ label: string; line1: string; line2?: string; pincode: string; city: string; state: string }> }>;
  products: Array<{ id: string; name: string; sku: string; price: number; hsn: string; weightKg: number; l: number; b: number; h: number }>;
  presets: Array<{ id: string; name: string; l: number; b: number; h: number; tareKg: number; isDefault: boolean }>;
  tags: Array<{ id: string; name: string; color: string }>;
};

const PRESETS: Array<{ label: string; pkg: Pkg }> = [
  { label: "Small box 20×15×10", pkg: { count: "1", l: "20", b: "15", h: "10", w: "0.5" } },
  { label: "Medium 30×25×15", pkg: { count: "1", l: "30", b: "25", h: "15", w: "2" } },
  { label: "Carton 50×40×40", pkg: { count: "1", l: "50", b: "40", h: "40", w: "12" } },
];

const STEPS = ["Addresses", "Packages", "Courier & Payment"] as const;

export function CreateShipment(props: { warehouses: WH[]; walletPaise: number; b2bThresholdGrams: number; direction: "forward" | "reverse"; initial: { destination?: string; weightKg?: string; mode?: "B2B" }; library?: Library }) {
  const lib = props.library ?? { buyers: [], products: [], presets: [], tags: [] };
  const myPresets: Array<{ label: string; pkg: Pkg }> = lib.presets.map((p) => ({ label: `${p.name} ${p.l}×${p.b}×${p.h}`, pkg: { count: "1", l: String(p.l), b: String(p.b), h: String(p.h), w: String(Math.max(p.tareKg, 0.1)) } }));
  const allPresets = [...myPresets, ...PRESETS];
  const defBox = myPresets[lib.presets.findIndex((p) => p.isDefault)];
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [saveBuyer, setSaveBuyer] = useState(false);
  const [whs, setWhs] = useState<WH[]>(props.warehouses);
  const def = props.warehouses.find((w) => w.isDefault) ?? props.warehouses[0];
  const [dialog, setDialog] = useState<null | "add" | "change">(null);
  const [verifying, setVerifying] = useState(false);
  const [whNote, setWhNote] = useState<string | null>(null);
  const [whBusy, setWhBusy] = useState<string | null>(null);
  const [fe, setFe] = useState<{ line1?: string; pin?: string; pinRetry?: boolean; mobile?: string }>({});
  const [pinState, setPinState] = useState<"idle" | "loading">("idle");
  const [match, setMatch] = useState<null | { id: string; name: string; email: string; addresses: Addr[] }>(null);
  const [matchState, setMatchState] = useState<"idle" | "loading" | "none">("idle");
  const latestPin = useRef("");
  const latestMobile = useRef("");
  const [step, setStep] = useState(0);
  const [warehouseId, setWarehouseId] = useState(def.id);
  const [pickupDate, setPickupDate] = useState(new Date(Date.now() + 86400_000).toISOString().slice(0, 10));
  const [c, setC] = useState({ name: "", mobile: "", email: "", line1: "", line2: "", pincode: props.initial.destination ?? "", city: "", state: "" });
  const [orderNumber, setOrderNumber] = useState("");
  const [payment, setPayment] = useState<"prepaid" | "cod" | "fod">("prepaid");
  const [notices, setNotices] = useState<string[]>([]);
  const [cod, setCod] = useState("");
  const [declared, setDeclared] = useState("");
  const [invoice, setInvoice] = useState("");
  const [eway, setEway] = useState("");
  const [products, setProducts] = useState<Prod[]>([{ name: "", qty: "1", price: "", hsn: "" }]);
  const [pkgs, setPkgs] = useState<Pkg[]>([defBox && !props.initial.weightKg ? { ...defBox.pkg } : { count: "1", l: "20", b: "15", h: "10", w: props.initial.weightKg ?? "0.5" }]);
  const [modeOverride, setModeOverride] = useState<"B2C" | "B2B" | null>(props.initial.mode ?? null);
  const [offers, setOffers] = useState<OfferView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [done, setDone] = useState<{ awb: string | null; shipmentId: string; state: string } | null>(null);

  const wh = whs.find((w) => w.id === warehouseId) ?? whs[0];
  const weights = useMemo(() => {
    let actual = 0, vol = 0, boxes = 0;
    const per = pkgs.map((p) => {
      const n = Number(p.count) || 0, l = Number(p.l) || 0, b = Number(p.b) || 0, h = Number(p.h) || 0, w = Number(p.w) || 0;
      const v = (l * b * h) / 5000;
      actual += w * n; vol += v * n; boxes += n;
      return { v, w, n };
    });
    return { actual, vol, boxes, per };
  }, [pkgs]);
  const suggested: "B2C" | "B2B" = Math.max(weights.actual, weights.vol) * 1000 >= props.b2bThresholdGrams ? "B2B" : "B2C";
  const mode = modeOverride ?? suggested;
  const declaredValue = Number(declared) || products.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
  const chosen = offers?.find((o) => o.quoteId === selected) ?? null;

  async function lookupPin(v: string) {
    latestPin.current = v;
    setPinState("loading"); setFe((x) => ({ ...x, pin: undefined, pinRetry: false }));
    try {
      const r = await fetch(`/api/portal/pincode/${v}`);
      const j = await r.json().catch(() => ({}));
      if (latestPin.current !== v) return; // a newer PIN was typed — ignore this late answer
      if (r.ok) setC((s) => (s.pincode === v ? { ...s, city: j.city || s.city, state: j.state || s.state } : s));
      else if (r.status === 404 || r.status === 422) setFe((x) => ({ ...x, pin: j.error?.message ?? "No match for this PIN code" }));
      else setFe((x) => ({ ...x, pin: "Could not look up this PIN right now.", pinRetry: true }));
    } catch { if (latestPin.current === v) setFe((x) => ({ ...x, pin: "Could not look up this PIN right now.", pinRetry: true })); }
    finally { if (latestPin.current === v) setPinState("idle"); }
  }
  const setPin = (pin: string) => {
    const v = pin.replace(/\D/g, "").slice(0, 6);
    if (v === c.pincode) return;
    // new PIN → clear the old locality, then look it up automatically once complete
    setC((s) => ({ ...s, pincode: v, city: "", state: "" }));
    setFe((x) => ({ ...x, pin: undefined, pinRetry: false }));
    latestPin.current = v;
    if (/^[1-9]\d{5}$/.test(v)) void lookupPin(v);
    else if (v.length === 6) setFe((x) => ({ ...x, pin: "Enter a valid 6-digit PIN code" }));
  };
  const fillFrom = (b: { name: string; email: string; mobile?: string }, a: Addr) => {
    latestPin.current = a.pincode;
    setC((s) => ({ ...s, name: b.name, email: b.email || s.email, line1: a.line1, line2: a.line2 ?? "", pincode: a.pincode, city: a.city, state: a.state }));
    setFe({});
  };
  async function lookupMobile(m: string) {
    latestMobile.current = m;
    setMatchState("loading");
    try {
      const r = await fetch(`/api/portal/buyers/lookup?mobile=${m}`);
      const j = await r.json().catch(() => ({}));
      if (latestMobile.current !== m) return; // number changed while looking up
      if (r.ok && j.match) {
        setMatch(j.match); setMatchState("idle");
        if (j.match.addresses.length === 1) fillFrom(j.match, j.match.addresses[0]);
      } else { setMatch(null); setMatchState("none"); }
    } catch { if (latestMobile.current === m) { setMatch(null); setMatchState("idle"); } }
  }
  const setMobile = (raw: string) => {
    setC((s) => ({ ...s, mobile: raw }));
    const m = raw.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
    latestMobile.current = m;
    if (/^[6-9]\d{9}$/.test(m)) void lookupMobile(m); else { setMatch(null); setMatchState("idle"); }
  };
  useEffect(() => { if (/^[1-9]\d{5}$/.test(c.pincode) && !c.city && !c.state) void lookupPin(c.pincode); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /** Switch the pickup warehouse for THIS shipment only; rates and pickup date are re-checked. */
  function chooseWarehouse(id: string, note?: string) {
    const next = whs.find((w) => w.id === id);
    setWarehouseId(id);
    setDialog(null); setVerifying(false);
    if (offers) { setOffers(null); setSelected(null); }
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const pd = pickupDate < today ? new Date(Date.now() + 86400_000).toISOString().slice(0, 10) : pickupDate;
    if (pd !== pickupDate) setPickupDate(pd);
    setWhNote(note ?? (next && next.pincode !== wh?.pincode ? `Pickup changed to ${next.label} (${next.pincode}). Courier rates will be refreshed before you book.` : null));
  }
  async function setDefaultWarehouse(id: string) {
    setWhBusy(id);
    const r = await fetch(`/api/portal/warehouses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_default" }) });
    setWhBusy(null);
    if (r.ok) setWhs((l) => l.map((w) => ({ ...w, isDefault: w.id === id })));
    else setWhNote((await r.json().catch(() => ({}))).error?.message ?? "Could not set default");
  }

  function validateStep(i: number): string | null {
    if (i === 0) {
      if (!wh) return "Add a pickup warehouse first.";
      if (!wh.verified) return "Verify this pickup mobile with OTP before continuing.";
      if (c.name.trim().length < 2) return "Enter the consignee name.";
      if (!/^[6-9]\d{9}$/.test(c.mobile.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, ""))) return "Enter a valid 10-digit consignee mobile.";
      if (!c.line1.trim()) { setFe((x) => ({ ...x, line1: "Please enter Address line 1" })); return "Please enter Address line 1"; }
      if (c.line1.trim().length < 3) { setFe((x) => ({ ...x, line1: "Address line 1 is too short" })); return "Address line 1 is too short"; }
      if (!/^[1-9]\d{5}$/.test(c.pincode)) return "Delivery PIN code must be 6 digits.";
      if (!c.city || !c.state) return pinState === "loading" ? "Finding city and state for this PIN — one moment." : "Enter City / District and State.";
    }
    if (i === 1) {
      if (products.some((p) => !p.name.trim() || !(Number(p.qty) > 0))) return "Each product needs a name and quantity.";
      if (pkgs.some((p) => !(Number(p.count) > 0 && Number(p.l) > 0 && Number(p.b) > 0 && Number(p.h) > 0 && Number(p.w) > 0))) return "Each package row needs count, L × B × H and weight.";
      if (!(declaredValue > 0)) return "Enter the declared (invoice) value.";
      if (payment === "cod" && !(Number(cod) > 0)) return "Enter the COD amount to collect.";
      if (mode === "B2B" && declaredValue >= 50000 && !/^\d{12}$/.test(eway)) return "E-way bill (12 digits) is required for ₹50,000 or more.";
    }
    return null;
  }

  async function next() {
    const e = validateStep(step);
    if (e) { setErr(e); return; }
    setErr(null);
    if (step === 1) await fetchQuotes();
    setStep((s) => Math.min(2, s + 1));
  }

  async function fetchQuotes() {
    setBusy(true); setOffers(null); setSelected(null);
    try {
      const r = await fetch("/api/portal/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        mode, originPincode: wh.pincode, destinationPincode: c.pincode, paymentType: payment,
        codAmountRupees: payment === "cod" ? Number(cod) : 0, declaredValueRupees: declaredValue,
        packages: pkgs.map((p) => ({ count: Number(p.count), lengthCm: Number(p.l), breadthCm: Number(p.b), heightCm: Number(p.h), weightKg: Number(p.w) })),
      }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Could not fetch rates");
      setOffers(j.offers); setNotices(j.notices ?? []);
      if (j.offers[0]) setSelected(j.offers[0].quoteId);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function book() {
    if (!chosen) return;
    if (new Date(chosen.expiresAt).getTime() < Date.now()) { setErr("This quote expired. Refreshing rates…"); await fetchQuotes(); return; }
    const youPay = chosen.payer?.sender ?? chosen.total;
    if (youPay > props.walletPaise) { setErr(`Insufficient wallet balance. You need ${formatINR(youPay - props.walletPaise)} more.`); return; }
    setBusy(true); setErr(null);
    try {
      let id = orderId;
      if (!id) {
        const r = await fetch("/api/portal/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          orderNumber: orderNumber.trim() || undefined, mode, direction: props.direction, paymentType: payment,
          codAmountRupees: payment === "cod" ? Number(cod) : 0, declaredValueRupees: declaredValue, warehouseId,
          consignee: { ...c, mobile: c.mobile, email: c.email || undefined, line2: c.line2 || undefined },
          products: products.map((p) => ({ name: p.name, qty: Number(p.qty), unitPriceRupees: Number(p.price) || 0, hsn: p.hsn || undefined })),
          packages: pkgs.map((p) => ({ count: Number(p.count), lengthCm: Number(p.l), breadthCm: Number(p.b), heightCm: Number(p.h), weightKg: Number(p.w) })),
          invoiceNumber: invoice || undefined, ewayBill: eway || undefined, tagIds, saveBuyer,
        }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error?.message ?? j.error?.issues?.[0]?.message ?? "Could not create order");
        id = j.orderId as string;
        setOrderId(id);
        if (j.codHold) { setDone({ awb: null, shipmentId: "", state: "cod_hold" }); return; }
      }
      const r = await fetch(`/api/portal/orders/${id}/book`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: chosen.quoteId }) });
      const j = await r.json();
      if (r.status === 202) { setDone({ awb: null, shipmentId: "", state: "ambiguous" }); return; }
      if (!r.ok) throw new Error(j.error?.message ?? "Booking failed");
      setDone({ awb: j.awb, shipmentId: j.shipmentId, state: j.state });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="card" style={{ padding: 28, maxWidth: 640 }} role="status">
        <CheckCircle2 size={36} color="var(--green)" />
        {done.state === "cod_hold" ? (
          <><h2 style={{ fontSize: 20 }}>Order created — waiting for buyer confirmation</h2><p className="muted">Your COD confirmation subscription is on, so we’ve sent the buyer a WhatsApp Confirm / Cancel message. The order will be released for booking once they confirm.</p></>
        ) : done.state === "ambiguous" ? (
          <><h2 style={{ fontSize: 20 }}>Booking is being confirmed</h2><p className="muted">The courier didn’t respond in time. Your funds are on hold (not charged) while we check with the courier. No duplicate booking will be created.</p></>
        ) : (
          <>
            <h2 style={{ fontSize: 20 }}>Shipment booked</h2>
            <dl className="kv-list mt12">
              <dt>AWB / LR</dt><dd className="mono">{done.awb ?? "Awaiting courier manifest"}</dd>
              <dt>Courier</dt><dd>{chosen?.carrierName} · {chosen?.serviceName}</dd>
              <dt>Charged</dt><dd>{chosen && formatINR(chosen.total)}</dd>
              <dt>Pickup</dt><dd>Requested for {new Date(pickupDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</dd>
            </dl>
            {chosen?.isDemo && <p className="mt8"><span className="demo-badge">DEMO BOOKING — not sent to a real courier</span></p>}
          </>
        )}
        <div className="row wrap mt16" style={{ gap: 8 }}>
          {orderId && <Link className="btn btn-orange" href={`/portal/orders/${orderId}/`}>View order &amp; label</Link>}
          <Link className="btn btn-outline" href="/portal/orders/new/">Create another</Link>
        </div>
      </div>
    );
  }

  const summary = (
    <aside className="card sticky-side" style={{ padding: 18 }} aria-label="Shipment summary">
      <h2 className="b" style={{ fontSize: 15, margin: "0 0 10px" }}>Summary</h2>
      <dl className="kv-list">
        <dt>From</dt><dd>{wh.label}, {wh.pincode}</dd>
        <dt>To</dt><dd>{c.pincode ? `${c.city || ""} ${c.pincode}` : "—"}</dd>
        <dt>Type</dt><dd>{mode} · {payment === "cod" ? `COD ${formatINR(Math.round(Number(cod || 0) * 100))}` : payment === "fod" ? "FOD (receiver pays freight)" : "Prepaid"}</dd>
        <dt>Boxes</dt><dd>{weights.boxes}</dd>
        <dt>Actual wt.</dt><dd>{weights.actual.toFixed(2)} kg</dd>
        <dt>Volumetric</dt><dd>{weights.vol.toFixed(2)} kg</dd>
        <dt>Chargeable</dt><dd>{chosen ? `${(chosen.chargeableWeightGrams / 1000).toFixed(2)} kg (quoted)` : "After courier quote"}</dd>
        <dt>Wallet</dt><dd>{formatINR(props.walletPaise)}</dd>
        {chosen && (chosen.payer && chosen.payer.receiver > 0
          ? <><dt>Receiver pays</dt><dd style={{ color: "var(--orange)", fontSize: 18 }}>{formatINR(chosen.payer.receiver)}</dd><dt>You pay</dt><dd>{formatINR(chosen.payer.sender)}</dd></>
          : <><dt>Total</dt><dd style={{ color: "var(--orange)", fontSize: 18 }}>{formatINR(chosen.total)}</dd></>)}
      </dl>
      <p className="tiny muted mt8">Carrier re-weigh may revise the chargeable weight after pickup.</p>
    </aside>
  );

  return (
    <div>
      <ol className="stepper mb16" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "cur" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}><span className="n">{i + 1}</span>{s}</li>)}
      </ol>
      <div className="split-2-1 create-grid" style={{ gap: 16, alignItems: "start" }}>
        <div className="col" style={{ gap: 16 }}>
          {step === 0 && (
            <>
              <section className="card" style={{ padding: 18 }}>
                <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Pickup</h2>
                <div className="grid2 pickup-grid" style={{ gap: 12 }}>
                  <div>
                    <div className="field"><label htmlFor="wh">Pickup address</label>
                      <select id="wh" className="select" value={warehouseId} onChange={(e) => chooseWarehouse(e.target.value)}>
                        {whs.map((w) => <option key={w.id} value={w.id}>{w.label} — {w.city} {w.pincode}{w.verified ? "" : " (mobile not verified)"}</option>)}
                      </select>
                    </div>
                    <div className="row wrap pickup-actions" style={{ gap: 8, marginTop: 8 }}>
                      <button type="button" className="btn btn-sm btn-orange" onClick={() => setDialog("add")}><Plus size={14} /> Add New Warehouse</button>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => setDialog("change")}><MapPin size={14} /> Change Warehouse</button>
                    </div>
                  </div>
                  <div className="field"><label htmlFor="pd">Pickup date</label><input id="pd" className="input" type="date" value={pickupDate} min={new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)} onChange={(e) => setPickupDate(e.target.value)} /></div>
                </div>
                {whNote && <p className="note small mt8" role="status">{whNote}</p>}
                {wh && (wh.verified
                  ? <p className="small mt8 t-credit">✓ Pickup mobile {wh.mobileMasked ?? ""} verified</p>
                  : <div className="err-box small mt8" role="alert">This pickup mobile{wh.mobileMasked ? ` (${wh.mobileMasked})` : ""} isn’t verified yet.{" "}
                      {!verifying ? <button type="button" className="linkbtn" onClick={() => setVerifying(true)}>Verify with OTP</button>
                        : <AddressForm verifyId={wh.id} mobile={wh.mobileMasked} onVerified={(id) => { setWhs((l) => l.map((w) => (w.id === id ? { ...w, verified: true } : w))); setVerifying(false); setWhNote("Pickup mobile verified."); }} />}
                    </div>)}
              </section>
              {dialog && (
                <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setDialog(null); }}>
                  <div className="modal" role="dialog" aria-modal="true" aria-labelledby="wh-dlg-h" onKeyDown={(e) => { if (e.key === "Escape") setDialog(null); }}>
                    <div className="row between" style={{ marginBottom: 8 }}>
                      <h2 id="wh-dlg-h" className="b" style={{ fontSize: 16, margin: 0 }}>{dialog === "add" ? "Add New Warehouse" : "Change Warehouse"}</h2>
                      <button type="button" className="icon-btn" aria-label="Close" onClick={() => setDialog(null)} autoFocus><X size={18} /></button>
                    </div>
                    {dialog === "add" ? (
                      <AddressForm
                        onCancel={() => setDialog(null)}
                        onSaved={(w: SavedWarehouse) => { setWhs((l) => [...l, w]); chooseWarehouse(w.id, `Added ${w.label} and selected it for this shipment. Verify its pickup mobile with the OTP below.`); setDialog("add"); setVerifying(false); }}
                        onVerified={(id) => { setWhs((l) => l.map((w) => (w.id === id ? { ...w, verified: true } : w))); setDialog(null); setWhNote("New warehouse saved, selected and verified."); }} />
                    ) : (
                      whs.length === 0 ? <p className="muted small">No saved warehouses yet. <button type="button" className="linkbtn" onClick={() => setDialog("add")}>Add one</button></p> : (
                        <ul className="plain-list wh-pick" aria-label="Your warehouses">
                          {whs.map((w) => (
                            <li key={w.id} className={w.id === warehouseId ? "on" : ""}>
                              <div style={{ minWidth: 0 }}>
                                <b className="small">{w.label}</b>{w.id === warehouseId && <span className="chip c-active" style={{ marginLeft: 6 }}>Selected</span>}{w.isDefault && <span className="chip c-draft" style={{ marginLeft: 6 }}>Default</span>}
                                <div className="tiny muted">{w.city} {w.pincode} · mobile {w.mobileMasked ?? "—"} · {w.verified ? <span className="t-credit">verified</span> : <span className="t-debit">not verified</span>}</div>
                              </div>
                              <span className="row" style={{ gap: 6 }}>
                                {w.id !== warehouseId && <button type="button" className="btn btn-sm btn-navy" onClick={() => chooseWarehouse(w.id)}>Use for this shipment</button>}
                                {!w.isDefault && <button type="button" className="btn btn-sm btn-outline" disabled={whBusy === w.id} onClick={() => setDefaultWarehouse(w.id)}>{whBusy === w.id ? "Saving…" : "Set as Default"}</button>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )
                    )}
                    <p className="tiny muted mt8">Your shipment draft is kept — closing this window changes nothing.</p>
                  </div>
                </div>
              )}
              <section className="card" style={{ padding: 18 }}>
                <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
                  <h2 className="b" style={{ fontSize: 15, margin: 0 }}>{props.direction === "reverse" ? "Return from (customer)" : "Deliver to"}</h2>
                  {lib.buyers.length > 0 && <><label className="sr-only" htmlFor="savedBuyer">Saved customer</label>
                  <select id="savedBuyer" className="select" style={{ maxWidth: 260 }} value="" onChange={(e) => {
                    const [bid, ai] = e.target.value.split("|"); const b = lib.buyers.find((x) => x.id === bid); const a = b?.addresses[Number(ai)];
                    if (b && a) setC({ name: b.name, mobile: b.mobile, email: b.email, line1: a.line1, line2: a.line2 ?? "", pincode: a.pincode, city: a.city, state: a.state });
                  }}><option value="">Use saved customer…</option>{lib.buyers.flatMap((b) => b.addresses.map((a, i) => <option key={`${b.id}${i}`} value={`${b.id}|${i}`}>{b.name} · {a.label} · {a.city} {a.pincode}</option>))}</select></>}
                </div>
                <div className="grid2" style={{ gap: 12 }}>
                  <div className="field"><label htmlFor="cn">Name</label><input id="cn" className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoComplete="off" /></div>
                  <div className="field"><label htmlFor="cm">Mobile</label><input id="cm" className="input" inputMode="tel" autoComplete="off" value={c.mobile} onChange={(e) => setMobile(e.target.value)} onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); setMobile(t.trim()); } }} />
                    {matchState === "loading" && <span className="tiny muted">Looking up saved customers…</span>}
                    {match && match.addresses.length === 1 && <span className="tiny t-credit">Filled from saved customer {match.name}</span>}
                    {matchState === "none" && <span className="tiny muted">New customer — enter the details below.</span>}
                  </div>
                  {match && match.addresses.length > 1 && (
                    <fieldset className="addr-pick" style={{ gridColumn: "1 / -1" }}>
                      <legend className="small b">{match.name} has {match.addresses.length} saved addresses — choose one</legend>
                      {match.addresses.map((a, i) => <button key={i} type="button" className="btn btn-sm btn-outline" onClick={() => fillFrom(match, a)}>{a.label}: {a.line1}, {a.city} {a.pincode}</button>)}
                    </fieldset>
                  )}
                  <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="c1">Address line 1 <span aria-hidden className="t-debit">*</span></label><input id="c1" className={`input${fe.line1 ? " invalid" : ""}`} required aria-required="true" aria-invalid={!!fe.line1} aria-describedby={fe.line1 ? "c1-err" : undefined} value={c.line1} onChange={(e) => { setC({ ...c, line1: e.target.value }); if (fe.line1 && e.target.value.trim()) setFe((x) => ({ ...x, line1: undefined })); }} onBlur={() => { if (!c.line1.trim()) setFe((x) => ({ ...x, line1: "Please enter Address line 1" })); }} />
                    {fe.line1 && <span id="c1-err" className="field-err" role="alert">{fe.line1}</span>}</div>
                  <label className="check small" style={{ gridColumn: "1 / -1", order: 99 }}><input type="checkbox" checked={saveBuyer} onChange={(e) => setSaveBuyer(e.target.checked)} /> {match ? "Save these details to this saved customer" : "Save to Customers for next time"}</label>
                  <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="c2">Address line 2 (optional)</label><input id="c2" className="input" value={c.line2} onChange={(e) => setC({ ...c, line2: e.target.value })} /></div>
                  <div className="field"><label htmlFor="cp">PIN code</label><input id="cp" className={`input hl${fe.pin ? " invalid" : ""}`} inputMode="numeric" maxLength={6} aria-invalid={!!fe.pin} aria-describedby={fe.pin ? "cp-err" : undefined} value={c.pincode} onChange={(e) => setPin(e.target.value)} />
                    {pinState === "loading" && <span className="tiny muted">Finding city and state…</span>}
                    {fe.pin && <span id="cp-err" className="field-err" role="alert">{fe.pin}{fe.pinRetry && <> <button type="button" className="linkbtn" onClick={() => lookupPin(c.pincode)}><RefreshCw size={12} /> Retry</button></>}</span>}</div>
                  <div className="field"><label htmlFor="cc">City / district</label><input id="cc" className="input" value={c.city} onChange={(e) => setC({ ...c, city: e.target.value })} /></div>
                  <div className="field"><label htmlFor="cs">State</label><input id="cs" className="input" value={c.state} onChange={(e) => setC({ ...c, state: e.target.value })} /></div>
                  <div className="field"><label htmlFor="ce">Email (optional)</label><input id="ce" className="input" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
                </div>
              </section>
            </>
          )}
          {step === 1 && (
            <>
              <section className="card" style={{ padding: 18 }}>
                <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Order &amp; payment</h2>
                <div className="grid2" style={{ gap: 12 }}>
                  <div className="field"><label htmlFor="on">Order ID (optional)</label><input id="on" className="input" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Auto-generated if empty" /></div>
                  {lib.tags.length > 0 && <fieldset style={{ border: 0, padding: 0, margin: 0, gridColumn: "1 / -1" }}><legend className="small b">Tags</legend><div className="row wrap" style={{ gap: 6 }}>{lib.tags.map((t) => { const on = tagIds.includes(t.id); return <button key={t.id} type="button" className="chip" aria-pressed={on} onClick={() => setTagIds(on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])} style={{ background: on ? t.color : "transparent", color: on ? "#fff" : t.color, border: `1px solid ${t.color}`, cursor: "pointer" }}>{t.name}</button>; })}</div></fieldset>}
                  <div className="field"><label htmlFor="pt">Payment</label><select id="pt" className="select" value={payment} onChange={(e) => setPayment(e.target.value as "prepaid" | "cod" | "fod")}><option value="prepaid">Prepaid — you pay freight</option><option value="cod">COD — receiver pays goods value</option><option value="fod">FOD — receiver pays freight</option></select></div>
                  {payment === "cod" && <div className="field"><label htmlFor="ca">COD amount to collect (₹)</label><input id="ca" className="input" type="number" min="1" value={cod} onChange={(e) => setCod(e.target.value)} /></div>}
                  <div className="field"><label htmlFor="dv">Declared / invoice value (₹)</label><input id="dv" className="input" type="number" min="1" value={declared} onChange={(e) => setDeclared(e.target.value)} placeholder={declaredValue ? String(declaredValue) : ""} /></div>
                  <div className="field"><label htmlFor="inv">Invoice number</label><input id="inv" className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></div>
                  {mode === "B2B" && <div className="field"><label htmlFor="ew">E-way bill</label><input id="ew" className="input" inputMode="numeric" maxLength={12} value={eway} onChange={(e) => setEway(e.target.value.replace(/\D/g, ""))} /></div>}
                </div>
              </section>
              <section className="card" style={{ padding: 18 }}>
                <div className="row between wrap" style={{ gap: 6 }}><h2 className="b" style={{ fontSize: 15, margin: 0 }}>Products</h2><span className="row wrap" style={{ gap: 6 }}>
                  {lib.products.length > 0 && <><label className="sr-only" htmlFor="savedProd">Saved product</label><select id="savedProd" className="select" style={{ maxWidth: 220 }} value="" onChange={(e) => {
                    const p = lib.products.find((x) => x.id === e.target.value); if (!p) return;
                    const row = { name: `${p.name} (${p.sku})`, qty: "1", price: String(p.price), hsn: p.hsn };
                    setProducts(products.length === 1 && !products[0].name ? [row] : [...products, row]);
                    if (p.weightKg > 0 && pkgs.length === 1 && p.l > 0) setPkgs([{ count: "1", l: String(p.l), b: String(p.b), h: String(p.h), w: String(p.weightKg) }]);
                  }}><option value="">Add saved product…</option>{lib.products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></>}
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setProducts([...products, { name: "", qty: "1", price: "", hsn: "" }])}><Plus size={14} /> Add product</button></span></div>
                {products.map((p, i) => (
                  <div key={i} className="grid4 mt12" style={{ gap: 8, alignItems: "end" }}>
                    <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor={`pn${i}`}>Name</label><input id={`pn${i}`} className="input" value={p.name} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></div>
                    <div className="field"><label htmlFor={`pq${i}`}>Qty</label><input id={`pq${i}`} className="input" type="number" min="1" value={p.qty} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></div>
                    <div className="field"><label htmlFor={`pp${i}`}>Unit price ₹</label><input id={`pp${i}`} className="input" type="number" min="0" value={p.price} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} /></div>
                    <div className="field"><label htmlFor={`ph${i}`}>HSN</label><input id={`ph${i}`} className="input" value={p.hsn} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, hsn: e.target.value } : x))} /></div>
                    {products.length > 1 && <button type="button" className="icon-btn" aria-label={`Remove product ${i + 1}`} onClick={() => setProducts(products.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}
                  </div>
                ))}
              </section>
              <section className="card" style={{ padding: 18 }}>
                <div className="row between wrap" style={{ gap: 8 }}>
                  <h2 className="b" style={{ fontSize: 15, margin: 0 }}>Packages</h2>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <label className="sr-only" htmlFor="preset">Package preset</label>
                    <select id="preset" className="select" style={{ maxWidth: 200 }} value="" onChange={(e) => { const p = allPresets[Number(e.target.value)]; if (p) setPkgs([...pkgs, { ...p.pkg }]); }}>
                      <option value="">Add from preset…</option>{allPresets.map((p, i) => <option key={p.label + i} value={i}>{i < myPresets.length ? "★ " : ""}{p.label}</option>)}
                    </select>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setPkgs([...pkgs, { count: "1", l: "", b: "", h: "", w: "" }])}><Plus size={14} /> Add package type</button>
                  </div>
                </div>
                <div className="tbl-wrap mt12">
                  <table className="tbl">
                    <thead><tr><th>Boxes</th><th>L cm</th><th>B cm</th><th>H cm</th><th>Weight / box kg</th><th>Vol. / box</th><th><span className="sr-only">Remove</span></th></tr></thead>
                    <tbody>
                      {pkgs.map((p, i) => (
                        <tr key={i}>
                          {(["count", "l", "b", "h", "w"] as const).map((k) => (
                            <td key={k}><input aria-label={`${k} for package ${i + 1}`} className="input" style={{ minWidth: 64 }} type="number" min="0" step={k === "w" ? "0.01" : "1"} value={p[k]} onChange={(e) => setPkgs(pkgs.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></td>
                          ))}
                          <td className="small">{weights.per[i]?.v.toFixed(2)} kg</td>
                          <td>{pkgs.length > 1 && <button type="button" className="icon-btn" aria-label={`Remove package ${i + 1}`} onClick={() => setPkgs(pkgs.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row wrap mt12" style={{ gap: 16 }}>
                  <span className="small">Boxes <b>{weights.boxes}</b></span>
                  <span className="small">Actual <b>{weights.actual.toFixed(2)} kg</b></span>
                  <span className="small">Volumetric <b>{weights.vol.toFixed(2)} kg</b> <span className="muted tiny">(L×B×H ÷ 5000; courier divisor may differ)</span></span>
                </div>
                <div className="seg2 mt12" role="radiogroup" aria-label="Shipment type">
                  {(["B2C", "B2B"] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setModeOverride(m)}>
                      <b>{m}</b><span>{m === suggested ? "Suggested for this weight" : m === "B2C" ? `Under ${props.b2bThresholdGrams / 1000} kg` : `${props.b2bThresholdGrams / 1000} kg and above`}</span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}
          {step === 2 && (
            <section className="card" style={{ padding: 18 }} aria-busy={busy}>
              <div className="row between"><h2 className="b" style={{ fontSize: 15, margin: 0 }}>Choose courier</h2><button type="button" className="btn btn-sm btn-outline" onClick={fetchQuotes} disabled={busy}>Refresh rates</button></div>
              {busy && !offers && <p className="muted mt12">Fetching live rates…</p>}
              {offers && offers.length === 0 && <p className="muted mt12">{payment === "fod" ? "FOD (freight paid by the receiver) is not available yet for this route. It is offered only on Delhivery B2B once Vishwaship has activated it — choose Prepaid or COD for now." : "No courier services this route for these details. Try changing payment type, weight or B2C/B2B."}</p>}
              {offers && notices.length > 0 && <details className="mt8 small"><summary className="muted">{notices.length} service{notices.length === 1 ? "" : "s"} gave no rate — why?</summary><ul className="tiny muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{notices.map((n) => <li key={n}>{n}</li>)}</ul><button type="button" className="btn btn-sm btn-outline mt8" onClick={fetchQuotes} disabled={busy}>Retry</button></details>}
              {offers?.some((o) => o.isDemo) && <p className="mt8"><span className="demo-badge">DEMO RATES</span></p>}
              <div className="col mt12" style={{ gap: 10 }} role="radiogroup" aria-label="Courier options">
                {offers?.map((o) => {
                  const logo = carrierLogo(o.carrierCode);
                  return (
                    <label key={o.quoteId} className={`ropt${selected === o.quoteId ? " on" : ""}`} style={{ display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}>
                      <input type="radio" name="quote" checked={selected === o.quoteId} onChange={() => setSelected(o.quoteId)} />
                      {logo ? <img className="clogo-sm" src={logo} alt="" /> : null}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="b small">{o.carrierName} · {o.serviceName}</span>
                        <span className="tiny muted" style={{ display: "block" }}>{o.mode}{o.etaDays ? ` · ETA ${o.etaDays}d` : ""} · {(o.chargeableWeightGrams / 1000).toFixed(1)} kg · {o.lines.map((l) => `${l.label} ${formatINR(l.sellPreTax)}`).join(" · ")} · GST {formatINR(o.gst)}</span>
                      </span>
                      <span style={{ textAlign: "right" }}>
                        {o.payer && o.payer.receiver > 0 ? <>
                          <span className="b" style={{ display: "block" }}>{formatINR(o.payer.receiver)}</span>
                          <span className="tiny" style={{ display: "block", color: "var(--orange)" }}>Freight payable by receiver</span>
                          <span className="tiny muted" style={{ display: "block" }}>{o.payer.sender > 0 ? `+ ${formatINR(o.payer.sender)} charged to you` : "Nothing charged to you"}</span>
                        </> : <span className="b">{formatINR(o.total)}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              {chosen && <p className="tiny muted mt8">Quote valid until {new Date(chosen.expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. {chosen.payer && chosen.payer.receiver > 0 ? `The courier collects ${formatINR(chosen.payer.receiver)} freight from the receiver at delivery; ${chosen.payer.sender > 0 ? `${formatINR(chosen.payer.sender)} is held from your wallet and charged when the courier confirms.` : "nothing is charged to your wallet."}` : "Amount is held from your wallet and charged only when the courier confirms."}</p>}
            </section>
          )}
          {err && <p className="err" role="alert">{err}</p>}
          <div className="row between create-nav">
            <button type="button" className="btn btn-outline" onClick={() => { setErr(null); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0 || busy}>Back</button>
            {step < 2
              ? <button type="button" className="btn btn-orange" onClick={next} disabled={busy}>{busy ? "Please wait…" : "Next"}</button>
              : <button type="button" className="btn btn-orange" onClick={book} disabled={busy || !chosen}>{busy ? "Booking…" : chosen ? `Book Shipment · ${formatINR(chosen.payer?.sender ?? chosen.total)}${chosen.payer && chosen.payer.receiver > 0 ? " (FOD)" : ""}` : "Book Shipment"}</button>}
          </div>
        </div>
        <div className="only-desktop">{summary}</div>
      </div>
    </div>
  );
}
