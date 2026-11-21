import { franchiseShipments } from "@/server/franchise/portal";
import { requireFranchise } from "@/server/franchise/session";
import { ShipmentTable } from "../parts";

const FILTERS: Array<[string, string]> = [["", "All"], ["in_transit", "In transit"], ["out_for_delivery", "Out for delivery"], ["delivered", "Delivered"], ["ndr", "Delivery failed"], ["rto_initiated", "RTO"]];

export default async function FranchiseShipments({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { franchise: f } = await requireFranchise();
  const { status } = await searchParams;
  const st = FILTERS.some(([k]) => k === status) ? status : "";
  const rows = await franchiseShipments(f.id, { status: st || undefined, limit: 300 });
  return (
    <>
      <div className="page-h"><div><h1>Shipments</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Latest 300 shipments booked by your customers. Amount is what the customer paid, incl. GST.</p></div></div>
      <nav className="tabs mb12" aria-label="Shipment status">{FILTERS.map(([k, label]) => <a key={k} className={st === k ? "on" : ""} href={k ? `/franchise/shipments/?status=${k}` : "/franchise/shipments/"}>{label}</a>)}</nav>
      <div className="card p0"><ShipmentTable rows={rows} showCustomer empty="No shipments here yet." /></div>
    </>
  );
}
