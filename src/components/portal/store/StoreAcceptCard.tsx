"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Check, ChevronRight, ShoppingBag } from "lucide-react";
import type { PendingAcceptance } from "@/server/store/orders";

const rupees = (p: number) => "₹" + (p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} hr ago` : `${Math.floor(m / 1440)} day${m >= 2880 ? "s" : ""} ago`;
};
const POLL_MS = 15_000;

/**
 * Phone dashboard: "Your store orders to accept". The count refreshes every 15 s (and when the app comes back to the
 * front), counts up when new orders arrive, and each order can be accepted right here. Accepted orders move to Process
 * Orders (To pack).
 */
export function StoreAcceptCard({ initial }: { initial: PendingAcceptance }) {
  const [d, setD] = useState(initial);
  const [shown, setShown] = useState(initial.count);
  const [fresh, setFresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const last = useRef(initial.count);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/portal/store/orders/pending/", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as PendingAcceptance;
      if (j.count > last.current) setFresh((f) => f + (j.count - last.current));
      last.current = j.count;
      setD(j);
    } catch { /* offline: keep the last numbers */ }
  }, []);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const vis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); window.removeEventListener("focus", vis); };
  }, [load]);

  // the big number counts up / down to the latest value
  useEffect(() => {
    if (shown === d.count) return;
    const t = setTimeout(() => setShown((s) => s + (d.count > s ? 1 : -1)), Math.max(30, 400 / Math.abs(d.count - shown)));
    return () => clearTimeout(t);
  }, [shown, d.count]);

  useEffect(() => { if (!fresh) return; const t = setTimeout(() => setFresh(0), 8000); return () => clearTimeout(t); }, [fresh]);

  async function accept(ids: string[], label: string) {
    setBusy(ids.length > 1 ? "all" : ids[0]); setMsg(null);
    try {
      const r = await fetch("/api/portal/store/orders/bulk/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "accept", ids }) });
      const j = await r.json().catch(() => ({}));
      const res = (j.results ?? []) as Array<{ ok: boolean; message: string; number: string }>;
      const ok = res.filter((x) => x.ok).length, bad = res.filter((x) => !x.ok);
      if (!r.ok || !res.length) setMsg({ ok: false, text: j?.error?.message ?? "Could not accept. Try again." });
      else if (bad.length) setMsg({ ok: ok > 0, text: `${ok ? `${ok} accepted. ` : ""}${bad.map((x) => `#${x.number}: ${x.message}`).join(" · ")}` });
      else setMsg({ ok: true, text: `${label} accepted — now in Process Orders (To pack).` });
    } catch { setMsg({ ok: false, text: "No internet. Try again." }); }
    setBusy(null);
    await load();
    router.refresh(); // Process Orders below picks up the newly accepted orders
  }

  const n = d.count;
  return (
    <section className={`card sa-card${n ? " has" : ""}`} aria-labelledby="sa-h">
      <Link href="/portal/store/orders/?tab=pending" className="sa-top">
        <span className="sa-ico" aria-hidden><ShoppingBag size={22} /></span>
        <span className="sa-t">
          <b id="sa-h">Your Store Orders</b>
          <span>{n ? "To be accepted — accept to start packing" : "No new orders waiting"}</span>
        </span>
        <span className="sa-n" aria-live="polite" aria-label={`${n} store order${n === 1 ? "" : "s"} to accept`}>
          {shown}
          {fresh > 0 && <i className="sa-new">+{fresh} new</i>}
        </span>
      </Link>
      {n > 0 && (
        <>
          <p className="sa-sum small"><BellRing size={14} aria-hidden /> {n} order{n === 1 ? "" : "s"} · {rupees(d.totalPaise)} waiting for you</p>
          <ul className="sa-list">
            {d.rows.map((o) => (
              <li key={o.id}>
                <Link href={`/portal/store/orders/${o.id}/`} className="sa-o">
                  <b>#{o.number}</b>
                  <span className="sa-meta">{[o.name, o.city].filter(Boolean).join(", ")} · {o.items} item{o.items === 1 ? "" : "s"}</span>
                  <span className="sa-meta"><span className={`sa-pay${o.cod ? " cod" : ""}`}>{o.cod ? "COD" : "Prepaid"}</span> {rupees(o.totalPaise)} · {ago(o.placedAt)}</span>
                </Link>
                <button type="button" className="btn btn-orange sa-acc" disabled={!!busy} onClick={() => accept([o.id], `#${o.number}`)} aria-label={`Accept order ${o.number}`}>
                  {busy === o.id ? "…" : <><Check size={16} aria-hidden /> Accept</>}
                </button>
              </li>
            ))}
          </ul>
          {msg && <p className={`sa-msg small ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</p>}
          <div className="sa-foot">
            {n > 1 && d.rows.length === n && (
              <button type="button" className="btn btn-soft" disabled={!!busy} onClick={() => { if (window.confirm(`Accept all ${n} orders? They will move to Process Orders (To pack).`)) void accept(d.rows.map((r) => r.id), "All orders"); }}>
                {busy === "all" ? "Accepting…" : `Accept all ${n}`}
              </button>
            )}
            <Link href="/portal/store/orders/?tab=pending" className="btn btn-soft sa-all">View all{n > d.rows.length ? ` ${n}` : ""} <ChevronRight size={15} aria-hidden /></Link>
          </div>
        </>
      )}
      {!n && msg && <p className={`sa-msg small ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</p>}
    </section>
  );
}
