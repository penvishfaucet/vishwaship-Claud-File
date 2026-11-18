"use client";
import { useState } from "react";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";

export interface OfferView {
  quoteId: string;
  carrierCode: string;
  carrierName: string;
  serviceName: string;
  mode: "B2C" | "B2B";
  etaDays?: number;
  chargeableWeightGrams: number;
  lines: Array<{ code: string; label: string; sellPreTax: number }>;
  sellingSubtotal: number;
  gst: number;
  total: number;
  expiresAt: string;
  provider?: string;
  paymentMode?: "prepaid" | "cod" | "fod";
  /** sender = charged to the seller's wallet; receiver = collected from the receiver at delivery (FOD) */
  payer?: { sender: number; receiver: number };
  pricingSource?: string;
  isDemo: boolean;
  isPilot?: boolean;
}

interface Props {
  /** "public" -> /api/public/quote (global markup); "portal" -> /api/portal/quote (org markup from session). */
  scope: "public" | "portal";
  layout?: "stacked" | "wide";
  bookHref?: (o: OfferView, input: CalcInput) => string;
  initial?: Partial<CalcInput>;
}

export interface CalcInput {
  mode: "B2C" | "B2B"; origin: string; destination: string; weightKg: string;
  payment: "prepaid" | "cod" | "fod"; codAmount: string; l: string; b: string; h: string;
}

const DEFAULTS: CalcInput = { mode: "B2C", origin: "110034", destination: "411001", weightKg: "1.2", payment: "prepaid", codAmount: "", l: "20", b: "15", h: "10" };

