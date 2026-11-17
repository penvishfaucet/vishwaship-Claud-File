import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { carrierLogo } from "@/lib/site";
import { formatINR } from "@/lib/money";
import { SLABS_GRAMS, priceList } from "@/server/price-list";
import { portalContext } from "@/server/portal/context";
import { rateLimit } from "@/server/security/rate-limit";

export default async function PriceListPage({ searchParams }: { searchParams: Promise<{ refresh?: string; zone?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  let refresh = false;
  if (sp.refresh) refresh = (await rateLimit(`pricelist:${ctx.org.id}`, 1, 600)).ok;
  const pl = await priceList(ctx.org.id, refresh);
  return (
    <>
      <div className="page-h">
        <div><h1>Shipment Price List</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Your rates per courier, zone and weight slab — prepaid B2C, including GST. These are the same prices you pay when booking.</p></div>
        <div className="actions"><Link className="btn btn-outline" href="/portal/tools/price-list/?refresh=1"><RefreshCw size={16} /> Refresh rates</Link><Link className="btn btn-orange" href="/portal/rates/">Rate Calculator</Link></div>
      </div>
      {"error" in pl ? <div className="card empty"><p className="muted">{pl.error}</p><Link className="btn btn-navy" href="/portal/addresses/">Add warehouse</Link></div> : (
        <>
          <div className="card mb12 row wrap" style={{ padding: 12, gap: 16 }}>
            <span className="small">From PIN <b>{pl.origin}</b> (default warehouse)</span>
            <span className="small">{pl.personalized ? <><span className="chip c-active">Personalized rates</span>{pl.effectiveFrom && <> effective {new Date(pl.effectiveFrom).toLocaleDateString("en-IN")}</>}</> : <span className="chip c-draft">Standard rates</span>}</span>
            <span className="small muted">GST {pl.gstPct}% included · updated {new Date(pl.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
          </div>
          <nav className="pills mb12" aria-label="Zone">
            <Link className={!sp.zone ? "pill on" : "pill"} href="/portal/tools/price-list/">All zones</Link>
            {pl.zones.map((z) => <Link key={z.zone} className={sp.zone === z.zone ? "pill on" : "pill"} href={`/portal/tools/price-list/?zone=${z.zone}`}>Zone {z.zone} · {z.label}</Link>)}
          </nav>
          {pl.rows.length === 0 ? <div className="card empty"><p className="muted">No courier is serviceable for these sample routes right now.</p></div> : (
            <div className="card p0 tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Courier</th><th>Service</th><th>Zone</th>{SLABS_GRAMS.map((g) => <th key={g} style={{ textAlign: "right" }}>{g < 1000 ? `${g} g` : `${g / 1000} kg`}</th>)}<th style={{ textAlign: "right" }}>COD fee*</th><th>ETA</th></tr></thead>
                <tbody>
                  {pl.rows.filter((r) => !sp.zone || r.zone === sp.zone).map((r) => {
                    const logo = carrierLogo(r.carrierCode);
                    return (
                      <tr key={`${r.carrierCode}${r.serviceName}${r.zone}`}>
                        <td className="small"><span className="row" style={{ gap: 8, alignItems: "center" }}>{logo && <img src={logo} alt="" width={28} height={28} style={{ objectFit: "contain" }} />}<b>{r.carrierName}</b></span></td>
                        <td className="small">{r.serviceName}</td><td className="small">{r.zone} · {pl.zones.find((z) => z.zone === r.zone)?.label}</td>
                        {SLABS_GRAMS.map((g) => <td key={g} style={{ textAlign: "right" }} className="small">{r.cells[g] != null ? formatINR(r.cells[g]!) : "—"}</td>)}
                        <td style={{ textAlign: "right" }} className="small">{r.codFee != null ? formatINR(r.codFee) : "—"}</td>
                        <td className="small">{r.eta ? `${r.eta} d` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="tiny muted mt8">* COD fee shown for a ₹1,000 COD order, before GST. Volumetric weight (L×B×H ÷ divisor) applies when larger than actual weight. Surcharges such as ODA, docket or reverse pickup are added at booking when they apply. Couriers you switched off in Manage Courier are not listed.</p>
        </>
      )}
    </>
  );
}
