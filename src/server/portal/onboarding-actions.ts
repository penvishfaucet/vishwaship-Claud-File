"use server";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { enqueue } from "@/server/jobs/runner";
import { newId } from "@/server/util/ids";
import { nextWarehouseCode } from "@/server/warehouses";

export type ProfileState = { error?: string; field?: string } | undefined;

const addr = /^[\w\s.,\-/#]*$/;
const Profile = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  mobile: z.string().transform((s) => s.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number")),
  business: z.string().trim().min(2, "Enter your business or brand name").max(120),
  gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN format is invalid").optional().default(""),
  volume: z.string().max(20).optional().default(""),
  line1: z.string().trim().min(3, "Enter the address").max(200).regex(addr, "Only these special characters are allowed: . , - / #"),
  line2: z.string().trim().max(200).regex(addr, "Only these special characters are allowed: . , - / #").optional().default(""),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code"),
  city: z.string().trim().min(2, "City is required").max(60),
  state: z.string().trim().min(2, "State is required").max(60),
});

/** Complete Your Profile → saved on the account, then the existing KYC flow. */
export async function saveProfile(_: ProfileState, fd: FormData): Promise<ProfileState> {
  const ctx = await portalContext();
  const p = Profile.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message, field: String(p.error.issues[0].path[0] ?? "") };
  const v = p.data;
  const db = await getDb();
  const [clash] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.mobile, v.mobile), ne(schema.users.id, ctx.session.userId)));
  if (clash) return { error: "This mobile number is already used by another Vishwaship account", field: "mobile" };
  await db.update(schema.users).set({ name: v.name, mobile: v.mobile }).where(eq(schema.users.id, ctx.session.userId));
  await db.update(schema.orgs).set({
    name: v.business, businessName: v.business, gstin: v.gstin || null, expectedMonthlyVolume: v.volume || null,
    address: { line1: v.line1, line2: v.line2, city: v.city, state: v.state, pincode: v.pincode }, profileCompletedAt: new Date(),
  }).where(eq(schema.orgs.id, ctx.org.id));
  await audit({ actorUserId: ctx.session.userId, actorKind: ctx.session.impersonatorId ? "staff" : "customer", orgId: ctx.org.id, action: "profile.completed" });
  // No pickup address yet → this address becomes the default pickup address (registered with the couriers like any other).
  const [wh] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true))).limit(1);
  if (!wh) {
    const id = newId("wh");
    await db.insert(schema.warehouses).values({ id, orgId: ctx.org.id, label: "Primary pickup", contactName: v.name, mobile: v.mobile, line1: v.line1, line2: v.line2 || null, pincode: v.pincode, city: v.city, state: v.state,
      email: ctx.session.email || null, isDefault: true, code: await nextWarehouseCode(), createdBy: v.name });
    await audit({ actorUserId: ctx.session.userId, actorKind: ctx.session.impersonatorId ? "staff" : "customer", orgId: ctx.org.id, action: "warehouse.create", targetType: "warehouse", targetId: id, details: { from: "profile" } });
    await enqueue("warehouse.sync", { warehouseId: id }, { dedupeKey: `warehouse.sync:${id}:0` });
  }
  redirect(ctx.org.kycStatus === "approved" ? "/portal/" : "/portal/kyc/");
}
