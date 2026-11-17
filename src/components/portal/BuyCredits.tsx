"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { formatINR } from "@/lib/money";

type Pack = { id: string; credits: number; unitPricePaise: number };

export function BuyCredits({ balance, walletPaise, gstBps, packs }: { balance: number; walletPaise: number; gstBps: number; packs: Pack[] }) {
  const [packId, setPackId] = useState(packs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const router = useRouter();
  const pack = packs.find((p) => p.id === packId);
  const base = pack ? pack.credits * pack.unitPricePaise : 0;
  const gst = Math.round((base * gstBps) / 10_000);
  const total = base + gst;

  async function buy() {
    if (!pack) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/portal/credits/purchase", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ packId }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg({ err: j.error?.message ?? "Purchase failed" }); return; }
    setMsg({ ok: `${pack.credits} credits added.` });
    router.refresh();
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row between wrap" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <span className="qa-ic" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}><MessageSquare size={20} /></span>
          <div><div className="tiny muted">Notification credits</div><div className="b" style={{ fontSize: 26 }}>{balance.toLocaleString("en-IN")}</div></div>
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: "end" }}>
          <div className="field">
            <label htmlFor="pack">Credit pack</label>
            <select id="pack" className="select" value={packId} onChange={(e) => setPackId(e.target.value)}>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.credits.toLocaleString("en-IN")} credits × ₹{(p.unitPricePaise / 100).toFixed(2)}</option>)}
            </select>
          </div>
          <button className="btn btn-orange" onClick={buy} disabled={busy || !pack || total > walletPaise}>{busy ? "Buying…" : `Buy · ${formatINR(total)}`}</button>
        </div>
      </div>
      <p className="tiny muted mt8">{pack && <>{formatINR(base)} + GST {(gstBps / 100).toFixed(0)}% {formatINR(gst)} = {formatINR(total)}, paid from your shipping wallet. </>}1 SMS/WhatsApp update = 1 credit · COD confirmation = 2 credits. Credits are charged only when the provider accepts the message.</p>
      {total > walletPaise && <p className="err small">Wallet balance is too low for this pack. Recharge first.</p>}
      {msg?.ok && <p className="small t-credit" role="status">{msg.ok}</p>}
      {msg?.err && <p className="small err" role="alert">{msg.err}</p>}
    </div>
  );
}
