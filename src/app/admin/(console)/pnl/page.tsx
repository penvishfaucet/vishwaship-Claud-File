import Link from "next/link";
import { PnlSummary, PnlTable } from "@/components/admin/PnlViews";
import { requireStaff } from "@/server/auth/session";
import { pnlByOrg } from "@/server/finance/pnl";
import { pnlPresets, pnlRange } from "@/server/finance/pnl-range";

export const dynamic = "force-dynamic";

/** Admin → Profit & Loss: Vishwaship's profit or loss overall and per customer. Cost access only. */
export default async function PnlPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; q?: string; only?: string }> }) {
  const sp = await searchParams;
  await requireStaff("shipments.cost.read");
  const r = pnlRange(sp);
  const { rows, total, gstBps } = await pnlByOrg(r.range);
  const q = (sp.q ?? "").trim().toLowerCase();
  const shown = rows.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (sp.only !== "loss" || x.profit < 0) && (sp.only !== "active" || x.shipments > 0));
  const losers = rows.filter((x) => x.profit < 0).length;
  return (
    <>
      <div className="page-h"><div><h1>Profit &amp; Loss</h1><p className="small muted" style={{ margin: "4px 0 0" }}>What Vishwaship earns from each customer after courier cost — {r.label}. Amounts exclude GST ({gstBps / 100}%).</p></div></div>
      <div className="row between wrap mb12" style={{ gap: 10 }}>
        <nav className="pills">{pnlPresets().map((p) => <Link key={p.label} className={p.qs === r.qs ? "pill on" : "pill"} href={`/admin/pnl/${p.qs ? `?${p.qs}` : ""}`}>{p.label}</Link>)}</nav>
        <form method="get" className="row wrap" style={{ gap: 6, alignItems: "end" }}>
          <div className="field"><label htmlFor="pf">From</label><input id="pf" type="date" name="from" className="input" defaultValue={r.from} /></div>
          <div className="field"><label htmlFor="pt">To</label><input id="pt" type="date" name="to" className="input" defaultValue={r.to} /></div>
          <button className="btn btn-sm btn-outline">Show</button>
        </form>
      </div>
      <PnlSummary r={total} scope="all customers" />
      <div className="row between wrap mt16 mb12" style={{ gap: 10 }}>
        <h2 className="b" style={{ fontSize: 17, margin: 0 }}>Customer-wise</h2>
        <form method="get" className="row wrap" style={{ gap: 6 }}>
          {r.from && <input type="hidden" name="from" value={r.from} />}{r.to && <input type="hidden" name="to" value={r.to} />}
          <input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Search customer" aria-label="Search customer" />
          <select className="select" name="only" defaultValue={sp.only ?? ""} aria-label="Show"><option value="">All customers</option><option value="active">With shipments</option><option value="loss">Loss-making{losers ? ` (${losers})` : ""}</option></select>
          <button className="btn btn-sm btn-outline">Filter</button>
        </form>
      </div>
      <PnlTable rows={shown} total={total} rangeQs={r.qs} />
      <p className="tiny muted mt12">Revenue = shipping charged (excl. GST) + weight discrepancy charged − refunded + notification credits sold + manual wallet adjustments. Courier cost = the courier’s confirmed charge where reported, else the quoted cost. Cancelled shipments are excluded (refunded). WhatsApp / AI-call provider bills are not included.</p>
    </>
  );
}
