import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PreviewQuote } from "@/components/admin/PreviewQuote";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { GLOBAL_MARKUP_KEY, pickMarkup, serviceMarkupKey } from "@/server/pricing/engine";
import { clearProviderDefault, setMarkup } from "@/server/pricing/rules";
import { CARRIER_SPECS } from "@/server/carriers/specs";
import { loadMarkupRows } from "@/server/quotes/service";

/** Provider + service pairs that can carry their own default (Delhivery Direct adapters are already one service each). */
const SERVICE_KEYS: Array<{ key: string; label: string }> = [
  ...["shipmozo", "shiporax", "ekart", "tci", "bluedart"].flatMap((a) => CARRIER_SPECS[a].services.map((m) => ({ key: serviceMarkupKey(a, m), label: `${CARRIER_SPECS[a].name} ${m}` }))),
  { key: "delhivery_b2c", label: "Delhivery Direct B2C" }, { key: "delhivery_b2b", label: "Delhivery Direct B2B" },
];

async function saveGlobal(fd: FormData) {
  "use server";
  const s = await requireStaff("pricing.write");
  const pct = Number(fd.get("pct"));
  if (!(pct >= 0 && pct <= 500)) redirect("/admin/pricing/?err=range");
  await setMarkup(GLOBAL_MARKUP_KEY, null, Math.round(pct * 100), s.userId);
  revalidatePath("/admin/pricing/");
  redirect("/admin/pricing/?saved=global");
}

async function saveDefault(fd: FormData) {
  "use server";
  const s = await requireStaff("pricing.write");
  const key = String(fd.get("key"));
  if (!SERVICE_KEYS.some((k) => k.key === key)) redirect("/admin/pricing/?err=key");
  if (fd.get("clear") === "1") { await clearProviderDefault(key, s.userId); redirect("/admin/pricing/?saved=cleared"); }
  const raw = String(fd.get("pct") ?? "").trim();
  const pct = Number(raw);
  if (raw === "" || !(pct >= 0 && pct <= 500)) redirect("/admin/pricing/?err=range");
  await setMarkup(key, null, Math.round(pct * 100), s.userId);
  revalidatePath("/admin/pricing/");
  redirect("/admin/pricing/?saved=default");
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ q?: string; saved?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("pricing.read");
  const canWrite = can(s.role, "pricing.write");
  const db = await getDb();
  const rows = await loadMarkupRows();
  const now = new Date();
  const global = pickMarkup(rows.filter((r) => r.provider === GLOBAL_MARKUP_KEY), "-", "B2C", null, now);
  const activeDefault = (key: string) => rows.filter((r) => r.provider === key && r.orgId === null && !r.clearedAt).sort((a, b) => b.version - a.version)[0];
  const orgs = await db.select({ id: schema.orgs.id, businessName: schema.orgs.businessName }).from(schema.orgs);
  const list = orgs.filter((o) => !sp.q || o.businessName.toLowerCase().includes(sp.q.toLowerCase())).map((o) => {
    const ov = rows.filter((x) => x.orgId === o.id && x.provider === GLOBAL_MARKUP_KEY && !x.clearedAt && x.effectiveFrom <= now).sort((a, b) => b.version - a.version)[0];
    return { o, ov };
  }).sort((a, b) => Number(!!b.ov) - Number(!!a.ov));
  return (
    <>
      <div className="page-h"><div><h1>Pricing</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Customer price = verified provider rate × (1 + markup ÷ 100), rounded to the paisa. One markup per quote, chosen in this order: <b>customer</b> → <b>provider / service default</b> → <b>global default</b>.</p></div></div>
      {sp.saved && <p className="note small" role="status">Saved. New quotes use it immediately; booked shipments keep the price they were confirmed at.</p>}
      {sp.err && <p className="small err" role="alert">{sp.err === "range" ? "Enter a percentage between 0 and 500." : "Unknown provider."}</p>}
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>3 · Global default</h2>
          <p className="small muted">Used for every provider and service without its own default, and for customers without a custom percentage. {global.ruleVersion ? `Version ${global.ruleVersion}.` : "Initial default."}</p>
          <form action={saveGlobal} className="row wrap" style={{ gap: 8, alignItems: "end" }}>
            <div className="field"><label htmlFor="pct">Global markup (%)</label><input id="pct" name="pct" type="number" step="0.01" min="0" max="500" className="input" defaultValue={global.bps / 100} disabled={!canWrite} style={{ maxWidth: 120 }} /></div>
            {canWrite && <button className="btn btn-orange">Save</button>}
          </form>
          <p className="tiny muted mt8">Example: provider rate ₹1,000 → ₹{(1000 * (1 + global.bps / 10000)).toLocaleString("en-IN", { minimumFractionDigits: 2 })} before GST.</p>
        </section>
        <PreviewQuote />
      </div>

      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>2 · Provider and service defaults (optional)</h2>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Provider / service</th><th>Default</th><th>Effective now</th><th>{canWrite ? "Set (%)" : ""}</th></tr></thead>
          <tbody>{SERVICE_KEYS.map(({ key, label }) => {
            const d = activeDefault(key);
            return (
              <tr key={key}>
                <td className="small b">{label} <span className="tiny muted mono">{key}</span></td>
                <td>{d ? <span className="chip c-active">{d.bps / 100}%</span> : <span className="chip c-draft">Uses global</span>}</td>
                <td className="small">{(d ? d.bps : global.bps) / 100}%</td>
                <td>{canWrite && (
                  <form action={saveDefault} className="row" style={{ gap: 6 }}>
                    <input type="hidden" name="key" value={key} />
                    <label className="sr-only" htmlFor={`d-${key}`}>{label} markup</label>
                    <input id={`d-${key}`} name="pct" type="number" step="0.01" min="0" max="500" className="input" defaultValue={d ? d.bps / 100 : ""} placeholder={`${global.bps / 100}`} style={{ maxWidth: 90 }} />
                    <button className="btn btn-sm btn-outline">Save</button>
                    {d && <button className="btn btn-sm btn-outline" name="clear" value="1">Use global</button>}
                  </form>
                )}</td>
              </tr>
            );
          })}</tbody></table></div>
      </section>

      <section className="card p0 mt16">
        <div className="row between card-h">
          <h2 className="b small" style={{ margin: 0 }}>1 · Customer-specific markup</h2>
          <form role="search"><label htmlFor="cq" className="sr-only">Search customers</label><input id="cq" name="q" className="input" placeholder="Search customer" defaultValue={sp.q} /></form>
        </div>
        <p className="tiny muted" style={{ padding: "0 16px" }}>A saved percentage (including 0%) beats every provider and global default for that customer. Edit it from the customer’s Pricing tab.</p>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Markup</th><th>Since</th><th /></tr></thead>
          <tbody>{list.slice(0, 200).map(({ o, ov }) => (
            <tr key={o.id}><td>{o.businessName}</td><td>{ov ? <span className="chip c-active">{ov.bps / 100}% (custom)</span> : <span className="chip c-draft">Provider / global default</span>}</td><td className="small">{ov ? ov.effectiveFrom.toLocaleDateString("en-IN") : "—"}</td><td><Link className="btn btn-sm btn-outline" href={`/admin/customers/${o.id}/?tab=pricing`}>Edit</Link></td></tr>
          ))}</tbody></table></div>
      </section>
    </>
  );
}
