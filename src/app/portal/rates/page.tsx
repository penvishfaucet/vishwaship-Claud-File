import { and, eq } from "drizzle-orm";
import { PortalRates } from "@/components/portal/PortalRates";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

export default async function RatesPage() {
  const ctx = await portalContext();
  const db = await getDb();
  const wh = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
  return (
    <>
      <div className="page-h"><div><h1>Rate Calculator</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Your account’s rates, including GST. Quotes are valid for 30 minutes.</p></div></div>
      <PortalRates presets={wh.map((w) => ({ label: `${w.label} (${w.pincode})`, pincode: w.pincode }))} />
    </>
  );
}
