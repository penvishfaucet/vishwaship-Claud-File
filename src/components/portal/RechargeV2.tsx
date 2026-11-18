"use client";
import "@/styles/recharge.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, CreditCard, Download, QrCode, ShieldCheck, Upload } from "lucide-react";
import { formatINR } from "@/lib/money";
import { bpsLabel, manualQuote, normaliseUtr, validUtr } from "@/lib/recharge";

declare global {
  interface Window {
    Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
    Cashfree?: (o: { mode: "sandbox" | "production" }) => { checkout: (o: { paymentSessionId: string; redirectTarget?: string }) => Promise<{ error?: { message?: string }; redirect?: boolean; paymentDetails?: unknown }> };
  }
}

export interface RechargeProps {
  balancePaise: number;
  gateway: "razorpay" | "cashfree" | null;
  demo: boolean;
  online: { minPaise: number; maxPaise: number };
  manual: null | { upiId: string; payeeName: string; hasQr: boolean; instructions: string; discountBps: number; minPaise: number; maxPaise: number; reviewMessage: string };
  autoFocus?: boolean;
}

const loadScript = (src: string, ok: () => boolean) => new Promise<void>((res, rej) => {
  if (ok()) return res();
  const s = document.createElement("script");
  s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error("Could not load the payment page. Check your connection and try again."));
  document.body.appendChild(s);
});
const istNow = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return d.toISOString().slice(0, 16); };

type Receipt = { id: string; status: string; statusLabel: string; creditPaise: number; reference: string | null; balancePaise: number | null; requestNumber: string | null };
type Step = "form" | "manual-pay" | "manual-submit" | "manual-done" | "online-result";

