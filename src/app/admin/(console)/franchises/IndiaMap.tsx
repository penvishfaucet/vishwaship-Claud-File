import { isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { INDIA_TILES, TILE_COLS, TILE_ROWS, computeCoverage, coverageLevel } from "@/lib/india-map";
import { STATUS_LABEL } from "@/lib/franchise";

const FILL = ["#eef1f6", "#fde7d6", "#f9c49a", "#f59a52", "#e8590c"];
const INK = ["#5b6475", "#7a3d10", "#6b2a00", "#ffffff", "#ffffff"];
const LEVEL_TEXT = ["No franchise", "Only some PINs", "Under a third of districts", "A third to two thirds", "Two thirds or more"];

/** Admin → Franchises → India map: which state / district belongs to which franchise. */
export async function IndiaMap({ selected }: { selected?: string }) {
  const db = await getDb();
  const [areas, frs] = await Promise.all([
    db.select().from(schema.franchiseAreas).where(isNull(schema.franchiseAreas.releasedAt)),
    db.select({ id: schema.franchises.id, code: schema.franchises.code, businessName: schema.franchises.businessName, status: schema.franchises.status }).from(schema.franchises),
  ]);
  const cov = computeCoverage(areas, frs);
  const byState = new Map(cov.map((s) => [s.state, s]));
  const sel = selected ? byState.get(selected) : undefined;
  const totals = {
    states: cov.filter((s) => s.heldDistricts || s.pins).length,
    held: cov.reduce((n, s) => n + s.heldDistricts, 0),
    districts: cov.reduce((n, s) => n + s.totalDistricts, 0),
    active: frs.filter((f) => f.status === "active").length,
  };
  const W = 64, G = 6;
  return (
    <>
      <div className="grid3 mb12" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <div className="card" style={{ padding: 12 }}><div className="tiny muted">States / UTs with a franchise</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totals.states} of {cov.length}</div></div>
        <div className="card" style={{ padding: 12 }}><div className="tiny muted">Districts given</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totals.held} of {totals.districts}</div></div>
        <div className="card" style={{ padding: 12 }}><div className="tiny muted">Active franchises</div><div style={{ fontSize: 20, fontWeight: 700 }}>{totals.active}</div></div>
      </div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card" style={{ padding: 16 }}>
          <svg viewBox={`0 0 ${TILE_COLS * (W + G)} ${TILE_ROWS * (W + G)}`} style={{ width: "100%", maxWidth: 620, display: "block", margin: "0 auto" }} role="img" aria-label="Tile map of India showing franchise coverage by state">
            {cov.map((s) => {
              const t = INDIA_TILES[s.state];
              if (!t) return null;
              const lvl = coverageLevel(s);
              const on = sel?.state === s.state;
              const x = t.c * (W + G), y = t.r * (W + G);
              const label = `${s.state}: ${s.heldDistricts} of ${s.totalDistricts} districts${s.pins ? `, ${s.pins} PINs` : ""}`;
              return (
                <a key={s.state} href={`/admin/franchises/?tab=map&state=${encodeURIComponent(s.state)}`} aria-label={label}>
                  <title>{label}</title>
                  <rect x={x} y={y} width={W} height={W} rx={8} fill={FILL[lvl]} stroke={on ? "#0b1f3a" : "#d5dbe5"} strokeWidth={on ? 3 : 1} />
                  <text x={x + W / 2} y={y + 28} textAnchor="middle" fontSize={16} fontWeight={700} fill={INK[lvl]}>{t.abbr}</text>
                  <text x={x + W / 2} y={y + 48} textAnchor="middle" fontSize={11} fill={INK[lvl]}>{s.heldDistricts}/{s.totalDistricts}</text>
                </a>
              );
            })}
          </svg>
          <ul className="row wrap" style={{ listStyle: "none", padding: 0, margin: "12px 0 0", gap: 12 }} aria-label="Legend">
            {FILL.map((f, i) => <li key={f} className="row tiny" style={{ gap: 6 }}><span aria-hidden style={{ width: 14, height: 14, borderRadius: 3, background: f, border: "1px solid #d5dbe5", display: "inline-block" }} />{LEVEL_TEXT[i]}</li>)}
          </ul>
          <p className="tiny muted" style={{ marginBottom: 0 }}>Each square is a state or UT, placed roughly where it is on the map. The number is districts given / districts listed. Click a state to see every district.</p>
        </div>

        <div className="card" style={{ padding: 16 }}>
          {!sel ? <p className="small muted" style={{ margin: 0 }}>Choose a state on the map.</p> : (
            <>
              <h3 style={{ fontSize: 15, marginTop: 0 }}>{sel.state}</h3>
              <p className="small" style={{ marginTop: 0 }}>{sel.heldDistricts} of {sel.totalDistricts} districts given{sel.pins ? ` · ${sel.pins} single PINs` : ""}</p>
              {sel.franchises.length > 0 && (
                <p className="small">Franchises here: {sel.franchises.map((f, i) => <span key={f.id}>{i ? ", " : ""}<a href={`/admin/franchises/${f.id}/`}>{f.businessName} ({f.code})</a>{f.status !== "active" && <span className="muted"> – {STATUS_LABEL[f.status]}</span>}</span>)}</p>
              )}
              <div className="tbl-wrap" style={{ maxHeight: 520, overflowY: "auto" }}><table className="tbl">
                <thead><tr><th>District</th><th>Franchise</th></tr></thead>
                <tbody>{sel.districts.map((d) => (
                  <tr key={d.name}>
                    <td className="small">{d.name}{!d.listed && <span className="tiny muted"> (typed)</span>}</td>
                    <td className="small">
                      {d.holder ? <a href={`/admin/franchises/${d.holder.id}/`}>{d.holder.businessName} ({d.holder.code})</a> : <span className="green">Free</span>}
                      {d.holder && d.holder.status !== "active" && <span className="tiny muted"> – {STATUS_LABEL[d.holder.status]}</span>}
                      {d.pins.length > 0 && <div className="tiny muted">PINs: {d.pins.map((p) => `${p.pincode} (${p.holder.code})`).join(", ")}</div>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
