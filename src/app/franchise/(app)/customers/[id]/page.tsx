import { notFound } from "next/navigation";
import { rupeesText } from "@/lib/franchise";
import { customerWallet, franchiseCustomer, franchiseCustomers, franchiseShipments } from "@/server/franchise/portal";
import { requireFranchise } from "@/server/franchise/session";
import { ShipmentTable, day } from "../../parts";

const KIND: Record<string, string> = {
  recharge_credit: "Wallet recharge", adjustment_credit: "Credit by Vishwaship", adjustment_debit: "Debit by Vishwaship", weight_charge: "Extra weight charge",
  weight_reversal: "Weight charge reversed", refund_credit: "Refund", refund_debit: "Refund reversed", reserve_settle: "Shipping charge", credits_purchase: "Credits bought",
  store_plan: "Online store plan", store_deposit: "Ads deposit", store_deposit_refund: "Ads deposit refund",
};

export default async function FranchiseCustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { franchise: f } = await requireFranchise();
  const { id } = await params;
  const org = await franchiseCustomer(f.id, id);
  if (!org) notFound();
  const [row] = (await franchiseCustomers(f.id)).filter((r) => r.orgId === org.id);
  const [ships, wallet] = await Promise.all([franchiseShipments(f.id, { orgId: org.id, limit: 100 }), customerWallet(org.id, 20)]);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/franchise/customers/">My customers</a></p><h1>{org.businessName}</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>{row?.name}{row?.mobile && ` · ${row.mobile}`}{row?.email && ` · ${row.email}`} · joined {day(org.franchiseLinkedAt ?? org.createdAt)}</p></div></div>
      <div className="grid3 mb12" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div className="card" style={{ padding: 14 }}><div className="tiny muted">Wallet balance</div><div style={{ fontSize: 22, fontWeight: 700 }}>{rupeesText(wallet.balancePaise)}</div>{wallet.heldPaise > 0 && <div className="tiny muted">{rupeesText(wallet.heldPaise)} on hold for bookings</div>}</div>
        <div className="card" style={{ padding: 14 }}><div className="tiny muted">Shipments this month</div><div style={{ fontSize: 22, fontWeight: 700 }}>{row?.shipmentsMonth ?? 0}</div><div className="tiny muted">{rupeesText(row?.valueMonthPaise ?? 0)}</div></div>
        <div className="card" style={{ padding: 14 }}><div className="tiny muted">All shipments</div><div style={{ fontSize: 22, fontWeight: 700 }}>{row?.shipmentsTotal ?? 0}</div><div className="tiny muted">Last {day(row?.lastShipmentAt ?? null)}</div></div>
      </div>
      <div className="card p0 mb12"><div className="card-h"><b>Shipments</b></div><ShipmentTable rows={ships} empty="No shipments yet." /></div>
      <div className="card p0"><div className="card-h"><b>Wallet activity</b></div>
        {wallet.entries.length === 0 ? <p className="small muted" style={{ padding: 16, margin: 0 }}>No wallet activity yet.</p> : (
          <table className="tbl"><thead><tr><th>Date</th><th>Entry</th><th>Amount</th><th>Balance after</th></tr></thead><tbody>{wallet.entries.map((e) => (
            <tr key={e.id}><td className="small">{day(e.createdAt)}</td><td className="small">{KIND[e.kind] ?? e.kind.replace(/_/g, " ")}</td>
              <td className={`small ${e.amountPaise < 0 ? "red" : "green"}`}>{e.amountPaise < 0 ? "−" : "+"}{rupeesText(Math.abs(e.amountPaise))}</td><td className="small">{rupeesText(e.balanceAfterPaise)}</td></tr>
          ))}</tbody></table>
        )}
      </div>
    </>
  );
}
