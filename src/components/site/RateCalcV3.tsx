"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Loader2, MapPin, Package, Plus, RefreshCw, Scale, Trash2, Truck } from "lucide-react";
import { formatINR } from "@/lib/money";
import { FOD_MIN_KG, FOD_RULE_TEXT } from "@/lib/payment";

type Box = { count: string; w: string; l: string; b: string; h: string };
type Pay = "prepaid" | "cod" | "fod";
type Loc = { city: string; state: string; locality: string | null };
type PinState = { state: "idle" | "loading" | "ok" | "bad" | "down"; loc?: Loc; msg?: string };
type Line = { code: string; label: string; sellPreTax: number };
type Offer = {
  quoteId: string; carrierCode: string; carrierName: string; serviceName: string; mode: "B2C" | "B2B"; etaDays: number | null;
  chargeableWeightGrams: number; lines: Line[]; sellingSubtotal: number; gst: number; total: number; isDemo: boolean;
  paymentMode?: Pay; payer?: { sender: number; receiver: number }; source: { key: string; name: string };
};
type Service = { key: string; name: string; mode: "B2C" | "B2B"; state: "available" | "no_service" | "failed" | "not_offered" | "inactive" | "not_connected"; note?: string; count: number };
type Saved = { origin: string; dest: string; boxes: Box[]; pay: Pay; cod: string; value?: string };

export const RC_MSG = {
  pinFormat: "Enter a valid 6-digit pincode.",
  pinUnknown: "Invalid pincode. Please check and try again.",
  pinDown: "We couldn't look up this pincode right now.",
} as const;
const STORE_KEY = "vs-rate-calc-v3";
const PIN_RE = /^[1-9]\d{5}$/;
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const blank: Box = { count: "1", w: "", l: "", b: "", h: "" };
const kgText = (kg: number) => kg.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Pure helper (unit-tested): actual, volumetric (L×B×H/5000) and chargeable kg across boxes. */
export function boxTotals(boxes: Box[]) {
  let actual = 0, vol = 0, count = 0;
  for (const b of boxes) {
    const n = Math.max(0, Math.floor(num(b.count)));
    count += n; actual += n * Math.max(0, num(b.w)); vol += n * (num(b.l) * num(b.b) * num(b.h)) / 5000;
  }
  return { count, actual, vol, chargeable: Math.max(actual, vol) };
}

const STATE_TEXT: Record<Service["state"], string> = {
  available: "Rates available", no_service: "Doesn't serve this route", failed: "Couldn't be reached — try again",
  not_offered: "Not offered for this payment mode", inactive: "Not switched on yet", not_connected: "Not connected yet",
};