export function RechargeV2(p: RechargeProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("1000");
  const [method, setMethod] = useState<"online" | "manual">(p.gateway || p.demo ? "online" : "manual");
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [done, setDone] = useState<null | { id: string; requestNumber: string; ticketId: string; ticketNumber: string; message: string; paidDiffers: boolean }>(null);
  const [copied, setCopied] = useState(false);
  const [utr, setUtr] = useState("");
  const [paidAt, setPaidAt] = useState(istNow());
  const [paidRupees, setPaidRupees] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const rupees = Math.floor(Number(amount));
  const paise = Number.isFinite(rupees) && rupees > 0 ? rupees * 100 : 0;
  const q = useMemo(() => manualQuote(paise, p.manual?.discountBps ?? 0), [paise, p.manual?.discountBps]);
  const limits = method === "manual" && p.manual ? { min: p.manual.minPaise, max: p.manual.maxPaise } : { min: p.online.minPaise, max: p.online.maxPaise };
  const amountOk = paise >= limits.min && paise <= limits.max && Number(amount) === rupees;
  const gwName = p.gateway === "cashfree" ? "Cashfree" : p.gateway === "razorpay" ? "Razorpay" : "Online (demo)";
  const onlineAvailable = !!p.gateway || p.demo;

  async function status(id: string): Promise<Receipt | null> {
    const r = await fetch(`/api/portal/recharge/${id}/`, { cache: "no-store" });
    return r.ok ? r.json() : null;
  }
  async function finishOnline(id: string) {
    let rc = await status(id);
    for (let i = 0; i < 4 && rc?.status === "payment_pending"; i++) { await new Promise((r) => setTimeout(r, 2500)); rc = await status(id); }
    setReceipt(rc); setStep("online-result"); router.refresh();
  }

  async function payOnline() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/portal/recharge/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountRupees: rupees }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Could not start the payment");
      if (j.mode === "demo") { await finishOnline(j.rechargeId); return; }
      if (j.mode === "razorpay") {
        await loadScript("https://checkout.razorpay.com/v1/checkout.js", () => !!window.Razorpay);
        const rz = new window.Razorpay!({
          key: j.keyId, order_id: j.razorpayOrderId, amount: j.amountPaise, currency: "INR", name: "Vishwaship", description: "Wallet recharge", theme: { color: "#f0712c" },
          handler: async (resp: Record<string, string>) => {
            await fetch("/api/portal/recharge/verify/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(resp) });
            await finishOnline(j.rechargeId);
          },
          modal: { ondismiss: () => { void finishOnline(j.rechargeId); } },
        });
        rz.on("payment.failed", () => { /* Razorpay shows the reason; the result screen re-checks */ });
        rz.open();
        return;
      }
      if (j.mode === "cashfree") {
        await loadScript("https://sdk.cashfree.com/js/v3/cashfree.js", () => !!window.Cashfree);
        const cf = window.Cashfree!({ mode: j.cashfreeMode });
        const res = await cf.checkout({ paymentSessionId: j.paymentSessionId, redirectTarget: "_modal" });
        if (res?.redirect) return; // in-app browsers: Cashfree returns the buyer to the recharge page
        await finishOnline(j.rechargeId);
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function submitManual() {
    setErr(null);
    const u = normaliseUtr(utr);
    if (!validUtr(u)) return setErr("Enter the UPI transaction reference / UTR (6–30 letters or digits).");
    if (!file) return setErr("Upload the payment screenshot.");
    if (file.size > 5 * 1024 * 1024) return setErr("The screenshot must be 5 MB or smaller.");
    const paid = Number(paidRupees || q.payablePaise / 100);
    if (!(paid > 0)) return setErr("Enter the amount you paid.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("amountRupees", String(rupees)); fd.set("utr", u); fd.set("paidAt", new Date(`${paidAt}:00+05:30`).toISOString());
      fd.set("paidRupees", String(paid)); fd.set("remarks", remarks); fd.set("file", file);
      const r = await fetch("/api/portal/recharge/manual/", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Could not submit the request");
      setDone({ id: j.id, requestNumber: j.requestNumber, ticketId: j.ticketId, ticketNumber: j.ticketNumber, message: j.message, paidDiffers: j.paidDiffers });
      setStep("manual-done"); router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const reset = () => { setStep("form"); setErr(null); setReceipt(null); setDone(null); setUtr(""); setFile(null); setRemarks(""); setPaidRupees(""); };

  const Summary = () => (
    <aside className="rc-sum" aria-label="Payment summary">
      <h3>Payment summary</h3>
      <dl>
        <div><dt>Method</dt><dd>{method === "manual" ? "Manual UPI / QR" : gwName}</dd></div>
        <div><dt>Wallet recharge</dt><dd>{formatINR(paise)}</dd></div>
        {method === "manual" && <div className="disc"><dt>Manual payment discount ({bpsLabel(q.discountBps)})</dt><dd>− {formatINR(q.discountPaise)}</dd></div>}
        <div className="tot"><dt>{method === "manual" ? "Amount to pay via UPI" : "Amount to pay"}</dt><dd>{formatINR(method === "manual" ? q.payablePaise : paise)}</dd></div>
        <div><dt>Wallet credit</dt><dd>{formatINR(paise)}{method === "manual" ? " (after verification)" : ""}</dd></div>
      </dl>
      <p className="tiny muted"><ShieldCheck size={13} aria-hidden /> Current balance {formatINR(p.balancePaise)}</p>
    </aside>
  );

  if (step === "online-result" && receipt) {
    const ok = receipt.status === "credited";
    return (
      <section className="card rc" aria-live="polite">
        <div className={`rc-result ${ok ? "ok" : receipt.status === "payment_pending" ? "wait" : "bad"}`}>
          <h2>{ok ? "Wallet recharged" : receipt.status === "payment_pending" ? "Payment pending" : "Payment not completed"}</h2>
          <p>{ok ? `${formatINR(receipt.creditPaise)} has been credited to your wallet.` : receipt.status === "payment_pending" ? "We have not received a confirmation from the payment gateway yet. If money was debited, your wallet updates automatically — check All Recharges in a few minutes." : "No money was credited. If your account was debited, it is usually reversed by the bank, or the gateway confirms it shortly."}</p>
          <dl className="kv-list">
            <dt>Status</dt><dd>{receipt.statusLabel}</dd>
            <dt>Amount</dt><dd>{formatINR(receipt.creditPaise)}</dd>
            {receipt.reference && <><dt>Payment reference</dt><dd className="mono">{receipt.reference}</dd></>}
            {receipt.balancePaise != null && <><dt>Wallet balance</dt><dd>{formatINR(receipt.balancePaise)}</dd></>}
          </dl>
          <div className="row wrap mt12" style={{ gap: 8 }}><Link className="btn btn-outline btn-sm" href={`/portal/billing/recharges/${receipt.id}/`}>View receipt</Link><button type="button" className="btn btn-orange btn-sm" onClick={reset}>New recharge</button></div>
        </div>
      </section>
    );
  }

  if (step === "manual-done" && done) {
    return (
      <section className="card rc" aria-live="polite">
        <div className="rc-result ok">
          <h2>Request submitted</h2>
          <p>{done.message}</p>
          <dl className="kv-list">
            <dt>Request ID</dt><dd className="mono">{done.requestNumber}</dd>
            <dt>Ticket</dt><dd>{done.ticketNumber}</dd>
            <dt>Status</dt><dd>Pending Verification</dd>
            <dt>Wallet credit after approval</dt><dd>{formatINR(q.creditPaise)}</dd>
          </dl>
          {done.paidDiffers && <p className="small t-debit">The amount you entered as paid differs from {formatINR(q.payablePaise)}. Our team will check it against the payment received.</p>}
          <div className="row wrap mt12" style={{ gap: 8 }}><Link className="btn btn-navy btn-sm" href={`/portal/billing/recharges/${done.id}/`}>Track request</Link><Link className="btn btn-outline btn-sm" href={`/portal/support/${done.ticketId}/`}>Open ticket {done.ticketNumber}</Link><button type="button" className="btn btn-outline btn-sm" onClick={reset}>New recharge</button></div>
        </div>
      </section>
    );
  }

  if ((step === "manual-pay" || step === "manual-submit") && p.manual) {
    const m = p.manual;
    return (
      <section className="card rc" aria-labelledby="rc-h">
        <button type="button" className="rc-back" onClick={() => setStep(step === "manual-submit" ? "manual-pay" : "form")}><ArrowLeft size={16} aria-hidden /> Back</button>
        <div className="rc-grid">
          <div>
            {step === "manual-pay" ? (
              <>
                <h2 id="rc-h">Pay {formatINR(q.payablePaise)} by UPI</h2>
                <p className="small muted" style={{ marginTop: 4 }}>{m.instructions}</p>
                <div className="rc-qr">
                  {m.hasQr && <img src="/api/portal/recharge/qr/" alt={`UPI QR code for ${m.payeeName}`} />}
                  <div className="rc-pay">
                    <span className="lbl">Amount to pay</span>
                    <b className="amt">{formatINR(q.payablePaise)}</b>
                    <span className="lbl">Pay to</span><b>{m.payeeName}</b>
                    <span className="lbl">UPI ID</span>
                    <span className="row" style={{ gap: 6, flexWrap: "wrap" }}><b className="mono">{m.upiId}</b>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(m.upiId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy UPI ID"}</button></span>
                    {m.hasQr && <a className="btn btn-outline btn-sm" href="/api/portal/recharge/qr/?download=1" download><Download size={14} aria-hidden /> Download QR</a>}
                  </div>
                </div>
                <p className="small">Pay exactly <b>{formatINR(q.payablePaise)}</b>. Your wallet is credited <b>{formatINR(q.creditPaise)}</b> once we verify the payment. Choosing this method does not credit the wallet by itself.</p>
                <button type="button" className="btn btn-orange btn-lg rc-cta" onClick={() => { setPaidRupees((q.payablePaise / 100).toFixed(2)); setStep("manual-submit"); }}>I Have Paid — Submit Recharge Request</button>
              </>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); void submitManual(); }} className="col" style={{ gap: 12 }}>
                <h2 id="rc-h">Submit payment details</h2>
                <dl className="rc-mini">
                  <div><dt>Wallet recharge</dt><dd>{formatINR(q.creditPaise)}</dd></div>
                  <div><dt>Discount</dt><dd>{formatINR(q.discountPaise)}</dd></div>
                  <div><dt>Amount to pay</dt><dd>{formatINR(q.payablePaise)}</dd></div>
                </dl>
                <div className="field"><label htmlFor="rc-utr">UPI transaction reference / UTR *</label><input id="rc-utr" className="input mono" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 431245678901" autoComplete="off" required maxLength={40} /><span className="tiny muted">12-digit UTR / UPI Ref No. from your UPI app’s payment details.</span></div>
                <div className="grid2" style={{ gap: 12 }}>
                  <div className="field"><label htmlFor="rc-paid">Amount paid (₹) *</label><input id="rc-paid" className="input" inputMode="decimal" value={paidRupees} onChange={(e) => setPaidRupees(e.target.value.replace(/[^\d.]/g, ""))} required /></div>
                  <div className="field"><label htmlFor="rc-at">Payment date &amp; time *</label><input id="rc-at" className="input" type="datetime-local" value={paidAt} max={istNow()} onChange={(e) => setPaidAt(e.target.value)} required /></div>
                </div>
                <div className="field"><label htmlFor="rc-file">Payment screenshot * <span className="tiny muted">(JPG, PNG, WebP or PDF, max 5 MB)</span></label>
                  <label className="rc-drop"><Upload size={18} aria-hidden /><span>{file ? file.name : "Choose screenshot"}</span><input id="rc-file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></label></div>
                <div className="field"><label htmlFor="rc-rem">Remarks (optional)</label><textarea id="rc-rem" className="textarea" rows={2} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
                {err && <p className="small err" role="alert">{err}</p>}
                <button className="btn btn-orange btn-lg rc-cta" disabled={busy}>{busy ? "Submitting…" : "Submit Recharge Request"}</button>
              </form>
            )}
            {step === "manual-pay" && err && <p className="small err" role="alert">{err}</p>}
          </div>
          <Summary />
        </div>
      </section>
    );
  }

  return (
    <section className="card rc" id="recharge" aria-labelledby="rc-h">
      <div className="rc-grid">
        <form onSubmit={(e) => { e.preventDefault(); if (!amountOk) return; if (method === "manual") setStep("manual-pay"); else void payOnline(); }}>
          <div className="row between wrap" style={{ gap: 8 }}><h2 id="rc-h">Recharge wallet</h2><span className="rc-bal">Balance <b>{formatINR(p.balancePaise)}</b></span></div>
          <div className="field mt12"><label htmlFor="rc-amt">Recharge amount (₹)</label>
            <input id="rc-amt" className="input rc-amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "").slice(0, 8))} autoFocus={p.autoFocus} aria-describedby="rc-lim" />
            <span id="rc-lim" className={`tiny ${amountOk || !amount ? "muted" : "t-debit"}`}>Between {formatINR(limits.min)} and {formatINR(limits.max)}</span></div>
          <div className="pills mt8">{[500, 1000, 2500, 5000, 10000].map((v) => <button type="button" key={v} className={`pill${rupees === v ? " on" : ""}`} onClick={() => setAmount(String(v))}>₹{v.toLocaleString("en-IN")}</button>)}</div>
          <fieldset className="rc-methods">
            <legend>Payment method</legend>
            {onlineAvailable && (
              <label className={`rc-m${method === "online" ? " on" : ""}`}><input type="radio" name="m" checked={method === "online"} onChange={() => setMethod("online")} />
                <CreditCard size={22} aria-hidden /><span><b>{gwName}</b><small>UPI, cards, net banking, wallets — credited instantly after payment</small></span></label>
            )}
            {p.manual && (
              <label className={`rc-m${method === "manual" ? " on" : ""}`}><input type="radio" name="m" checked={method === "manual"} onChange={() => setMethod("manual")} />
                <QrCode size={22} aria-hidden /><span><b>Manual UPI / QR <em className="rc-save">Save {bpsLabel(p.manual.discountBps)}</em></b><small>Pay {paise ? formatINR(q.payablePaise) : "less"} by UPI · credited after verification</small></span></label>
            )}
            {!onlineAvailable && !p.manual && <p className="small muted">Recharge is temporarily unavailable. Please contact support.</p>}
          </fieldset>
          {p.demo && method === "online" && <p className="tiny muted"><span className="demo-badge">DEMO</span> No payment gateway is connected, so online recharges are simulated and marked as demo.</p>}
          {err && <p className="small err" role="alert">{err}</p>}
          <button className="btn btn-orange btn-lg rc-cta" disabled={busy || !amountOk || (method === "online" && !onlineAvailable) || (method === "manual" && !p.manual)}>
            {busy ? "Opening payment…" : method === "manual" ? `Continue — pay ${formatINR(q.payablePaise)} by UPI` : `Pay ${formatINR(paise)}`}
          </button>
        </form>
        <Summary />
      </div>
    </section>
  );
}
