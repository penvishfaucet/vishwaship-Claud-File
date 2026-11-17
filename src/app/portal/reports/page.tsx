import { FileDown } from "lucide-react";
import { portalContext } from "@/server/portal/context";

const REPORTS = [
  ["orders", "Orders"], ["shipments", "Shipments & delivery performance"], ["ndr", "NDR / RTO"], ["charges", "Shipping charges"],
  ["passbook", "Wallet ledger"], ["cod", "COD / remittance"], ["disputes", "Weight disputes"], ["credits", "Notification usage"],
] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  await portalContext();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  return (
    <>
      <div className="page-h"><h1>Reports</h1></div>
      <form className="card row wrap" style={{ padding: 16, gap: 10, alignItems: "end" }} action="/api/portal/export/report" method="get">
        <div className="field"><label htmlFor="r">Report</label><select id="r" name="r" className="select" defaultValue={sp.r ?? "orders"}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="from">From (IST)</label><input id="from" name="from" type="date" className="input" defaultValue={sp.from ?? monthAgo} /></div>
        <div className="field"><label htmlFor="to">To (IST)</label><input id="to" name="to" type="date" className="input" defaultValue={sp.to ?? today} max={today} /></div>
        <button className="btn btn-orange"><FileDown size={16} /> Export</button>
      </form>
      <p className="tiny muted mt8">Exports use the same filters and totals as the on-screen lists, cover your workspace only, and are logged. Cells starting with = + - @ are escaped to prevent spreadsheet formula injection.</p>
    </>
  );
}
