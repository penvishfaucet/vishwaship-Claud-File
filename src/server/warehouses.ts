import "server-only";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";

export const WarehouseInput = z.object({
  label: z.string().trim().min(2).max(60),
  contactName: z.string().trim().min(2).max(80),
  email: z.string().trim().email("Enter a valid email").max(120).optional().or(z.literal("")),
  mobile: z.string().transform((s) => s.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile")),
  line1: z.string().trim().min(5).max(200),
  line2: z.string().trim().max(200).optional(),
  pincode: z.string().regex(/^[1-9]\d{5}$/, "PIN code must be 6 digits"),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
});

/** Next short display code (W1001, W1002…), unique across the platform. */
export async function nextWarehouseCode() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.warehouses);
  return `W${1001 + Number(n)}`;
}

export async function getOwnWarehouse(orgId: string, id: string) {
  const db = await getDb();
  const [w] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.orgId, orgId)));
  return w ?? null;
}

/** Make exactly one default warehouse for the org. */
export async function setDefaultWarehouse(orgId: string, id: string) {
  const db = await getDb();
  await db.update(schema.warehouses).set({ isDefault: false }).where(eq(schema.warehouses.orgId, orgId));
  await db.update(schema.warehouses).set({ isDefault: true, updatedAt: new Date() }).where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.orgId, orgId)));
}

/** Frozen copy stored on each order so later edits/deactivation never change shipment history. */
export function pickupSnapshot(w: typeof schema.warehouses.$inferSelect) {
  return { warehouseId: w.id, code: w.code, label: w.label, contactName: w.contactName, mobile: w.mobile, email: w.email, line1: w.line1, line2: w.line2, pincode: w.pincode, city: w.city, state: w.state };
}
export type PickupSnapshot = ReturnType<typeof pickupSnapshot>;

/**
 * Is OTP verification of the pickup mobile required before booking? Admin → Warehouses switch
 * (pricing_settings "pickup_otp_required"). Off by default since 2026-11-18 at the owner's request; the
 * mobile stays marked "not verified" either way, it simply no longer blocks orders.
 */
export async function pickupOtpRequired(): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "pickup_otp_required"));
  return row ? row.value === true : false;
}

export async function setPickupOtpRequired(on: boolean) {
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: "pickup_otp_required", value: on })
    .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: on, updatedAt: new Date() } });
}
