import { Plane, Truck } from "lucide-react";
import { type CardService, FRANCHISE_ZONES, cardWithMargin } from "@/lib/franchise-rates";
import { formatINR } from "@/lib/money";

const WEIGHTS = [0.5, 1, 2, 3, 5];
const rs = (p: number) => formatINR(p).replace(/\.00$/, "");

/** Zone-wise shipping price list with the franchise margin added (pre-GST). */
export function FranchiseRateChart({ card, marginBps }: { card: CardService[]; marginBps: number }) {
  return (
    <div className="fr-chart">
      <div className="fr-zones" data-reveal>
        {FRANCHISE_ZONES.map((z, i) => (
          <div key={z.code} className="fr-zone" style={{ ["--i" as string]: i }}>
            <span className="fr-zone-code">{z.code}</span>
            <b>{z.label}</b>
            <small>{z.hint}</small>
          </div>
        ))}
      </div>

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
                      <th scope="row">{w < 1 ? `${w * 1000} g` : `${w} kg`}</th>
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
      <p className="tiny muted">
        Rates are before GST (18%). Chargeable weight is the higher of actual and volumetric weight (L×B×H ÷ 5000).
        COD charges apply on cash-on-delivery orders — choose <b>COD</b> in the calculator above to see the exact all-in price for your route.
      </p>
    </div>
  );
}