export function RateCalculator({ scope, layout = "stacked", bookHref, initial }: Props) {
  const [f, setF] = useState<CalcInput>({ ...DEFAULTS, ...initial });
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [offers, setOffers] = useState<OfferView[]>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const set = <K extends keyof CalcInput>(k: K, v: CalcInput[K]) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[1-9]\d{5}$/.test(f.origin) || !/^[1-9]\d{5}$/.test(f.destination)) {
      setState("error"); setMsg("Enter valid 6-digit pickup and delivery pincodes."); return;
    }
    setState("loading"); setMsg("");
    try {
      const r = await fetch(scope === "public" ? "/api/public/quote" : "/api/portal/quote", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: f.mode, originPincode: f.origin, destinationPincode: f.destination, paymentType: f.payment,
          codAmountRupees: f.payment === "cod" ? Number(f.codAmount || 0) : 0,
          packages: [{ count: 1, lengthCm: Number(f.l || 1), breadthCm: Number(f.b || 1), heightCm: Number(f.h || 1), weightKg: Number(f.weightKg) }],
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Could not fetch rates");
      setOffers(j.offers);
      setState("done");
      const why = (j.notices ?? []) as string[];
      if (!j.offers.length) setMsg(f.payment === "fod" ? "FOD (freight paid by the receiver) is not available yet for this route — it is offered on Delhivery B2B once activated. Choose Prepaid or COD." : `No courier currently services this route with these details.${why.length ? " " + why.join(" · ") : ""}`);
      else if (why.length) setMsg(`Some services gave no rate: ${why.join(" · ")}`);
    } catch (err) {
      setState("error"); setMsg((err as Error).message);
    }
  }

  const best = offers[0];
  const form = (
    <form onSubmit={submit} aria-describedby="calc-status">
      <div className="seg2 mb12" role="radiogroup" aria-label="Shipment type">
        <button type="button" role="radio" aria-checked={f.mode === "B2C"} className={f.mode === "B2C" ? "on" : ""} onClick={() => set("mode", "B2C")}><b>B2C</b><span>Under 10 kg parcel</span></button>
        <button type="button" role="radio" aria-checked={f.mode === "B2B"} className={f.mode === "B2B" ? "on" : ""} onClick={() => set("mode", "B2B")}><b>B2B</b><span>More than 10 kg parcel</span></button>
      </div>
      <div className="grid2" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="c-o">Pickup pincode</label><input id="c-o" className="input" inputMode="numeric" maxLength={6} required value={f.origin} onChange={(e) => set("origin", e.target.value.replace(/\D/g, ""))} /></div>
        <div className="field"><label htmlFor="c-d">Delivery pincode</label><input id="c-d" className="input hl" inputMode="numeric" maxLength={6} required value={f.destination} onChange={(e) => set("destination", e.target.value.replace(/\D/g, ""))} /></div>
        <div className="field"><label htmlFor="c-w">Weight (kg)</label><input id="c-w" className="input" type="number" step="0.01" min="0.01" required value={f.weightKg} onChange={(e) => set("weightKg", e.target.value)} /></div>
        <div className="field"><label htmlFor="c-p">Payment</label>
          <select id="c-p" className="select" value={f.payment} onChange={(e) => set("payment", e.target.value as "prepaid" | "cod" | "fod")}><option value="prepaid">Prepaid</option><option value="cod">COD</option><option value="fod">FOD — freight paid by receiver</option></select>
        </div>
        {f.payment === "cod" && (
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="c-cod">COD amount to collect (₹)</label><input id="c-cod" className="input" type="number" min="1" required value={f.codAmount} onChange={(e) => set("codAmount", e.target.value)} /></div>
        )}
      </div>
      <div className="grid3 mt12">
        <div className="field"><label htmlFor="c-l">L (cm)</label><input id="c-l" className="input" type="number" min="1" value={f.l} onChange={(e) => set("l", e.target.value)} /></div>
        <div className="field"><label htmlFor="c-b">B (cm)</label><input id="c-b" className="input hl" type="number" min="1" value={f.b} onChange={(e) => set("b", e.target.value)} /></div>
        <div className="field"><label htmlFor="c-h">H (cm)</label><input id="c-h" className="input" type="number" min="1" value={f.h} onChange={(e) => set("h", e.target.value)} /></div>
      </div>
      <div className="res" id="calc-status" aria-live="polite">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="b small">{best ? `Best: ${best.carrierName} · ${best.serviceName}` : "Check your final rate"}</div>
          <div className="tiny muted">final price incl. GST</div>
        </div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 24, fontWeight: 700 }}>{state === "loading" ? "…" : best ? formatINR(best.total) : "—"}</div></div>
      </div>
      <button className="btn btn-orange btn-block" disabled={state === "loading"}>{state === "loading" ? "Checking…" : "Check rate"}</button>
      {msg && <p className={state === "error" ? "err small mt8" : "small muted mt8"} role={state === "error" ? "alert" : undefined}>{msg}</p>}
    </form>
  );

  const results = state === "done" && offers.length > 0 && (
    <div className="calc-results" aria-label="Courier options">
      {offers.some((o) => o.isDemo) && <p className="tiny muted mb8">Demo rates — live courier accounts are not connected yet.</p>}
      {offers.map((o) => {
        const logo = carrierLogo(o.carrierCode);
        const expanded = open === o.quoteId;
        return (
          <div key={o.quoteId} className="card calc-offer">
            <div className="row between" style={{ gap: 12, alignItems: "center" }}>
              <div className="row" style={{ gap: 12, alignItems: "center", minWidth: 0 }}>
                {logo ? <img className="clogo" src={logo} alt={o.carrierName} /> : <span className="b">{o.carrierName}</span>}
                <div style={{ minWidth: 0 }}>
                  <div className="b small">{o.carrierName} · {o.serviceName}</div>
                  <div className="tiny muted">{o.mode}{o.etaDays ? ` · ETA ${o.etaDays} day${o.etaDays > 1 ? "s" : ""}` : ""} · {(o.chargeableWeightGrams / 1000).toFixed(1)} kg chargeable{o.isPilot ? " · verification service" : ""}</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                {o.payer && o.payer.receiver > 0 ? <>
                  <div className="b" style={{ fontSize: 20 }}>{formatINR(o.payer.receiver)}</div>
                  <div className="tiny" style={{ color: "var(--orange)" }}>Freight payable by receiver</div>
                  <div className="tiny muted">{o.payer.sender > 0 ? `+ ${formatINR(o.payer.sender)} charged to sender` : "Nothing charged to sender"}</div>
                </> : <>
                  <div className="b" style={{ fontSize: 20 }}>{formatINR(o.total)}</div>
                  <div className="tiny muted">incl. GST{o.paymentMode === "cod" ? " · freight paid by sender" : ""}</div>
                </>}
              </div>
            </div>
            <div className="row between mt8" style={{ gap: 8 }}>
              <button type="button" className="link small" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : o.quoteId)}>{expanded ? "Hide" : "View"} charges</button>
              {bookHref ? <a className="btn btn-sm btn-orange" href={bookHref(o, f)}>Book with this courier</a> : <a className="btn btn-sm btn-orange" href={`/login/?next=${encodeURIComponent("/portal/orders/new")}`}>Book now</a>}
            </div>
            {expanded && (
              <table className="tbl mt8 calc-breakdown"><tbody>
                {o.lines.map((l) => <tr key={l.code}><td>{l.label}</td><td style={{ textAlign: "right" }}>{formatINR(l.sellPreTax)}</td></tr>)}
                <tr><td>GST</td><td style={{ textAlign: "right" }}>{formatINR(o.gst)}</td></tr>
                <tr><td className="b">Total</td><td className="b" style={{ textAlign: "right" }}>{formatINR(o.total)}</td></tr>
                {o.payer && o.payer.receiver > 0 && <><tr><td>Receiver pays at delivery (FOD)</td><td style={{ textAlign: "right" }}>{formatINR(o.payer.receiver)}</td></tr><tr><td>Sender pays</td><td style={{ textAlign: "right" }}>{formatINR(o.payer.sender)}</td></tr></>}
                <tr><td colSpan={2} className="tiny muted">Quote valid until {new Date(o.expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Final charge is based on carrier-measured weight.</td></tr>
              </tbody></table>
            )}
          </div>
        );
      })}
    </div>
  );

  if (layout === "wide") {
    return (
      <div className={state === "done" ? "calc-wide has-results" : "calc-wide"}>
        <div className="card" style={{ borderRadius: 22, padding: 26, boxShadow: "0 20px 50px rgba(11,31,58,.08)" }}>{form}</div>
        {results}
      </div>
    );
  }
  return (
    <>
      <div className="card" style={{ borderRadius: 22, padding: 26, boxShadow: "0 20px 50px rgba(11,31,58,.08)" }}>{form}</div>
      {results}
    </>
  );
}
