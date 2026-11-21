import { customerPrices, commissionFor, pctText, standardBps } from "@/server/franchise/commission";
import { saveCustomerPrice } from "@/server/franchise/franchise-actions";
import { requireFranchise } from "@/server/franchise/session";
import { rupeesText } from "@/lib/franchise";
import { day } from "../parts";

export default async function FranchisePricing({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { franchise: f } = await requireFranchise();
  const sp = await searchParams;
  const ready = f.baseMarkupBps != null && f.minCustomerBps != null && f.maxCustomerBps != null;
  const [rows, std] = await Promise.all([customerPrices(f.id), standardBps()]);
  const canEdit = ready && f.status === "active";
  const ex = (bps: number) => ({ pays: 10_000 + Math.round(10_000 * bps / 10_000), earn: ready ? commissionFor(10_000, bps, f.baseMarkupBps!) : 0 });
  return (
    <>
      <div className="page-h"><div><h1>Customer pricing</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Set how much each of your customers pays over the courier cost. Your commission is the difference above your base rate.</p></div></div>
      {sp.ok && <p className="note small mb12">{sp.ok}</p>}
      {sp.err && <p className="err-box small mb12" role="alert">{sp.err}</p>}
      {!ready ? (
        <div className="card empty"><p className="muted">Vishwaship has not set up your commission yet. You will see your rates here once it is done.</p></div>
      ) : (
        <>
          <div className="grid3 mb12" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
            <div className="card" style={{ padding: 14 }}><div className="tiny muted">Your base rate</div><div style={{ fontSize: 22, fontWeight: 700 }}>{pctText(f.baseMarkupBps)}</div><div className="tiny muted">Vishwaship&apos;s price to you</div></div>
            <div className="card" style={{ padding: 14 }}><div className="tiny muted">You can charge</div><div style={{ fontSize: 22, fontWeight: 700 }}>{pctText(f.minCustomerBps)} – {pctText(f.maxCustomerBps)}</div><div className="tiny muted">over the courier cost</div></div>
            <div className="card" style={{ padding: 14 }}><div className="tiny muted">New customers start at</div><div style={{ fontSize: 22, fontWeight: 700 }}>{pctText(f.defaultCustomerBps ?? std)}</div><div className="tiny muted">{f.defaultCustomerBps == null ? "Vishwaship standard" : "your default"}</div></div>
          </div>
          <p className="small mb12">Example on ₹100 courier cost: at {pctText(f.maxCustomerBps)} the customer pays {rupeesText(ex(f.maxCustomerBps!).pays)} + GST and you earn {rupeesText(ex(f.maxCustomerBps!).earn)}; at {pctText(f.minCustomerBps)} they pay {rupeesText(ex(f.minCustomerBps!).pays)} + GST and you earn {rupeesText(ex(f.minCustomerBps!).earn)}. Commission is paid only on delivered shipments.</p>
          {rows.length === 0 ? <div className="card empty"><p className="muted">No customers yet.</p></div> : (
            <div className="card p0 tbl-wrap"><table className="tbl">
              <thead><tr><th>Customer</th><th>Current price</th><th>You earn per ₹100 cost</th><th>Change</th></tr></thead>
              <tbody>{rows.map((r) => {
                const bps = r.bps ?? std;
                return (
                  <tr key={r.orgId}>
                    <td className="small"><a href={`/franchise/customers/${r.orgId}/`}><b>{r.name}</b></a>{!r.kycApproved && <div className="tiny muted">KYC pending: Vishwaship&apos;s non-KYC rate applies until approved</div>}</td>
                    <td className="small">{pctText(bps)}<div className="tiny muted">{r.bps == null ? "Vishwaship standard" : `set ${day(r.setAt)}`}</div></td>
                    <td className="small">{rupeesText(commissionFor(10_000, bps, f.baseMarkupBps!))}</td>
                    <td>{canEdit ? (
                      <div className="row wrap" style={{ gap: 6 }}>
                        <form action={saveCustomerPrice} className="row" style={{ gap: 6 }}>
                          <input type="hidden" name="orgId" value={r.orgId} />
                          <input name="percent" className="input" inputMode="decimal" defaultValue={bps / 100} aria-label={`Markup percent for ${r.name}`} style={{ width: 80 }} required />
                          <span className="small">%</span>
                          <button className="btn btn-sm btn-outline">Save</button>
                        </form>
                        {r.bps != null && <form action={saveCustomerPrice}><input type="hidden" name="orgId" value={r.orgId} /><input type="hidden" name="reset" value="1" /><button className="btn btn-sm btn-ghost">Use standard</button></form>}
                      </div>
                    ) : <span className="tiny muted">{f.status !== "active" ? "Locked while suspended" : "—"}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
          <p className="tiny muted" style={{ marginTop: 8 }}>A new price applies to new quotes at once; shipments already booked keep their price. Some services (for example B2B freight) apply the percent to the base freight only.</p>
        </>
      )}
    </>
  );
}
