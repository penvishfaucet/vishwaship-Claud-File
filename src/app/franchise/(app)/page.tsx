import { CopyButton } from "@/components/franchise/FranchiseShell";
import { rupeesText } from "@/lib/franchise";
import { franchiseShipments, franchiseSummary } from "@/server/franchise/portal";
import { referralLink, siteBase } from "@/server/franchise/referral";
import { requireFranchise } from "@/server/franchise/session";
import { ShipmentTable } from "./parts";

export default async function FranchiseHome() {
  const { franchise: f } = await requireFranchise();
  const [sum, ships, base] = await Promise.all([franchiseSummary(f.id), franchiseShipments(f.id, { limit: 8 }), siteBase()]);
  const link = referralLink(base, f.code);
  const month = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" });
  const target = f.monthlyTargetShipments;
  const tiles: Array<[string, string, string?]> = [
    ["Customers", sum.customers.toLocaleString("en-IN"), `${sum.newThisMonth} new this month`],
    [`Shipments (${month})`, sum.shipmentsMonth.toLocaleString("en-IN"), target ? `Target ${target.toLocaleString("en-IN")} · ${Math.min(100, Math.round((sum.shipmentsMonth / target) * 100))}%` : `${sum.deliveredMonth} delivered`],
    ["Shipping value this month", rupeesText(sum.valueMonthPaise), "What your customers paid, incl. GST"],
    ["Customer wallet balance", rupeesText(sum.walletPaise), `${sum.activeThisMonth} customers shipped this month`],
  ];
  return (
    <>
      <div className="page-h"><div><h1>Dashboard</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{f.businessName} · {f.code}</p></div></div>
      <div className="grid3 mb12" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {tiles.map(([k, v, sub]) => (
          <div key={k} className="card" style={{ padding: 14 }}>
            <div className="tiny muted">{k}</div><div style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>{v}</div>{sub && <div className="tiny muted">{sub}</div>}
          </div>
        ))}
      </div>
      {target > 0 && (
        <div className="card mb12" style={{ padding: 14 }}>
          <div className="small" style={{ marginBottom: 6 }}>Monthly target: <b>{sum.shipmentsMonth.toLocaleString("en-IN")}</b> of {target.toLocaleString("en-IN")} shipments</div>
          <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }} role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={sum.shipmentsMonth} aria-label="Monthly target">
            <div style={{ width: `${Math.min(100, (sum.shipmentsMonth / target) * 100)}%`, height: "100%", background: "var(--orange)" }} />
          </div>
        </div>
      )}
      <div className="card mb12" style={{ padding: 14 }}>
        <div className="small b" style={{ marginBottom: 6 }}>Your referral link</div>
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input mono" readOnly value={link} aria-label="Referral link" style={{ flex: "1 1 260px", width: "auto" }} />
          <CopyButton text={link} />
          <a className="btn btn-ghost" href="/franchise/referral/">How it works</a>
        </div>
      </div>
      <div className="card p0"><div className="card-h row" style={{ justifyContent: "space-between" }}><b>Latest shipments</b><a className="small" href="/franchise/shipments/">See all</a></div>
        <ShipmentTable rows={ships} showCustomer empty="No shipments by your customers yet." />
      </div>
    </>
  );
}
