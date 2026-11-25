import { Plane, RefreshCw, Truck, Zap } from "lucide-react";
import { type CardService, FRANCHISE_ZONES, addMargin, cardWithMargin } from "@/lib/franchise-rates";
import { formatINR } from "@/lib/money";
import type { LivePriceList } from "@/server/franchise-rates/live-list";

const WEIGHTS = [0.5, 1, 2, 3, 5];
const rs = (p: number) => formatINR(p).replace(/\.00$/, "");
const wLabel = (w: number) => (w < 1 ? `${w * 1000} g` : `${w} kg`);

function Zones({ routes }: { routes?: Record<string, { city: string }> }) {
  return (
    <div className="fr-zones" data-reveal>
      {FRANCHISE_ZONES.map((z, i) => (
        <div key={z.code} className="fr-zone" style={{ ["--i" as string]: i }}>
          <span className="fr-zone-code">{z.code}</span>
          <b>{z.label}</b>
          <small>{z.hint}{routes?.[z.code] ? ` · e.g. ${routes[z.code].city}` : ""}</small>
        </div>
      ))}
    </div>
  );
}

/**
 * Zone-wise price list with the franchise margin added. Uses LIVE courier rates (cheapest courier per zone and
 * weight) when available; until the first live run finishes it falls back to the admin base rate card.
 */
export function FranchiseRateChart({ live, routes, origin, card, marginBps }: {
  live: LivePriceList | null; routes: Record<string, { city: string }>; origin: { pin: string; city: string };
  card: CardService[]; marginBps: number;
}) {
  const hasLive = !!live && Object.values(live.cells).some((r) => r.some(Boolean));
  if (hasLive) {
    const updated = new Date(live!.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    return (
      <div className="fr-chart">
        <Zones routes={routes} />
        <div className="fr-svc card" data-reveal>
          <div className="fr-svc-h">
            <span className="fr-svc-ic"><Zap size={20} /></span>
            <div><h3>Live courier rates · best price per zone</h3><small>Cheapest courier for each weight, from {origin.city} ({origin.pin}) · prepaid · incl. GST</small></div>
            <span className="fr-live"><i /> LIVE</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl fr-tbl">
              <thead><tr><th scope="col">Weight</th>{FRANCHISE_ZONES.map((z) => <th scope="col" key={z.code}>Zone {z.code}</th>)}</tr></thead>
              <tbody>
                {WEIGHTS.map((w, wi) => (
                  <tr key={w}>
                    <th scope="row">{wLabel(w)}</th>
                    {FRANCHISE_ZONES.map((z) => {
                      const c = live!.cells[z.code]?.[wi];
                      if (!c) return <td key={z.code} className="muted">—</td>;
                      const m = addMargin(c, marginBps);
                      return <td key={z.code}><b>{rs(Math.round(m.total / 100) * 100)}</b><div className="fr-cr">{c.carrierName}</div></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="tiny muted">
          <RefreshCw size={12} style={{ verticalAlign: -2 }} /> Updated {updated} from live courier rates; refreshed daily. Your exact price depends on the pickup
          and delivery pincodes, box size (volumetric weight L×B×H ÷ 5000) and payment mode — choose <b>COD</b> in the calculator above for COD prices.
        </p>
      </div>
    );
  }

  return (
    <div className="fr-chart">
      <Zones />
      {card.map((svc, si) => {
        const Icon = /express|air/i.test(svc.name) ? Plane : Truck;
        return (
          <div key={svc.name} className="fr-svc card" data-reveal style={{ ["--i" as string]: si }}>
            <div className="fr-svc-h">
              <span className="fr-svc-ic"><Icon size={20} /></span>
              <div><h3>{svc.name}</h3><small>{svc.eta} delivery</small></div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl fr-tbl">
                <thead><tr><th scope="col">Weight</th>{FRANCHISE_ZONES.map((z) => <th scope="col" key={z.code}>Zone {z.code}</th>)}</tr></thead>
                <tbody>
                  {WEIGHTS.map((w) => (
                    <tr key={w}>
                      <th scope="row">{wLabel(w)}</th>
                      {FRANCHISE_ZONES.map((z, zi) => {
                        const extra = Math.max(0, Math.ceil((w * 1000 - 500) / 500));
                        return <td key={z.code}>{rs(cardWithMargin(svc.first500Paise[zi] + extra * svc.addl500Paise[zi], marginBps))}</td>;
                      })}
                    </tr>
                  ))}
                  <tr className="fr-add">
                    <th scope="row">Every extra 500 g</th>
                    {FRANCHISE_ZONES.map((z, zi) => <td key={z.code}>+{rs(cardWithMargin(svc.addl500Paise[zi], marginBps))}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p className="tiny muted">Live courier rates are loading — refresh in a few minutes. Rates above are before GST (18%).</p>
    </div>
  );
}
