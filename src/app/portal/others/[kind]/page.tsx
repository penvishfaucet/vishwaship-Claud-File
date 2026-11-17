import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { RecordManager } from "@/components/portal/RecordManager";
import { formatINR } from "@/lib/money";
import { OTHERS, type OthersKind } from "@/lib/others";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

type Addr = { label: string; line1: string; line2?: string; pincode: string; city: string; state: string };
const cm = (mm: number) => +(mm / 10).toFixed(1);
const kg = (g: number) => +(g / 1000).toFixed(3);

export default async function OthersPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(kind in OTHERS)) notFound();
  const k = kind as OthersKind;
  const ctx = await portalContext();
  const db = await getDb();
  let rows: Array<{ id: string; form: Record<string, string | number | boolean>; cells: Record<string, string> }> = [];
  if (k === "customers") {
    const b = await db.select().from(schema.buyers).where(eq(schema.buyers.orgId, ctx.org.id)).orderBy(asc(schema.buyers.name));
    rows = b.map((x) => {
      const a = x.addresses as Addr[]; const d = a[0]; const o = a[1];
      return { id: x.id, form: { name: x.name, mobile: x.mobile, email: x.email ?? "", line1: d?.line1 ?? "", line2: d?.line2 ?? "", pincode: d?.pincode ?? "", city: d?.city ?? "", state: d?.state ?? "", altLine1: o?.line1 ?? "", altPincode: o?.pincode ?? "", altCity: o?.city ?? "", altState: o?.state ?? "", notes: x.notes ?? "" },
        cells: { name: x.name, mobile: x.mobile, email: x.email ?? "—", address: d ? `${d.line1}, ${d.city} ${d.pincode}` : "—", addresses: String(a.length) } };
    });
  } else if (k === "products") {
    const p = await db.select().from(schema.products).where(eq(schema.products.orgId, ctx.org.id)).orderBy(asc(schema.products.name));
    rows = p.map((x) => ({ id: x.id, form: { name: x.name, sku: x.sku, priceRupees: x.unitPricePaise / 100, hsn: x.hsn ?? "", weightKg: kg(x.weightGrams), lengthCm: cm(x.lengthMm), breadthCm: cm(x.breadthMm), heightCm: cm(x.heightMm), active: x.active },
      cells: { name: x.name, sku: x.sku, price: formatINR(x.unitPricePaise), hsn: x.hsn ?? "—", weight: x.weightGrams ? `${kg(x.weightGrams)} kg` : "—", dims: x.lengthMm ? `${cm(x.lengthMm)} × ${cm(x.breadthMm)} × ${cm(x.heightMm)} cm` : "—" } }));
  } else if (k === "packaging") {
    const p = await db.select().from(schema.packagingPresets).where(eq(schema.packagingPresets.orgId, ctx.org.id)).orderBy(asc(schema.packagingPresets.name));
    rows = p.map((x) => ({ id: x.id, form: { name: x.name, lengthCm: cm(x.lengthMm), breadthCm: cm(x.breadthMm), heightCm: cm(x.heightMm), tareKg: kg(x.tareGrams), isDefault: x.isDefault },
      cells: { name: x.name, dims: `${cm(x.lengthMm)} × ${cm(x.breadthMm)} × ${cm(x.heightMm)} cm`, tare: `${kg(x.tareGrams)} kg`, volumetric: `${((x.lengthMm * x.breadthMm * x.heightMm) / 1000 / 5000).toFixed(2)} kg`, isDefault: x.isDefault ? "Yes" : "" } }));
  } else {
    const t = await db.select({ t: schema.orderTags, n: sql<number>`(select count(*)::int from ${schema.orderTagLinks} where ${schema.orderTagLinks.tagId} = ${schema.orderTags.id})` }).from(schema.orderTags).where(eq(schema.orderTags.orgId, ctx.org.id)).orderBy(asc(schema.orderTags.name));
    rows = t.map(({ t: x, n }) => ({ id: x.id, form: { name: x.name, color: x.color }, cells: { name: x.name, orders: String(n) } }));
  }
  return (
    <>
      <div className="page-h"><div><h1>{OTHERS[k].title}</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{OTHERS[k].desc}</p></div></div>
      <RecordManager kind={k} rows={rows} />
    </>
  );
}
