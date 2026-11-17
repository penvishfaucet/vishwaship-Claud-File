import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { QueueExport } from "@/components/portal/QueueExport";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { CARRIERS } from "@/lib/site";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";
import { REPORTS, type ReportKey, SHIPMENT_COLUMNS, parseFilters, runReport } from "@/server/reports";

type SP = Record<string, string | undefined>;
type RawSP = Record<string, string | string[] | undefined>;
const PAGE = 50;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<RawSP> }) {
  const { type } = await params;
  if (!(type in REPORTS)) notFound();
  const key = type as ReportKey;
  const raw = await searchParams;
  // Custom report: ticked boxes arrive as repeated ?col=…; fold them into one ?columns=a,b,c value.
  const col = raw.col; const columns = Array.isArray(col) ? col.join(",") : col ?? (typeof raw.columns === "string" ? raw.columns : undefined);
  const sp: SP = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "col").map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  if (columns) sp.columns = columns;
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "reports");
  const f = parseFilters(sp);
  const tags = await (await getDb()).select({ id: schema.orderTags.id, name: schema.orderTags.name }).from(schema.orderTags).where(eq(schema.orderTags.orgId, ctx.org.id)).orderBy(asc(schema.orderTags.name));
  const r = await runReport(ctx.org.id, key, f);
  const page = Math.max(1, Number(sp.page ?? 1));
  const pages = Math.max(1, Math.ceil(r.total / PAGE));
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const qs = (patch: SP) => new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]).toString();
  const exportQs = qs({ page: undefined });
  return (
    <>
      <div className="page-h">
        <div><Link className="small link-navy" href="/portal/reports/">← Reports</Link><h1>{REPORTS[key].title}</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{REPORTS[key].desc}</p></div>
        <div className="actions">
          <a className="btn btn-outline" href={`/api/portal/reports/${key}/?${exportQs}&format=csv`}><Download size={16} /> CSV</a>
          <a className="btn btn-orange" href={`/api/portal/reports/${key}/?${exportQs}&format=xlsx`}><Download size={16} /> Excel</a>
          <QueueExport reportKey={key} filters={Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page")) as Record<string, string>} />
        </div>
      </div>
      <form className="card row wrap mb12" style={{ padding: 14, gap: 8, alignItems: "end" }}>
        <div className="field"><label htmlFor="rf">From (IST)</label><input id="rf" type="date" name="from" className="input" defaultValue={sp.from ?? monthAgo} max={today} /></div>
        <div className="field"><label htmlFor="rt">To (IST)</label><input id="rt" type="date" name="to" className="input" defaultValue={sp.to ?? today} max={today} /></div>
        <div className="field"><label htmlFor="rq">Search</label><input id="rq" name="q" className="input" defaultValue={sp.q} placeholder="Order, AWB, buyer, city, PIN" /></div>
        <div className="field"><label htmlFor="rp">Payment</label><select id="rp" name="payment" className="select" defaultValue={sp.payment ?? ""}><option value="">All</option><option value="prepaid">Prepaid</option><option value="cod">COD</option></select></div>
        <div className="field"><label htmlFor="rm">Type</label><select id="rm" name="mode" className="select" defaultValue={sp.mode ?? ""}><option value="">B2C + B2B</option><option>B2C</option><option>B2B</option></select></div>
        {!["orders", "ndr", "weight"].includes(key) && <div className="field"><label htmlFor="rc">Courier</label><select id="rc" name="carrier" className="select" defaultValue={sp.carrier ?? ""}><option value="">All couriers</option>{CARRIERS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>}
        {tags.length > 0 && <div className="field"><label htmlFor="rtg">Tag</label><select id="rtg" name="tag" className="select" defaultValue={sp.tag ?? ""}><option value="">All tags</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>}
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        {key === "custom" && (
          <fieldset style={{ border: 0, padding: 0, flexBasis: "100%" }}>
            <legend className="small b">Columns</legend>
            <div className="row wrap" style={{ gap: 10 }}>
              {SHIPMENT_COLUMNS.map((c) => <label key={c.key} className="check small"><input type="checkbox" name="col" value={c.key} defaultChecked={(f.columns ?? ["booked_at", "order", "awb", "carrier", "status"]).includes(c.key)} /> {c.label}</label>)}
            </div>
            <p className="tiny muted">Ticked columns are applied when you click Apply.</p>
          </fieldset>
        )}
        <button className="btn btn-navy">Apply</button>
        <Link className="btn btn-outline" href={`/portal/reports/${key}/`}>Reset</Link>
      </form>
      <nav className="pills mb12" aria-label="Status">
        <Link className={!sp.status ? "pill on" : "pill"} href={`?${qs({ status: undefined, page: undefined })}`}>All</Link>
        {r.counts.map((c) => <Link key={c.key} className={sp.status === c.key ? "pill on" : "pill"} href={`?${qs({ status: c.key, page: undefined })}`}>{c.label} {c.count}</Link>)}
      </nav>
      <p className="small muted">{r.total} record{r.total === 1 ? "" : "s"} · {r.from.toLocaleDateString("en-IN")} – {r.to.toLocaleDateString("en-IN")}</p>
      {r.total === 0 ? <div className="card empty"><p className="muted">No records for these filters.</p></div> : (
        <div className="card p0 tbl-wrap">
          <table className="tbl"><thead><tr>{r.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{r.rows.slice((page - 1) * PAGE, page * PAGE).map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className="small">{String(v ?? "")}</td>)}</tr>)}</tbody></table>
        </div>
      )}
      {pages > 1 && <nav className="row between mt12"><span className="small muted">Page {page} of {pages}</span><span className="row" style={{ gap: 8 }}>{page > 1 && <Link className="btn btn-sm btn-outline" href={`?${qs({ page: String(page - 1) })}`}>Previous</Link>}{page < pages && <Link className="btn btn-sm btn-outline" href={`?${qs({ page: String(page + 1) })}`}>Next</Link>}</span></nav>}
    </>
  );
}
