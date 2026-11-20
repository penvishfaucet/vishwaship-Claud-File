import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { mobileJson, withCustomer } from "@/server/mobile/http";

/** Pickup addresses (create / edit / OTP use the existing /api/portal/warehouses endpoints). */
export async function GET() {
  return withCustomer(async (s) => {
    const db = await getDb();
    const rows = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, s.orgId), eq(schema.warehouses.active, true)))
      .orderBy(desc(schema.warehouses.isDefault), desc(schema.warehouses.createdAt));
    return mobileJson({ warehouses: rows.map((w) => ({ id: w.id, code: w.code, label: w.label, contactName: w.contactName, mobile: w.mobile, mobileVerified: !!w.mobileVerifiedAt, email: w.email, line1: w.line1, line2: w.line2, pincode: w.pincode, city: w.city, state: w.state, isDefault: w.isDefault })) });
  });
}
