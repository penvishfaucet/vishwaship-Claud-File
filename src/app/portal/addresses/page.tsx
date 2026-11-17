import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { Download, MapPin } from "lucide-react";
import { AddressForm } from "@/components/portal/AddressForm";
import { WarehouseTable } from "@/components/portal/WarehouseTable";
import { contentMap } from "@/server/content";
import { getDb, schema } from "@/server/db/client";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";

export default async function WarehousesPage({ searchParams }: { searchParams: Promise<{ add?: string; q?: string; code?: string; status?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "warehouses");
  const copy = await contentMap(["portal.warehouses.title", "portal.warehouses.empty", "portal.warehouses.help"]);
  const db = await getDb();
  let rows = await db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, ctx.org.id)).orderBy(desc(schema.warehouses.isDefault), desc(schema.warehouses.active), asc(schema.warehouses.createdAt));
  const total = rows.length;
  if (sp.q) rows = rows.filter((w) => w.label.toLowerCase().includes(sp.q!.toLowerCase()));
  if (sp.code) rows = rows.filter((w) => (w.code ?? w.id).toLowerCase().includes(sp.code!.toLowerCase()));
  if (sp.status === "active") rows = rows.filter((w) => w.active);
  if (sp.status === "inactive") rows = rows.filter((w) => !w.active);
  const syncs = await db.select().from(schema.warehouseProviderSync);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "add") as [string, string][]).toString();
  return (
    <>
      <div className="page-h">
        <h1><MapPin size={20} style={{ verticalAlign: -3 }} /> {copy["portal.warehouses.title"]}</h1>
        <div className="actions">
          <a className="btn btn-outline" href={`/api/portal/export/warehouses?${qs}`}><Download size={16} /> Download</a>
          <Link className="btn btn-orange" href="/portal/addresses/?add=1">+ Add New</Link>
        </div>
      </div>
      <p className="small muted">{copy["portal.warehouses.help"]}</p>
      {sp.add && <AddressForm />}
      <form className="row wrap mb12" style={{ gap: 8 }} role="search">
        <label className="sr-only" htmlFor="wq">Search by address title</label>
        <input id="wq" name="q" className="input" defaultValue={sp.q} placeholder="Search by address title" style={{ maxWidth: 240 }} />
        <label className="sr-only" htmlFor="wc">Search by ID</label>
        <input id="wc" name="code" className="input" defaultValue={sp.code} placeholder="Search by ID" style={{ maxWidth: 180 }} />
        <label className="sr-only" htmlFor="ws">Status</label>
        <select id="ws" name="status" className="select" defaultValue={sp.status ?? ""} style={{ maxWidth: 150 }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <button className="btn btn-navy">Apply</button>
        {(sp.q || sp.code || sp.status) && <Link className="btn btn-outline" href="/portal/addresses/">Clear</Link>}
      </form>
      {total === 0 && !sp.add
        ? <div className="card empty"><p className="muted">{copy["portal.warehouses.empty"]}</p><Link className="btn btn-orange btn-sm" href="/portal/addresses/?add=1">Add pickup address</Link></div>
        : <WarehouseTable rows={rows.map((w) => ({
            id: w.id, code: w.code ?? w.id.slice(-6), label: w.label, contactName: w.contactName, email: w.email, mobile: w.mobile,
            line1: w.line1, line2: w.line2, city: w.city, state: w.state, pincode: w.pincode, active: w.active, isDefault: w.isDefault,
            verified: !!w.mobileVerifiedAt, createdBy: w.createdBy, createdAt: w.createdAt.toISOString(),
            courierSync: syncs.filter((x) => x.warehouseId === w.id).map((x) => `${x.providerAccountId.replace("pa_", "")}: ${x.status}${x.lastError ? ` (${x.lastError})` : ""}`),
          }))} />}
    </>
  );
}