export function RateCalcV3({ logos, signedIn = false, loginHref = "/login/", endpoint = "/api/public/rates" }: { logos: Record<string, string>; signedIn?: boolean; loginHref?: string; /** Rates API; the Franchise Rate List page passes its own (margin-priced). */ endpoint?: string }) {
  const [origin, setOrigin] = useState("");
  const [dest, setDest] = useState("");
  const [oPin, setOPin] = useState<PinState>({ state: "idle" });
  const [dPin, setDPin] = useState<PinState>({ state: "idle" });
  const [boxes, setBoxes] = useState<Box[]>([{ ...blank }]);
  const [pay, setPay] = useState<Pay>("prepaid");
  const [cod, setCod] = useState("");
  const [value, setValue] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error" | "stale">("idle");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [banner, setBanner] = useState<{ tone: "err" | "warn" | "info"; text: string; retry?: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const reqNo = useRef(0);
  // Latest typed PINs: a lookup answer is used only if its PIN is still in the field (a slower, older answer is dropped).
  const latest = useRef({ origin: "", dest: "" });
  latest.current = { origin, dest };
  const resultsRef = useRef<HTMLDivElement>(null);

  const t = boxTotals(boxes);
  const fodOk = t.chargeable > FOD_MIN_KG;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY) ?? localStorage.getItem(STORE_KEY);
      if (raw) { const s = JSON.parse(raw) as Saved; setOrigin(s.origin ?? ""); setDest(s.dest ?? ""); if (s.boxes?.length) setBoxes(s.boxes); setPay(s.pay ?? "prepaid"); setCod(s.cod ?? ""); setValue(s.value ?? ""); }
    } catch { /* storage unavailable */ }
    const q = new URLSearchParams(window.location.search);
    const qo = q.get("o") ?? "", qd = q.get("d") ?? "", qw = q.get("w") ?? "";
    if (PIN_RE.test(qo)) setOrigin(qo);
    if (PIN_RE.test(qd)) setDest(qd);
    if (/^\d{1,4}(\.\d{1,3})?$/.test(qw)) setBoxes([{ ...blank, w: qw }]);
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ origin, dest, boxes, pay, cod, value } satisfies Saved)); } catch { /* ignore */ }
  }, [restored, origin, dest, boxes, pay, cod, value]);

  // FOD needs a parcel over 15 kg: move back to Prepaid when the weight drops.
  useEffect(() => { if (!fodOk && pay === "fod") setPay("prepaid"); }, [fodOk, pay]);

  // Any change after a result marks it out of date (results stay hidden until rechecked).
  const sig = JSON.stringify({ origin, dest, boxes, pay, cod, value });
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (lastSig.current && lastSig.current !== sig && (phase === "done" || phase === "error")) { setPhase("stale"); setBanner(null); }
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Location lookup for a complete PIN; a newer edit always wins over a slower earlier answer.
  function lookup(which: "origin" | "dest", pin: string) {
    const set = which === "origin" ? setOPin : setDPin;
    if (!pin) { set({ state: "idle" }); return; }
    if (pin.length < 6) { set({ state: "idle" }); return; }
    if (!PIN_RE.test(pin)) { set({ state: "bad", msg: RC_MSG.pinFormat }); return; }
    set({ state: "loading" });
    fetch(`/api/public/pincode/${pin}/`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (pin !== latest.current[which]) return;
      if (r.ok) set({ state: "ok", loc: { city: j.city, state: j.state, locality: j.locality ?? null } });
      else if (r.status === 404) set({ state: "bad", msg: RC_MSG.pinUnknown });
      else set({ state: "down", msg: RC_MSG.pinDown });
    }).catch(() => { if (pin === latest.current[which]) set({ state: "down", msg: RC_MSG.pinDown }); });
  }
  useEffect(() => { lookup("origin", origin); setErrs((e) => ({ ...e, origin: "" })); }, [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { lookup("dest", dest); setErrs((e) => ({ ...e, dest: "" })); }, [dest]); // eslint-disable-line react-hooks/exhaustive-deps

  const setBox = (i: number, k: keyof Box, v: string) => { setBoxes((bs) => bs.map((b, j) => (j === i ? { ...b, [k]: v } : b))); setErrs((e) => ({ ...e, [`b${i}${k}`]: "" })); };

  function validate() {
    const e: Record<string, string> = {};
    if (!PIN_RE.test(origin)) e.origin = RC_MSG.pinFormat; else if (oPin.state === "bad") e.origin = oPin.msg ?? RC_MSG.pinUnknown;
    if (!PIN_RE.test(dest)) e.dest = RC_MSG.pinFormat; else if (dPin.state === "bad") e.dest = dPin.msg ?? RC_MSG.pinUnknown;
    boxes.forEach((b, i) => {
      if (!(Math.floor(num(b.count)) >= 1)) e[`b${i}count`] = "Enter at least 1 box.";
      if (!(num(b.w) > 0)) e[`b${i}w`] = "Enter the weight in kg.";
      else if (num(b.w) > 5000) e[`b${i}w`] = "Maximum 5000 kg per box.";
      for (const k of ["l", "b", "h"] as const) {
        if (!(num(b[k]) > 0)) e[`b${i}${k}`] = "Enter in cm.";
        else if (num(b[k]) > 500) e[`b${i}${k}`] = "Maximum 500 cm.";
      }
    });
    if (!(num(value) > 0)) e.value = "Enter the invoice value.";
    if (pay === "cod" && !(num(cod) > 0)) e.cod = "Enter the COD amount to collect.";
    setErrs(e);
    return e;
  }

  async function submit(ev?: React.FormEvent) {
    ev?.preventDefault();
    const e = validate();
    const firstBad = Object.keys(e)[0];
    if (firstBad) {
      setBanner({ tone: "err", text: "Please fix the highlighted fields." });
      const id = firstBad === "origin" ? "rc-o" : firstBad === "dest" ? "rc-d" : firstBad === "cod" ? "rc-cod" : firstBad === "value" ? "rc-val" : `rc-${firstBad.slice(2)}${firstBad[1]}`;
      document.getElementById(id)?.focus();
      return;
    }
    const my = ++reqNo.current;
    setPhase("loading"); setBanner(null); setOpen(null);
    lastSig.current = sig;
    try {
      const r = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originPincode: origin, destinationPincode: dest, paymentType: pay, codAmountRupees: pay === "cod" ? num(cod) : 0, declaredValueRupees: num(value),
          packages: boxes.map((b) => ({ count: Math.floor(num(b.count)), lengthCm: num(b.l), breadthCm: num(b.b), heightCm: num(b.h), weightKg: num(b.w) })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (my !== reqNo.current) return;
      if (!r.ok) {
        const f = (j?.error?.fields ?? {}) as Record<string, string>;
        if (Object.keys(f).length) {
          setErrs(f);
          if (f.origin === RC_MSG.pinUnknown) setOPin({ state: "bad", msg: RC_MSG.pinUnknown });
          if (f.dest === RC_MSG.pinUnknown) setDPin({ state: "bad", msg: RC_MSG.pinUnknown });
        }
        setPhase("error");
        setBanner({ tone: "err", text: j?.error?.message ?? "We couldn't fetch rates right now. Your details are kept — please try again.", retry: r.status >= 500 || r.status === 429 });
        return;
      }
      setOffers(j.offers ?? []); setServices(j.services ?? []); setPhase("done");
      if (!(j.offers ?? []).length) {
        const kind = j.empty?.kind as string | undefined;
        if (kind === "pickup") setErrs((x) => ({ ...x, origin: j.empty.message }));
        if (kind === "delivery") setErrs((x) => ({ ...x, dest: j.empty.message }));
        setBanner({ tone: kind === "retry" ? "warn" : "info", text: j.empty?.message ?? "No courier service is available for this pickup and delivery route.", retry: kind === "retry" });
      }
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
    } catch {
      if (my !== reqNo.current) return;
      setPhase("error");
      setBanner({ tone: "err", text: "We couldn't reach the server. Your details are kept — please try again.", retry: true });
    }
  }

  function continueToBook(o: Offer) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ origin, dest, boxes, pay, cod, value } satisfies Saved)); } catch { /* ignore */ }
    const pk = boxes.map((b) => [Math.floor(num(b.count)), num(b.l), num(b.b), num(b.h), num(b.w)].join("*")).join("~");
    const q = new URLSearchParams({ dest, weight: String(t.actual), mode: o.mode, pay, pk, ...(pay === "cod" ? { cod } : {}), qc: o.carrierCode, qs: o.serviceName, qt: String(o.total) });
    const next = `/portal/orders/new/?${q.toString()}`;
    window.location.href = signedIn ? next : `${loginHref}${loginHref.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
  }

  const err = (k: string) => (errs[k] ? <span className="rc-err" id={`e-${k}`}><AlertTriangle size={14} aria-hidden="true" />{errs[k]}</span> : null);
  const inv = (k: string, extra?: string) => {
    const ids = [errs[k] ? `e-${k}` : "", extra ?? ""].filter(Boolean).join(" ");
    return { "aria-invalid": errs[k] ? true : undefined, "aria-describedby": ids || undefined };
  };

  function PinField({ id, label, which, value, set, st, ph }: { id: string; label: string; which: "origin" | "dest"; value: string; set: (v: string) => void; st: PinState; ph: string }) {
    return (
      <div className="rc-fld">
        <label htmlFor={id}>{label}</label>
        <div className={`rc-pin${errs[which] ? " bad" : st.state === "ok" ? " good" : ""}`}>
          <MapPin size={18} aria-hidden="true" />
          <input id={id} inputMode="numeric" autoComplete="off" maxLength={6} placeholder={ph} value={value} onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 6))} {...inv(which, `${id}-loc`)} />
          {st.state === "loading" && <Loader2 className="rc-spin" size={18} aria-label="Looking up pincode" />}
          {st.state === "ok" && <CheckCircle2 size={18} className="ok" aria-hidden="true" />}
        </div>
        <div id={`${id}-loc`} aria-live="polite" className="rc-loc">
          {errs[which] ? err(which)
            : st.state === "ok" && st.loc ? <span className="place"><b>{[st.loc.city, st.loc.state].filter(Boolean).join(", ")}</b>{st.loc.locality && <span>{st.loc.locality}</span>}</span>
              : st.state === "loading" ? <span className="hint">Finding location…</span>
                : st.state === "bad" ? <span className="rc-err"><AlertTriangle size={14} aria-hidden="true" />{st.msg}</span>
                  : st.state === "down" ? <span className="hint">{st.msg} <button type="button" className="rc-link" onClick={() => lookup(which, value)}>Retry</button></span>
                    : <span className="hint">City and state appear after 6 digits</span>}
        </div>
      </div>
    );
  }

  // one list across B2C and B2B, cheapest first (owner rule 2026-11-23); each rate carries its B2C / B2B tag
  const groups = [{ mode: "ALL" as const, list: [...offers].sort((a, b) => a.total - b.total) }];
  const unavailable = services.filter((s) => s.state !== "available");

  return (
    <div className="rc">
      <form className="rc-form" onSubmit={submit} noValidate>
        <section className="rc-panel" aria-labelledby="rc-route-h">
          <h2 id="rc-route-h" className="rc-ph"><span className="n">1</span>Route</h2>
          <div className="rc-grid2">
            {PinField({ id: "rc-o", label: "Pickup Pincode", which: "origin", value: origin, set: setOrigin, st: oPin, ph: "e.g. 249402" })}
            {PinField({ id: "rc-d", label: "Delivery Pincode", which: "dest", value: dest, set: setDest, st: dPin, ph: "e.g. 400001" })}
          </div>
        </section>

        <section className="rc-panel" aria-labelledby="rc-box-h">
          <h2 id="rc-box-h" className="rc-ph"><span className="n">2</span>Boxes</h2>
          <div className="rc-boxes">
            {boxes.map((b, i) => (
              <fieldset key={i} className="rc-box">
                <legend><Package size={16} aria-hidden="true" />{boxes.length > 1 ? `Box type ${i + 1}` : "Box details"}</legend>
                {boxes.length > 1 && <button type="button" className="rc-rm" onClick={() => setBoxes((bs) => bs.filter((_, j) => j !== i))} aria-label={`Remove box type ${i + 1}`}><Trash2 size={16} aria-hidden="true" />Remove</button>}
                <div className="rc-dims">
                  {(["l", "b", "h"] as const).map((k) => (
                    <div key={k} className="rc-fld">
                      <label htmlFor={`rc-${k}${i}`}>{k === "l" ? "Length" : k === "b" ? "Width" : "Height"}</label>
                      <div className="rc-unit"><input id={`rc-${k}${i}`} inputMode="decimal" placeholder="0" value={b[k]} onChange={(e) => setBox(i, k, e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} {...inv(`b${i}${k}`)} /><span>cm</span></div>
                      {err(`b${i}${k}`)}
                    </div>
                  ))}
                </div>
                <div className="rc-grid2 tight">
                  <div className="rc-fld">
                    <label htmlFor={`rc-w${i}`}>Weight per box</label>
                    <div className="rc-unit"><input id={`rc-w${i}`} inputMode="decimal" placeholder="0.5" value={b.w} onChange={(e) => setBox(i, "w", e.target.value.replace(/[^\d.]/g, "").slice(0, 8))} {...inv(`b${i}w`)} /><span>kg</span></div>
                    {err(`b${i}w`)}
                  </div>
                  <div className="rc-fld">
                    <label htmlFor={`rc-count${i}`}>Number of boxes</label>
                    <div className="rc-unit"><input id={`rc-count${i}`} inputMode="numeric" value={b.count} onChange={(e) => setBox(i, "count", e.target.value.replace(/\D/g, "").slice(0, 3))} {...inv(`b${i}count`)} /><span>box</span></div>
                    {err(`b${i}count`)}
                  </div>
                </div>
              </fieldset>
            ))}
          </div>
          {boxes.length < 10 && <button type="button" className="rc-add" onClick={() => setBoxes((bs) => [...bs, { ...blank }])}><Plus size={18} aria-hidden="true" />Add another box size</button>}
          <dl className="rc-tot" aria-live="polite">
            <div><dt>Boxes</dt><dd>{t.count}</dd></div>
            <div><dt>Actual weight</dt><dd>{kgText(t.actual)} kg</dd></div>
            <div><dt>Volumetric <span>(L×W×H ÷ 5000)</span></dt><dd>{kgText(t.vol)} kg</dd></div>
            <div className="hl"><dt>Chargeable weight</dt><dd>{kgText(t.chargeable)} kg</dd></div>
          </dl>
        </section>

        <section className="rc-panel" aria-labelledby="rc-pay-h">
          <h2 id="rc-pay-h" className="rc-ph"><span className="n">3</span>Payment</h2>
          <div className="rc-pay" role="radiogroup" aria-labelledby="rc-pay-h">
            {([["prepaid", "Prepaid", "You pay the freight"], ["cod", "Cash on Delivery", "Courier collects the goods amount"], ["fod", "FOD", fodOk ? "Receiver pays the freight (B2B)" : FOD_RULE_TEXT]] as const).map(([k, l, d]) => {
              const dis = k === "fod" && !fodOk;
              return (
                <button key={k} type="button" role="radio" aria-checked={pay === k} aria-disabled={dis || undefined} disabled={dis} className={pay === k ? "on" : ""} onClick={() => setPay(k)}>
                  <b>{l}</b><span>{d}</span>
                </button>
              );
            })}
          </div>
          <div className="rc-grid2" style={{ marginTop: 14 }}>
            <div className="rc-fld">
              <label htmlFor="rc-val">Invoice value</label>
              <div className="rc-unit pre"><span>₹</span><input id="rc-val" inputMode="decimal" placeholder="Goods value" value={value} onChange={(e) => { setValue(e.target.value.replace(/[^\d.]/g, "").slice(0, 9)); setErrs((x) => ({ ...x, value: "" })); }} {...inv("value")} /></div>
              {err("value")}
            </div>
          {pay === "cod" && (
            <div className="rc-fld">
              <label htmlFor="rc-cod">COD amount to collect</label>
              <div className="rc-unit pre"><span>₹</span><input id="rc-cod" inputMode="decimal" placeholder="0" value={cod} onChange={(e) => { setCod(e.target.value.replace(/[^\d.]/g, "").slice(0, 9)); setErrs((x) => ({ ...x, cod: "" })); }} {...inv("cod")} /></div>
              {err("cod")}
            </div>
          )}
          </div>
        </section>

        <div className="rc-submit">
          <button className="w-btn pri rc-go" disabled={phase === "loading"}>
            {phase === "loading" ? <><Loader2 className="rc-spin" size={20} aria-hidden="true" />Checking couriers…</> : phase === "stale" ? "Check Updated Rates" : "Check Rates"}
          </button>
          <p>We check B2C and B2B services together. Prices include GST.</p>
        </div>
      </form>

      <div ref={resultsRef} className="rc-results" aria-live="polite" aria-busy={phase === "loading"} tabIndex={-1}>
        {banner && (
          <div className={`rc-banner ${banner.tone}`} role={banner.tone === "err" ? "alert" : "status"}>
            <AlertTriangle size={18} aria-hidden="true" /><span>{banner.text}</span>
            {banner.retry && <button type="button" className="w-btn ghost sm" onClick={() => submit()}><RefreshCw size={16} aria-hidden="true" />Retry</button>}
          </div>
        )}
        {phase === "stale" && <div className="rc-banner info" role="status"><RefreshCw size={18} aria-hidden="true" /><span>Your shipment details changed. Select <b>Check Updated Rates</b> to see current prices.</span></div>}
        {phase === "loading" && <div className="rc-skels" aria-label="Loading rates"><div /><div /><div /></div>}
        {phase === "idle" && !banner && (
          <div className="rc-empty"><Truck size={34} aria-hidden="true" /><h3>Your rates will appear here</h3><p>Enter both pincodes and your box details, then select <b>Check Rates</b>.</p></div>
        )}

        {phase === "done" && offers.length > 0 && groups.map(({ mode, list }) => list.length > 0 && (
          <section key={mode} className="rc-group" aria-labelledby={`rc-g-${mode}`}>
            <header>
              <h3 id={`rc-g-${mode}`}>All courier services</h3>
              <span>{list.length} option{list.length > 1 ? "s" : ""} · lowest price first</span>
            </header>
            <div className="rc-list">
              {list.map((o, i) => {
                const logo = logos[o.carrierCode];
                const isOpen = open === o.quoteId;
                const fod = (o.payer?.receiver ?? 0) > 0;
                return (
                  <article key={o.quoteId} className={`rc-offer${i === 0 ? " best" : ""}`}>
                    <div className="who">
                      <span className="lg">{logo ? <img src={logo} alt="" /> : <span className="ini">{o.carrierName.slice(0, 2).toUpperCase()}</span>}</span>
                      <span className="nm"><b>{o.carrierName} <span className={`rc-mode ${o.mode.toLowerCase()}`}>{o.mode}</span></b><span>{o.serviceName}</span><span className="src">via {o.source.name}</span></span>
                    </div>
                    <ul className="facts">
                      <li><Scale size={15} aria-hidden="true" />{kgText(o.chargeableWeightGrams / 1000)} kg chargeable</li>
                      <li><Clock size={15} aria-hidden="true" />{o.etaDays ? `Est. ${o.etaDays} day${o.etaDays > 1 ? "s" : ""}` : "Transit time on booking"}</li>
                      {i === 0 && <li className="best">Lowest price</li>}
                      {o.isDemo && <li>Sample rate</li>}
                    </ul>
                    <div className="price">
                      <b>{formatINR(o.total)}</b>
                      <span>{fod ? `You pay ${formatINR(o.payer!.sender)} · receiver ${formatINR(o.payer!.receiver)}` : "incl. GST"}</span>
                    </div>
                    <div className="acts">
                      <button type="button" className="rc-link" aria-expanded={isOpen} aria-controls={`brk-${o.quoteId}`} onClick={() => setOpen(isOpen ? null : o.quoteId)}>
                        {isOpen ? "Hide" : "View"} breakdown <ChevronDown size={16} aria-hidden="true" style={{ transform: isOpen ? "rotate(180deg)" : undefined }} />
                      </button>
                      <button type="button" className="w-btn navy sm" onClick={() => continueToBook(o)}>Continue to Book</button>
                    </div>
                    {isOpen && (
                      <dl className="brk" id={`brk-${o.quoteId}`}>
                        {o.lines.map((l) => <div key={l.code}><dt>{l.label}</dt><dd>{formatINR(l.sellPreTax)}</dd></div>)}
                        <div><dt>Subtotal</dt><dd>{formatINR(o.sellingSubtotal)}</dd></div>
                        <div><dt>GST</dt><dd>{formatINR(o.gst)}</dd></div>
                        <div className="t"><dt>Total payable</dt><dd>{formatINR(o.total)}</dd></div>
                      </dl>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {phase === "done" && unavailable.length > 0 && (
          <section className="rc-unavail" aria-labelledby="rc-un-h">
            <h3 id="rc-un-h">{offers.length ? "Services without a rate for this shipment" : "Service status"}</h3>
            <ul>
              {services.map((s) => (
                <li key={s.key} className={`s-${s.state}`}>
                  <span className={`rc-mode ${s.mode.toLowerCase()}`}>{s.mode}</span>
                  <b>{s.name}</b>
                  <span className="st">{STATE_TEXT[s.state]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {phase === "done" && offers.length > 0 && <p className="rc-fine">Rates are rechecked when you book. Booking needs a Vishwaship account — your details are kept through login.</p>}
      </div>
    </div>
  );
}
