import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { carrierLogo } from "@/lib/site";
import { formatINR } from "@/lib/money";
import { SLABS_GRAMS, priceList, type PriceRow } from "@/server/price-list";
import { portalContext } from "@/server/portal/context";
import { rateLimit } from "@/server/security/rate-limit";

const slabLabel = (g: number) => `${g / 1000} kg`;
/** Whole rupees print without paise ("₹28"), like a printed rate chart. */
const inr = (p: number) => (p % 100 === 0 ? formatINR(p).replace(/\.00$/, "") : formatINR(p));

interface CourierGroup { key: string; carrierCode: string; carrierName: string; serviceName: string; byZone: Map<string, PriceRow>; codFee: number | null; codPct: number | null }

export default async function PriceListPage({ searchParams }: { searchParams: Promise<{ refresh?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  let refresh = false;
  if (sp.refresh) refresh = (await rateLimit(`pricelist:${ctx.org.id}`, 1, 600)).ok;
  const pl = await priceList(ctx.org.id, refresh);

  // one block per courier service: a row per weight slab, a column per zone
  const groups: CourierGroup[] = [];
  if (!("error" in pl)) {
    const byKey = new Map<string, CourierGroup>();
    for (const r of pl.rows) {
      const key = `${r.carrierCode}|${r.serviceName}`;
      let g = byKey.get(key);
      if (!g) { g = { key, carrierCode: r.carrierCode, carrierName: r.carrierName, serviceName: r.serviceName, byZone: new Map(), codFee: null, codPct: null }; byKey.set(key, g); groups.push(g); }
      g.byZone.set(r.zone, r);
      if (g.codFee == null && r.codFee != null) { g.codFee = r.codFee; g.codPct = r.codPct ?? null; }
    }
    groups.sort((a, b) => a.carrierName.localeCompare(b.carrierName) || a.serviceName.localeCompare(b.serviceName));
  }
  const sameName = (g: CourierGroup) => groups.filter((x) => x.carrierName === g.carrierName).length > 1;

  return (
    <>
      <div className="page-h">
        <div><h1>Rate Chart</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Your rates for every courier partner, weight slab and zone — prepaid B2C, including GST. These are the same prices you pay when booking.</p></div>
        <div className="actions"><Link className="btn btn-outline" href="/portal/tools/price-list/?refresh=1"><RefreshCw size={16} /> Refresh rates</Link><Link className="btn btn-orange" href="/portal/rates/">Rate Calculator</Link></div>
      </div>
      {"error" in pl ? <div className="card empty"><p className="muted">{pl.error}</p><Link className="btn btn-navy" href="/portal/addresses/">Add warehouse</Link></div> : (
        <>
          <div className="card mb12 row wrap" style={{ padding: 12, gap: 16 }}>
            <span className="small">From PIN <b>{pl.origin}</b> (default warehouse)</span>
            <span className="small">{pl.personalized ? <><span className="chip c-active">Personalized rates</span>{pl.effectiveFrom && <> effective {new Date(pl.effectiveFrom).toLocaleDateString("en-IN")}</>}</> : <span className="chip c-draft">Standard rates</span>}</span>
            <span className="small muted">GST {pl.gstPct}% included · updated {new Date(pl.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
          </div>
          {groups.length === 0 ? <div className="card empty"><p className="muted">No courier is serviceable for these sample routes right now.</p></div> : (
            <div className="card p0 rc-card">
              <div className="rc-legend">
                {pl.zones.map((z) => <span key={z.zone}><b>Zone {z.zone}</b> — {z.label}</span>)}
              </div>
              <div className="tbl-wrap">
                <table className="rc-tbl">
                  <thead>
                    <tr>
                      <th>Courier Partner</th>
                      <th className="r">Slab Weight</th>
                      {pl.zones.map((z) => <th key={z.zone} className="r">Zone {z.zone}</th>)}
                      <th className="r">COD Charges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.flatMap((g) => {
                      const logo = carrierLogo(g.carrierCode);
                      return SLABS_GRAMS.map((w, i) => (
                        <tr key={`${g.key}|${w}`} className={i === 0 ? "rc-first" : undefined}>
                          <td>
                            <span className="rc-courier">
                              <span className="rc-logo">{logo ? <img src={logo} alt="" /> : <b>{g.carrierName.slice(0, 2).toUpperCase()}</b>}</span>
                              <span>{g.carrierName}{sameName(g) && <span className="rc-svc"> · {g.serviceName}</span>}</span>
                            </span>
                          </td>
                          <td className="r rc-slab">{slabLabel(w)}</td>
                          {pl.zones.map((z) => {
                            const v = g.byZone.get(z.zone)?.cells[w];
                            return <td key={z.zone} className="r">{v != null ? inr(v) : <span className="rc-dash">—</span>}</td>;
                          })}
                          <td className="r rc-cod">{g.codFee != null ? <>{inr(g.codFee)}{g.codPct != null && <small> or {g.codPct}%</small>}</> : <span className="rc-dash">—</span>}</td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="tiny muted mt8">COD charges are before GST: the flat amount or the percentage of the COD value, whichever is higher. “—” means the courier does not serve that zone or weight from your pickup PIN. Volumetric weight (L×B×H ÷ divisor) applies when larger than actual weight. Surcharges such as ODA, docket or reverse pickup are added at booking when they apply. Couriers you switched off in Manage Courier are not listed.</p>
        </>
      )}
    </>
  );
}
