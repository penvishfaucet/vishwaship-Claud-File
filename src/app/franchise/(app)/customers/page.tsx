import { rupeesText } from "@/lib/franchise";
import { franchiseCustomers } from "@/server/franchise/portal";
import { requireFranchise } from "@/server/franchise/session";
import { day } from "../parts";

const KYC: Record<string, string> = { not_started: "Not started", pending: "In review", approved: "Approved", changes_requested: "Changes needed", rejected: "Rejected" };

export default async function FranchiseCustomers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { franchise: f } = await requireFranchise();
  const { q } = await searchParams;
  const all = await franchiseCustomers(f.id);
  const term = q?.trim().toLowerCase().slice(0, 60);
  const rows = term ? all.filter((r) => [r.businessName, r.name, r.email ?? "", r.mobile ?? ""].some((s) => s.toLowerCase().includes(term))) : all;
  return (
    <>
      <div className="page-h"><div><h1>My customers</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Customers who signed up with your referral link or were linked to you by Vishwaship. Keep their details confidential.</p></div></div>
      <form className="row wrap mb12" style={{ gap: 8 }} method="get">
        <input name="q" className="input" placeholder="Search name, email, mobile" defaultValue={q ?? ""} style={{ flex: "1 1 240px", width: "auto" }} aria-label="Search customers" />
        <button className="btn btn-outline">Search</button>
      </form>
      {rows.length === 0 ? (
        <div className="card empty"><p className="muted">{all.length ? "No customer matches." : "No customers yet. Share your referral link to bring your first customer."}</p>{!all.length && <a className="btn btn-orange" href="/franchise/referral/">Get referral link</a>}</div>
      ) : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Customer</th><th>Contact</th><th>Joined</th><th>KYC</th><th>Wallet</th><th>This month</th><th>Last shipment</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.orgId}>
              <td className="small"><a href={`/franchise/customers/${r.orgId}/`}><b>{r.businessName}</b></a>{r.status !== "active" && <div className="tiny red">{r.status}</div>}</td>
              <td className="small">{r.name}<div className="tiny muted">{[r.mobile, r.email].filter(Boolean).join(" · ")}</div></td>
              <td className="small">{day(r.linkedAt ?? r.createdAt)}<div className="tiny muted">{r.source === "admin" ? "Linked by Vishwaship" : "Referral link"}</div></td>
              <td className="small">{KYC[r.kycStatus] ?? r.kycStatus}</td>
              <td className="small">{rupeesText(r.walletPaise)}</td>
              <td className="small">{r.shipmentsMonth} shipments<div className="tiny muted">{rupeesText(r.valueMonthPaise)}</div></td>
              <td className="small">{day(r.lastShipmentAt)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
