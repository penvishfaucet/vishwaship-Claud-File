"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatINR } from "@/lib/money";
import type { OfferView } from "@/components/public/RateCalculator";

type Carton = { count: string; w: string; l: string; b: string; h: string };
type Pay = "prepaid" | "cod" | "fod";
type PinInfo = { state: "idle" | "loading" | "ok" | "bad" | "down"; text?: string };
type Saved = { origin: string; dest: string; cartons: Carton[]; pay: Pay; cod: string; override: "B2C" | "B2B" | null };

const STORE_KEY = "vs-rate-calc-v1";
const PIN_RE = /^[1-9]\d{5}$/;
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const blank: Carton = { count: "1", w: "", l: "", b: "", h: "" };

/** Pure helper (unit-tested): total actual weight in grams across cartons. */
export function totalActualGrams(cartons: Array<{ count: string; w: string }>) {
  return Math.round(cartons.reduce((s, c) => s + Math.max(0, Math.floor(num(c.count))) * Math.max(0, num(c.w)) * 1000, 0));
}
/** Pure helper (unit-tested): automatic service from total actual weight; at/above the threshold → B2B. */
export function autoService(totalGrams: number, thresholdGrams: number): "B2C" | "B2B" {
  return totalGrams >= thresholdGrams ? "B2B" : "B2C";
}

const PAY_LABEL: Record<Pay, string> = { prepaid: "Prepaid", cod: "COD", fod: "FOD (receiver pays freight)" };

/**
 * signedIn: Continue to Book goes straight to Create Shipment (account pricing is re-quoted there).
 * Signed out: it goes to the Customer Login page (Sign up tab keeps the same return path) and resumes after login.
 */
