import "@/styles/create-order.css";
import { and, asc, desc, eq } from "drizzle-orm";
import { CreateOrderForm } from "@/components/portal/CreateOrderForm";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

export const metadata = { title: "Create Order — Vishwaship" };

/** Create Order (Orders → Create Order, Dashboard → Add Order). International shipping is not offered yet, so it shows disabled. */
export default async function CreateOrderPage() {
  const ctx = await portalContext();
  const db = await getDb();
  const [whs, prods] = await Promise.all([
    db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true))).orderBy(desc(schema.warehouses.isDefault), asc(schema.warehouses.label)),
    db.select({ name: schema.products.name, sku: schema.products.sku, unitPricePaise: schema.products.unitPricePaise, hsn: schema.products.hsn }).from(schema.products)
      .where(and(eq(schema.products.orgId, ctx.org.id), eq(schema.products.active, true))).orderBy(asc(schema.products.name)).limit(500),
  ]);
  return (
    <CreateOrderForm
      internationalEnabled={false}
      products={prods}
      warehouses={whs.map((w) => ({ id: w.id, label: w.label, code: w.code, line1: w.line1, line2: w.line2, city: w.city, state: w.state, pincode: w.pincode, contactName: w.contactName, mobile: w.mobile, isDefault: w.isDefault }))}
    />
  );
}
