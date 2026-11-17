import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { PreviewQuote } from "@/components/admin/PreviewQuote";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { setMarkup } from "@/server/pricing/rules";
import { loadMarkupSettings } from "@/server/quotes/service";

const PROVIDERS = [["shipmozo", "Shipmozo"], ["delhivery_b2c", "Delhivery B2C"], ["delhivery_b2b", "Delhivery B2B"], ["shiprocket", "Shiprocket"]] as const;

async function saveGlobal(fd: FormData) {
  "use server";
  const s = await requireStaff("pricing.write");
  const pct = Number(fd.get("pct"));
  if (!(pct >= 0 && pct <= 500)) redirect("/admin/pricing/?err=range");
  await setMarkup("shipmozo", null, Math.round(pct * 100), s.userId);
  revalidatePath("/admin/pricing/");
  redirect("/admin/pricing/?saved=1");
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ p?: string; q?: string; saved?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("pricing.read");
  const canWrite = can(s.role, "pricing.write");
  const provider = PROVIDERS.find(([k]) => k === sp.p)?.[0] ?? "shipmozo";
  const db = await getDb();
  const settings = await loadMarkupSettings("shipmozo");
  const orgs = await db.select().from(schema.orgs);
  const now = new Date();
  const list = orgs.filter((o) => !sp.q || o.businessName.toLowerCase().includes(sp.q.toLowerCase())).map((o) => {
    const ov = settings.overrides.filter((x) => x.orgId === o.id && !x.clearedAt && x.effectiveFrom <= now).sort((a, b) => b.version - a.version)[0];
    return { o, bps: ov?.bps ?? settings.global.bps, source: ov ? "Override" : "Global", since: ov?.effectiveFrom ?? null };
  });
  return (
    <>
      <div className="page-h"><h1>Pricing</h1></div>
      <nav className="tabs" aria-label="Providers">{PROVIDERS.map(([k, l]) => <Link key={k} href={`/admin/pricing/?p=${k}`} className={provider === k ? "on" : ""}>{l}</Link>)}</nav>
      {provider !== "shipmozo" ? (
        <div className="card empty"><p className="muted">This provider’s adapter isn’t connected yet. Rate cards (CSV/XLSX import with preview and effective dates) will appear here when it is.</p></div>
      ) : (
        <>
          <div className="split" style={{ gap: 16, alignItems: "start" }}>
            <section className="card" style={{ padding: 18 }}>
              <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Global Shipmozo markup</h2>
              <p className="small muted">Applied once to markup-eligible components of every Shipmozo quote (B2B and B2C) unless the customer has an override. Pass-through fees (COD fee, FOV) are not marked up; GST is charged once on the selling subtotal. Current version v{settings.global.version}.</p>
              <form action={saveGlobal} className="row wrap" style={{ gap: 8, alignItems: "end" }}>
                <div className="field"><label htmlFor="pct">Global markup (%)</label><input id="pct" name="pct" type="number" step="0.01" min="0" max="500" className="input" defaultValue={settings.global.bps / 100} disabled={!canWrite} style={{ maxWidth: 120 }} /></div>
                {canWrite && <button className="btn btn-orange">Save</button>}
              </form>
              {sp.saved && <p className="small t-credit mt8" role="status">Saved. New quotes use the new rule; existing valid quotes keep their original rule.</p>}
              {sp.err && <p className="small err mt8" role="alert">Enter a value between 0 and 500.</p>}
            </section>
            <PreviewQuote />
          </div>
          <section className="card p0 mt16">
            <div className="row between card-h">
              <h2 className="b small" style={{ margin: 0 }}>Customer overrides</h2>
              <form role="search"><input type="hidden" name="p" value="shipmozo" /><label htmlFor="cq" className="sr-only">Search customers</label><input id="cq" name="q" className="input" placeholder="Search customer" defaultValue={sp.q} /></form>
            </div>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Effective markup</th><th>Source</th><th>Effective date</th><th /></tr></thead>
              <tbody>{list.map(({ o, bps, source, since }) => (
                <tr key={o.id}><td>{o.businessName}</td><td className="b">{bps / 100}%</td><td><span className={`chip ${source === "Override" ? "c-active" : "c-draft"}`}>{source}</span></td><td className="small">{since ? since.toLocaleDateString("en-IN") : "—"}</td><td><Link className="btn btn-sm btn-outline" href={`/admin/customers/${o.id}/?tab=pricing`}>Edit</Link></td></tr>
              ))}</tbody></table></div>
          </section>
        </>
      )}
    </>
  );
}