export function RateCalcV2({ thresholdGrams, logos, compact = false, signedIn = false, loginHref = "/login/" }: { thresholdGrams: number; logos: Record<string, string>; compact?: boolean; signedIn?: boolean; loginHref?: string }) {
  const [origin, setOrigin] = useState("");
  const [dest, setDest] = useState("");
  const [oPin, setOPin] = useState<PinInfo>({ state: "idle" });
  const [dPin, setDPin] = useState<PinInfo>({ state: "idle" });
  const [cartons, setCartons] = useState<Carton[]>([{ ...blank }]);
  const [pay, setPay] = useState<Pay>("prepaid");
  const [cod, setCod] = useState("");
  const [override, setOverride] = useState<"B2C" | "B2B" | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error" | "stale">("idle");
  const [offers, setOffers] = useState<OfferView[]>([]);
  const [msg, setMsg] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const reqNo = useRef(0);

  const totalG = totalActualGrams(cartons);
  const auto = autoService(totalG, thresholdGrams);
  const service = override ?? auto;
  const boxes = cartons.reduce((s, c) => s + Math.max(0, Math.floor(num(c.count))), 0);
  const volKg = cartons.reduce((s, c) => s + Math.max(0, Math.floor(num(c.count))) * (num(c.l) * num(c.b) * num(c.h)) / 5000, 0);

  // Restore inputs kept from an earlier visit / before login (this browser only).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY) ?? localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Saved;
        setOrigin(s.origin ?? ""); setDest(s.dest ?? ""); if (s.cartons?.length) setCartons(s.cartons);
        setPay(s.pay ?? "prepaid"); setCod(s.cod ?? ""); setOverride(s.override ?? null);
      }
    } catch { /* storage unavailable */ }
    // Values sent from the Home page quick form win over anything restored.
    const q = new URLSearchParams(window.location.search);
    const qo = q.get("o") ?? "", qd = q.get("d") ?? "", qw = q.get("w") ?? "";
    if (PIN_RE.test(qo)) setOrigin(qo);
    if (PIN_RE.test(qd)) setDest(qd);
    if (/^\d{1,4}(\.\d{1,3})?$/.test(qw)) { setCartons([{ ...blank, w: qw }]); setOverride(null); }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ origin, dest, cartons, pay, cod, override } satisfies Saved)); } catch { /* ignore */ }
  }, [restored, origin, dest, cartons, pay, cod, override]);

  // Any change to a quote input invalidates shown rates.
  const sig = JSON.stringify({ origin, dest, cartons, pay, cod, service });
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (lastSig.current && lastSig.current !== sig && (state === "done" || state === "error")) {
      setOffers([]); setOpen(null); setState("stale"); setMsg("");
    }
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => lookup(origin, setOPin), [origin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => lookup(dest, setDPin), [dest]); // eslint-disable-line react-hooks/exhaustive-deps
  function lookup(pin: string, set: (p: PinInfo) => void) {
    if (!PIN_RE.test(pin)) { set(pin.length === 6 ? { state: "bad", text: "Enter a valid 6-digit PIN code" } : { state: "idle" }); return; }
    set({ state: "loading" });
    let alive = true;
    fetch(`/api/public/pincode/${pin}/`).then(async (r) => {
      if (!alive) return;
      const j = await r.json().catch(() => ({}));
      if (r.ok) set({ state: "ok", text: `${j.city}, ${j.state}` });
      else if (r.status === 404) set({ state: "bad", text: j?.error?.message ?? "PIN code not found" });
      else set({ state: "down", text: j?.error?.message ?? "PIN lookup unavailable — you can still get rates" });
    }).catch(() => alive && set({ state: "down", text: "PIN lookup unavailable — you can still get rates" }));
    return () => { alive = false; };
  }

  const setCarton = (i: number, k: keyof Carton, v: string) => setCartons((cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));

  function validate() {
    const e: Record<string, string> = {};
    if (!PIN_RE.test(origin)) e.origin = "Enter a valid 6-digit pickup PIN code";
    else if (oPin.state === "bad") e.origin = oPin.text ?? "PIN code not found";
    if (!PIN_RE.test(dest)) e.dest = "Enter a valid 6-digit delivery PIN code";
    else if (dPin.state === "bad") e.dest = dPin.text ?? "PIN code not found";
    cartons.forEach((c, i) => {
      if (!(Math.floor(num(c.count)) >= 1)) e[`c${i}count`] = "At least 1";
      if (!(num(c.w) > 0)) e[`c${i}w`] = "Enter weight";
      else if (num(c.w) > 5000) e[`c${i}w`] = "Max 5000 kg per carton";
      for (const k of ["l", "b", "h"] as const) if (!(num(c[k]) > 0)) e[`c${i}${k}`] = "Required";
        else if (num(c[k]) > 500) e[`c${i}${k}`] = "Max 500 cm";
    });
    if (pay === "cod" && !(num(cod) > 0)) e.cod = "Enter the amount to collect";
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) { setState("error"); setMsg("Please fix the highlighted fields."); return; }
    const my = ++reqNo.current;
    setState("loading"); setMsg(""); setOffers([]); setOpen(null);
    lastSig.current = sig;
    try {
      const r = await fetch("/api/public/quote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: service, originPincode: origin, destinationPincode: dest, paymentType: pay,
          codAmountRupees: pay === "cod" ? num(cod) : 0,
          packages: cartons.map((c) => ({ count: Math.floor(num(c.count)), lengthCm: num(c.l), breadthCm: num(c.b), heightCm: num(c.h), weightKg: num(c.w) })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (my !== reqNo.current) return;
      if (!r.ok) throw new Error(j?.error?.message ?? "We couldn't fetch rates right now. Please try again.");
      const list = (j.offers ?? []) as OfferView[];
      const notes = (j.notices ?? []) as string[];
      setOffers(list); setState("done");
      if (!list.length) setMsg(pay === "fod" ? `FOD isn't available for this ${service} route yet. Try Prepaid or COD.${notes.length ? " " + notes.join(" · ") : ""}` : `No courier services this route for these details right now.${notes.length ? " " + notes.join(" · ") : ""}`);
      else if (notes.length) setMsg(`Some services returned no rate: ${notes.join(" · ")}`);
    } catch (e) {
      if (my !== reqNo.current) return;
      setState("error"); setMsg((e as Error).message);
    }
  }

  function bookHref(o: OfferView) {
    const pk = cartons.map((c) => [Math.floor(num(c.count)), num(c.l), num(c.b), num(c.h), num(c.w)].join("*")).join("~");
    const q = new URLSearchParams({ dest, weight: String(totalG / 1000), mode: o.mode, pay, pk, ...(pay === "cod" ? { cod } : {}), qc: o.carrierCode, qs: o.serviceName, qt: String(o.total) });
    return `/portal/orders/new/?${q.toString()}`;
  }
  function continueToBook(o: OfferView) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ origin, dest, cartons, pay, cod, override } satisfies Saved)); } catch { /* ignore */ }
    const next = bookHref(o);
    window.location.href = signedIn ? next : `${loginHref}${loginHref.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
  }

  const pinNote = (p: PinInfo) => p.state === "loading" ? <span className="hint">Finding city…</span>
    : p.state === "ok" ? <span className="ok">✓ {p.text}</span>
    : p.state === "bad" ? <span className="bad">{p.text}</span>
    : p.state === "down" ? <span className="hint">{p.text}</span> : null;
  const fe = (k: string) => errs[k] ? <span className="bad" id={`e-${k}`}>{errs[k]}</span> : null;
  const inv = (k: string) => (errs[k] ? { "aria-invalid": true, "aria-describedby": `e-${k}` } : {});

  const results = useMemo(() => offers, [offers]);

  return (
    <div className={compact ? "w-calc compact" : "w-calc"}>
      <form className="w-card w-form" onSubmit={submit} noValidate aria-describedby="calc-msg">
        <fieldset className="w-fs">
          <legend>Route</legend>
          <div className="w-row">
            <div className="w-fld">
              <label htmlFor="rc-o">Pickup PIN code</label>
              <input id="rc-o" className="w-in" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="e.g. 249402" value={origin} onChange={(e) => setOrigin(e.target.value.replace(/\D/g, "").slice(0, 6))} {...inv("origin")} />
              {fe("origin") ?? pinNote(oPin)}
            </div>
            <div className="w-fld">
              <label htmlFor="rc-d">Delivery PIN code</label>
              <input id="rc-d" className="w-in" inputMode="numeric" maxLength={6} placeholder="e.g. 400001" value={dest} onChange={(e) => setDest(e.target.value.replace(/\D/g, "").slice(0, 6))} {...inv("dest")} />
              {fe("dest") ?? pinNote(dPin)}
            </div>
          </div>
        </fieldset>

        <fieldset className="w-fs">
          <legend>Package{cartons.length > 1 ? "s" : ""}</legend>
          {cartons.map((c, i) => (
            <div key={i} className="w-carton">
              <div className="hd"><span>{cartons.length > 1 ? `Carton type ${i + 1}` : "Carton details"}</span>{cartons.length > 1 && <button type="button" className="rm" onClick={() => setCartons((cs) => cs.filter((_, j) => j !== i))}>Remove</button>}</div>
              <div className="w-row">
                <div className="w-fld"><label htmlFor={`rc-n${i}`}>Number of cartons</label><input id={`rc-n${i}`} className="w-in" inputMode="numeric" value={c.count} onChange={(e) => setCarton(i, "count", e.target.value.replace(/\D/g, "").slice(0, 3))} {...inv(`c${i}count`)} />{fe(`c${i}count`)}</div>
                <div className="w-fld"><label htmlFor={`rc-w${i}`}>Actual weight per carton (kg)</label><input id={`rc-w${i}`} className="w-in" inputMode="decimal" placeholder="e.g. 1.5" value={c.w} onChange={(e) => setCarton(i, "w", e.target.value.replace(/[^\d.]/g, "").slice(0, 8))} {...inv(`c${i}w`)} />{fe(`c${i}w`)}</div>
              </div>
              <div className="w-row r3" style={{ marginTop: 12 }}>
                {(["l", "b", "h"] as const).map((k) => (
                  <div key={k} className="w-fld"><label htmlFor={`rc-${k}${i}`}>{k === "l" ? "Length" : k === "b" ? "Width" : "Height"} (cm)</label><input id={`rc-${k}${i}`} className="w-in" inputMode="decimal" value={c[k]} onChange={(e) => setCarton(i, k, e.target.value.replace(/[^\d.]/g, "").slice(0, 6))} {...inv(`c${i}${k}`)} />{fe(`c${i}${k}`)}</div>
                ))}
              </div>
            </div>
          ))}
          {cartons.length < 10 && <button type="button" className="w-add" onClick={() => setCartons((cs) => [...cs, { ...blank }])}>+ Add another carton size</button>}
          <div className="w-tot" aria-live="polite">
            <span>Cartons: <b>{boxes || 0}</b></span>
            <span>Total actual weight: <b>{(totalG / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg</b></span>
            {volKg > 0 && <span>Volumetric (L×W×H/5000): <b>{volKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg</b></span>}
          </div>
        </fieldset>

        <div className="w-svcsel" role="status" aria-live="polite">
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--mut)", textTransform: "uppercase", letterSpacing: ".08em" }}>Service</div>
            <b data-testid="service">{service}</b>
          </div>
          <span className="why">{override ? "Changed manually" : `Selected automatically based on shipment weight (${service === "B2B" ? `${thresholdGrams / 1000} kg or more` : `under ${thresholdGrams / 1000} kg`})`}</span>
          {override
            ? <button type="button" onClick={() => setOverride(null)}>Use automatic</button>
            : <button type="button" onClick={() => setOverride(auto === "B2C" ? "B2B" : "B2C")}>Switch to {auto === "B2C" ? "B2B" : "B2C"}</button>}
        </div>

        <fieldset className="w-fs">
          <legend>Payment</legend>
          <div className="w-seg" role="group" aria-label="Payment mode">
            {(["prepaid", "cod", "fod"] as Pay[]).map((p) => <button key={p} type="button" aria-pressed={pay === p} onClick={() => setPay(p)}>{p === "fod" ? "FOD" : PAY_LABEL[p]}</button>)}
          </div>
          {pay === "fod" && <p className="hint" style={{ fontSize: 13, color: "var(--mut)", margin: "8px 0 0" }}>Freight on Delivery: the receiver pays the freight. Offered only on services where it is activated.</p>}
          {pay === "cod" && (
            <div className="w-fld" style={{ marginTop: 12 }}>
              <label htmlFor="rc-cod">COD amount to collect (₹)</label>
              <input id="rc-cod" className="w-in" inputMode="decimal" value={cod} onChange={(e) => setCod(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))} {...inv("cod")} />{fe("cod")}
            </div>
          )}
        </fieldset>

        <button className="w-btn pri" style={{ width: "100%" }} disabled={state === "loading"}>{state === "loading" ? <><span className="w-spin" aria-hidden="true" /> Checking couriers…</> : state === "stale" ? "Get updated rates" : "Get shipping rates"}</button>
      </form>

      <div className="w-res" aria-live="polite" aria-busy={state === "loading"} id="calc-msg">
        {state === "idle" && <div className="w-card w-res-empty"><h3 className="w-h3">Your rates will appear here</h3><p>Enter both PIN codes and your carton details, then select <b>Get shipping rates</b>.</p></div>}
        {state === "stale" && <div className="w-status info">Your shipment details changed. Select <b>Get updated rates</b> to see current prices.</div>}
        {state === "loading" && <><div className="w-skel" /><div className="w-skel" /><div className="w-skel" /></>}
        {msg && state !== "loading" && <div className={`w-status ${state === "error" ? "err" : offers.length ? "warn" : "info"}`} role={state === "error" ? "alert" : undefined}>{msg}</div>}
        {state === "done" && results.length > 0 && <p style={{ margin: "0 0 2px", fontSize: 14, color: "var(--mut)" }}>{results.length} {service} option{results.length > 1 ? "s" : ""} · sorted by price · prices include GST</p>}
        {state === "done" && results.map((o, i) => {
          const logo = logos[o.carrierCode];
          const isOpen = open === o.quoteId;
          const fod = o.payer && o.payer.receiver > 0;
          return (
            <article key={o.quoteId} className={`w-card w-offer${i === 0 ? " best" : ""}`}>
              <div className="top">
                <div className="lg">{logo ? <img src={logo} alt="" /> : <span className="ini">{o.carrierName.slice(0, 2).toUpperCase()}</span>}</div>
                <div className="nm"><b>{o.carrierName}</b><span>{o.serviceName}</span></div>
                <div className="price"><b>{formatINR(o.total)}</b><span>{fod ? "total freight" : "incl. GST"}</span></div>
              </div>
              <div className="w-chips">
                {i === 0 && <span className="w-chip o">Lowest price</span>}
                <span className="w-chip n">{o.mode}</span>
                <span className="w-chip">Chargeable {(o.chargeableWeightGrams / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg</span>
                {o.etaDays ? <span className="w-chip">Est. {o.etaDays} day{o.etaDays > 1 ? "s" : ""} in transit</span> : <span className="w-chip">Transit time on booking</span>}
                <span className="w-chip">{PAY_LABEL[o.paymentMode ?? pay]}</span>
                {o.isDemo && <span className="w-chip">Sample rate</span>}
              </div>
              {fod && <p style={{ fontSize: 13.5, color: "var(--mut)", margin: "10px 0 0" }}>You pay {formatINR(o.payer!.sender)} · receiver pays {formatINR(o.payer!.receiver)} at delivery</p>}
              <div className="acts">
                <button type="button" className="tg" aria-expanded={isOpen} aria-controls={`brk-${o.quoteId}`} onClick={() => setOpen(isOpen ? null : o.quoteId)}>{isOpen ? "Hide" : "View"} charge breakdown <span aria-hidden="true">{isOpen ? "▴" : "▾"}</span></button>
                <button type="button" className="w-btn navy sm" onClick={() => continueToBook(o)}>Continue to Book</button>
              </div>
              {isOpen && (
                <div className="w-brk" id={`brk-${o.quoteId}`}>
                  {o.lines.map((l) => <div key={l.code}><span>{l.label}</span><span>{formatINR(l.sellPreTax)}</span></div>)}
                  <div><span>Subtotal</span><span>{formatINR(o.sellingSubtotal)}</span></div>
                  <div><span>GST</span><span>{formatINR(o.gst)}</span></div>
                  <div className="t"><span>Total</span><span>{formatINR(o.total)}</span></div>
                </div>
              )}
            </article>
          );
        })}
        {state === "done" && results.length > 0 && <p style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>Rates are rechecked when you book. Booking needs a Vishwaship account — your details are kept through login.</p>}
      </div>
    </div>
  );
}
