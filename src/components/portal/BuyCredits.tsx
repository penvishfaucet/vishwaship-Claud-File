"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { formatINR } from "@/lib/money";

type Pack = { id: string; credits: number; unitPricePaise: number };
type Price = { paisePerCredit: number; gstInclusive: boolean; minRupees: number };

/** Buy notification credits from the shipping wallet: type any amount (₹1 = 4 credits at ₹0.25) or pick a pack. */
export function BuyCredits({ balance, walletPaise, gstBps, packs, price, perMessage }: { balance: number; walletPaise: number; gstBps: number; packs: Pack[]; price: Price; perMessage: { whatsapp: number; cod: number } }) {
  const [amount, setAmount] = useState(String(Math.max(price.minRupees, 100)));
  const [packId, setPackId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const router = useRouter();
  const pack = packs.find((p) => p.id === packId);
  const rupees = Number(amount) || 0;
  // same maths as the server (server/notifications/credits.ts → quoteAmount)
  const q = (() => {
    if (pack) { const base = pack.credits * pack.unitPricePaise; const gst = Math.round((base * gstBps) / 10_000); return { credits: pack.credits, total: base + gst, base, gst }; }
    const credits = Math.floor(Math.round(rupees * 100) / price.paisePerCredit);
    if (price.gstInclusive) { const total = credits * price.paisePerCredit; const base = Math.round((total * 10_000) / (10_000 + gstBps)); return { credits, total, base, gst: total - base }; }
    const base = credits * price.paisePerCredit; const gst = Math.round((base * gstBps) / 10_000); return { credits, total: base + gst, base, gst };
  })();
  const perRupee = Math.round(100 / price.paisePerCredit);
  const tooLow = !pack && rupees < price.minRupees;

  async function buy() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/portal/credits/purchase", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(pack ? { packId: pack.id } : { amountRupees: rupees }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ err: j.error?.message ?? "Purchase failed" }); return; }
    setMsg({ ok: `${Number(j.credits).toLocaleString("en-IN")} credits added.${j.resumed ? ` ${j.resumed} waiting COD confirmation message(s) are being sent now.` : ""}` });
    router.refresh();
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row between wrap" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <span className="qa-ic" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}><MessageSquare size={20} /></span>
          <div><div className="tiny muted">Notification credits</div><div className="b" style={{ fontSize: 26 }}>{balance.toLocaleString("en-IN")}</div><div className="tiny muted">≈ {Math.floor(balance / Math.max(1, perMessage.cod)).toLocaleString("en-IN")} COD confirmation messages</div></div>
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: "end" }}>
          {!pack && (
            <div className="field">
              <label htmlFor="cr-amt">Amount from wallet (₹)</label>
              <input id="cr-amt" className="input" inputMode="decimal" style={{ width: 140 }} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))} />
            </div>
          )}
          {packs.length > 0 && (
            <div className="field">
              <label htmlFor="pack">Or a pack</label>
              <select id="pack" className="select" value={packId} onChange={(e) => setPackId(e.target.value)}>
                <option value="">Any amount</option>
                {packs.map((p) => <option key={p.id} value={p.id}>{p.credits.toLocaleString("en-IN")} credits × ₹{(p.unitPricePaise / 100).toFixed(2)}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-orange" onClick={buy} disabled={busy || tooLow || q.credits < 1 || q.total > walletPaise}>{busy ? "Buying…" : `Buy ${q.credits.toLocaleString("en-IN")} credits · ${formatINR(q.total)}`}</button>
        </div>
      </div>
      {!pack && (
        <div className="row wrap mt8" style={{ gap: 6 }} aria-label="Quick amounts">
          {[50, 100, 250, 500, 1000].filter((x) => x >= price.minRupees).map((x) => <button key={x} type="button" className={`btn btn-sm ${rupees === x ? "btn-orange" : "btn-outline"}`} onClick={() => setAmount(String(x))}>₹{x} = {(x * perRupee).toLocaleString("en-IN")} credits</button>)}
        </div>
      )}
      <p className="tiny muted mt8">
        1 credit = ₹{(price.paisePerCredit / 100).toFixed(2)}{price.gstInclusive ? " incl. GST" : ` + GST ${(gstBps / 100).toFixed(0)}%`} (₹1 = {perRupee} credits), paid from your shipping wallet.
        {q.credits > 0 && <> This purchase: {formatINR(q.base)} + GST {formatINR(q.gst)} = {formatINR(q.total)}.</>}
        {" "}COD confirmation = {perMessage.cod} credit{perMessage.cod === 1 ? "" : "s"} per order · WhatsApp update = {perMessage.whatsapp} credit{perMessage.whatsapp === 1 ? "" : "s"}. Credits are used only when WhatsApp accepts the message; with 0 credits nothing is sent.
      </p>
      {tooLow && <p className="err small">Minimum ₹{price.minRupees}.</p>}
      {!tooLow && q.total > walletPaise && <p className="err small">Wallet balance is too low for this amount. Recharge the wallet first.</p>}
      {msg?.ok && <p className="small t-credit" role="status">{msg.ok}</p>}
      {msg?.err && <p className="small err" role="alert">{msg.err}</p>}
    </div>
  );
}
