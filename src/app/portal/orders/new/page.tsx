import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { CreateShipment, type Library } from "@/components/portal/CreateShipment";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { getSetting } from "@/server/quotes/service";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ quick?: string; direction?: string; dest?: string; weight?: string; mode?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const warehouses = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
  const threshold = await getSetting<number>("b2b_threshold_grams", 10_000);
  const [buyers, products, presets, tags] = await Promise.all([
    db.select().from(schema.buyers).where(eq(schema.buyers.orgId, ctx.org.id)).orderBy(asc(schema.buyers.name)).limit(500),
    db.select().from(schema.products).where(and(eq(schema.products.orgId, ctx.org.id), eq(schema.products.active, true))).orderBy(asc(schema.products.name)).limit(500),
    db.select().from(schema.packagingPresets).where(eq(schema.packagingPresets.orgId, ctx.org.id)).orderBy(asc(schema.packagingPresets.name)),
    db.select().from(schema.orderTags).where(eq(schema.orderTags.orgId, ctx.org.id)).orderBy(asc(schema.orderTags.name)),
  ]);
  const library = {
    buyers: buyers.map((b) => ({ id: b.id, name: b.name, mobile: b.mobile, email: b.email ?? "", addresses: b.addresses as Library["buyers"][number]["addresses"] })),
    products: products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.unitPricePaise / 100, hsn: p.hsn ?? "", weightKg: p.weightGrams / 1000, l: p.lengthMm / 10, b: p.breadthMm / 10, h: p.heightMm / 10 })),
    presets: presets.map((p) => ({ id: p.id, name: p.name, l: p.lengthMm / 10, b: p.breadthMm / 10, h: p.heightMm / 10, tareKg: p.tareGrams / 1000, isDefault: p.isDefault })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{sp.direction === "reverse" ? "Create return" : sp.quick ? "Quick add" : "Create shipment"}</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Domestic shipments across India</p>
        </div>
        <Link className="btn btn-outline" href="/portal/orders/">Cancel</Link>
      </div>
      {warehouses.length === 0 ? (
        <div className="card empty"><p className="muted">Add a pickup address before creating a shipment.</p><Link className="btn btn-orange btn-sm" href="/portal/addresses/">Add Pickup Address</Link></div>
      ) : (
        <CreateShipment
          warehouses={warehouses.map((w) => ({ id: w.id, label: w.label, city: w.city, pincode: w.pincode, verified: !!w.mobileVerifiedAt, isDefault: w.isDefault }))}
          walletPaise={ctx.walletAvailable}
          b2bThresholdGrams={threshold.value}
          direction={sp.direction === "reverse" ? "reverse" : "forward"}
          initial={{ destination: sp.dest, weightKg: sp.weight, mode: sp.mode === "B2B" ? "B2B" : undefined }}
          library={library}
        />
      )}
    </>
  );
}
