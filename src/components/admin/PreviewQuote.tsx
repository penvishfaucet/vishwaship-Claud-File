"use client";
import { useState } from "react";
import { formatINR } from "@/lib/money";

/** Pure preview of the markup formula on a sample eligible subtotal — no provider call, nothing saved. */
export function PreviewQuote({ defaultPct }: { defaultPct?: number }) {
  const [base, setBase] = useState("100");
  const [pass, setPass] = useState("0");
  const [pct, setPct] = useState(String(defaultPct ?? 25));
  const e = Math.round(Number(base || 0) * 100), p = Math.round(Number(pass || 0) * 100);
  const sub = e + Math.round((e * Math.round(Number(pct) * 100)) / 10_000) + p;
  const gst = Math.round((sub * 1800) / 10_000);
  return (
    <section className="card" style={{ padding: 18 }} aria-labelledby="pq-h">
      <h2 id="pq-h" className="b" style={{ fontSize: 15, marginTop: 0 }}>Preview Quote</h2>
      <div className="grid3" style={{ gap: 8 }}>
        <div className="field"><label htmlFor="pq-b">Eligible cost (₹)</label><input id="pq-b" className="input" type="number" value={base} onChange={(x) => setBase(x.target.value)} /></div>
        <div className="field"><label htmlFor="pq-p">Pass-through (₹)</label><input id="pq-p" className="input" type="number" value={pass} onChange={(x) => setPass(x.target.value)} /></div>
        <div className="field"><label htmlFor="pq-m">Markup %</label><input id="pq-m" className="input" type="number" value={pct} onChange={(x) => setPct(x.target.value)} /></div>
      </div>
      <dl className="kv-list mt12"><dt>Selling subtotal</dt><dd>{formatINR(sub)}</dd><dt>GST 18%</dt><dd>{formatINR(gst)}</dd><dt>Customer pays</dt><dd style={{ color: "var(--orange)" }}>{formatINR(sub + gst)}</dd></dl>
      <p className="tiny muted mt8">Example: ₹100 at 25% → ₹125 · 20% → ₹120 · 10% → ₹110 (before tax).</p>
    </section>
  );
}
