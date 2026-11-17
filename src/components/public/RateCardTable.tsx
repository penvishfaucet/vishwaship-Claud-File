import { asc } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";

const rupees = (p: number) => `₹${Math.round(p / 100)}`;

/**
 * Indicative public rate card (admin-editable, table public_rate_card). It is marketing content:
 * bookable prices always come from the quote engine, so the note says so explicitly.
 */
export async function RateCardTable() {
  const db = await getDb();
  const rows = await db.select().from(schema.publicRateCard).orderBy(asc(schema.publicRateCard.sort));
  const zones = await getSetting<Array<{ code: string; label: string }>>("public_rate_card_zones", [
    { code: "A", label: "Zone A · Local" }, { code: "B", label: "Zone B · Regional" }, { code: "C", label: "Zone C · Metro" },
    { code: "D", label: "Zone D · Rest of India" }, { code: "E", label: "Zone E · NE / J&K" },
  ]);
  const services = [...new Set(rows.map((r) => r.description))];
  return (
    <>
      <div className="card p0 tbl-wrap vs-pricetbl" style={{ borderRadius: 18 }}>
        <table className="tbl">
          <thead><tr><th scope="col">Service</th>{zones.value.map((z) => <th scope="col" key={z.code}>{z.label}</th>)}</tr></thead>
          <tbody>
            {services.map((svc) => {
              const [name, eta] = svc.split("|");
              return (
                <tr key={svc}>
                  <td className="b">{name}<div className="tiny muted">{eta}</div></td>
                  {zones.value.map((z) => {
                    const r = rows.find((x) => x.description === svc && x.zone === z.code);
                    return <td key={z.code}>{r ? <><b>{rupees(r.firstSlabPaise)}</b><div className="tiny muted">+{rupees(r.additionalSlabPaise)} / {r.additionalSlabGrams} g</div></> : "—"}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="tiny muted mt8">Indicative rates: first 500 g + every additional 500 g, before GST. The rate calculator shows the bookable final amount incl. GST for your route. COD charges and volumetric weight (L×B×H ÷ 5000) apply.</p>
    </>
  );
}
