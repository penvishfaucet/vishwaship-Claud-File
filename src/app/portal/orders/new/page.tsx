import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { CreateShipment } from "@/components/portal/CreateShipment";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { getSetting } from "@/server/quotes/service";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ quick?: string; direction?: string; dest?: string; weight?: string; mode?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const warehouses = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
  const threshold = await getSetting<number>("b2b_threshold_grams", 10_000);
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
        />
      )}
    </>
  );
}
