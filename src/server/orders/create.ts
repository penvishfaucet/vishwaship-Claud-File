import "server-only";
import { FOD_RULE_TEXT, chargeableKg, collectsCod, fodAllowed } from "@/lib/payment";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { rupeesToPaise } from "@/lib/money";
import { newId } from "@/server/util/ids";
import { pickupSnapshot } from "@/server/warehouses";

const pin = z.string().regex(/^[1-9]\d{5}$/, "PIN code must be 6 digits");
const mobile = z.string().transform((s) => s.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile"));

export const OrderInput = z.object({
  orderNumber: z.string().trim().min(1).max(40).regex(/^[\w\-/#]+$/, "Order ID can use letters, numbers, - / #").optional(),
  mode: z.enum(["B2C", "B2B"]),
  direction: z.enum(["forward", "reverse"]).default("forward"),
  paymentType: z.enum(["prepaid", "cod", "fod"]),
  codAmountRupees: z.number().min(0).max(5_00_000).default(0),
  declaredValueRupees: z.number().min(0).max(50_00_000),
  /** "draft" = Drafts tab, not offered to couriers yet; "ready" = New tab, waiting for courier assignment. */
  saveAs: z.enum(["draft", "ready"]).optional(),
  warehouseId: z.string().min(1),
  consignee: z.object({
    name: z.string().trim().min(2).max(80), mobile, email: z.string().email().optional().or(z.literal("")),
    line1: z.string().trim().min(1, "Please enter Address line 1").min(3, "Address line 1 is too short").max(200), line2: z.string().trim().max(200).optional(),
    pincode: pin, city: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60),
  }),
  products: z.array(z.object({ name: z.string().trim().min(1).max(120), sku: z.string().max(60).optional(), qty: z.number().int().min(1).max(10_000), unitPriceRupees: z.number().min(0), hsn: z.string().max(10).optional() })).min(1).max(100),
  packages: z.array(z.object({ count: z.number().int().min(1).max(500), lengthCm: z.number().positive().max(500), breadthCm: z.number().positive().max(500), heightCm: z.number().positive().max(500), weightKg: z.number().positive().max(5000) })).min(1).max(50),
  invoiceNumber: z.string().max(40).optional(),
  ewayBill: z.string().regex(/^$|^\d{12}$/, "E-way bill must be 12 digits").optional(),
  buyerGstin: z.string().max(15).optional(),
}).superRefine((v, ctx) => {
  if (v.saveAs !== "draft" && !(v.declaredValueRupees > 0)) ctx.addIssue({ code: "custom", path: ["declaredValueRupees"], message: "Enter the declared (invoice) value" });
  if (v.paymentType === "cod" && v.codAmountRupees <= 0) ctx.addIssue({ code: "custom", path: ["codAmountRupees"], message: "COD amount is required" });
  if (v.paymentType === "fod" && v.mode !== "B2B") ctx.addIssue({ code: "custom", path: ["paymentType"], message: "FOD is only for B2B orders" });
  if (v.paymentType === "fod" && v.saveAs !== "draft" && !fodAllowed(chargeableKg(v.packages))) ctx.addIssue({ code: "custom", path: ["paymentType"], message: `FOD is ${FOD_RULE_TEXT.toLowerCase()}` });
  if (v.declaredValueRupees > 50_000 && v.mode === "B2B" && !v.ewayBill) ctx.addIssue({ code: "custom", path: ["ewayBill"], message: "E-way bill is required for consignments above ₹50,000" });
});

export async function createOrder(orgId: string, input: z.infer<typeof OrderInput>, source: "manual" | "bulk" | "api" | "shopify" | "woocommerce" | "custom" | "online_store" = "manual", external?: { storeId: string; orderId: string }) {
  const db = await getDb();
  const [wh] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, input.warehouseId), eq(schema.warehouses.orgId, orgId)));
  if (!wh) return { ok: false as const, message: "Pickup address not found" };
  if (!wh.active) return { ok: false as const, message: "This pickup address is deactivated. Choose an active one." };
  const id = newId("ord");
  const orderNumber = input.orderNumber ?? `VS${Date.now().toString(36).toUpperCase()}`;
  const dup = await db.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.orgId, orgId), eq(schema.orders.orderNumber, orderNumber)));
  if (dup.length) return { ok: false as const, message: `Order ID ${orderNumber} already exists`, duplicateOf: dup[0].id };

  // COD confirmation hold applies to every source (manual, bulk, store, API) when subscribed.
  const codOn = await (await import("@/server/whatsapp/service")).codConfirmationOn(orgId);
  const codHold = input.saveAs !== "draft" && collectsCod(input.paymentType, rupeesToPaise(input.codAmountRupees)) && input.direction === "forward" && codOn;

  await db.insert(schema.orders).values({
    id, orgId, orderNumber, source, externalStoreId: external?.storeId, externalOrderId: external?.orderId,
    status: input.saveAs === "draft" ? "draft" : codHold ? "cod_hold" : "ready", mode: input.mode, direction: input.direction, paymentType: input.paymentType,
    codAmountPaise: collectsCod(input.paymentType, rupeesToPaise(input.codAmountRupees)) ? rupeesToPaise(input.codAmountRupees) : 0,
    declaredValuePaise: rupeesToPaise(input.declaredValueRupees), warehouseId: wh.id, pickupSnapshot: pickupSnapshot(wh), consignee: input.consignee,
    products: input.products.map((p) => ({ name: p.name, sku: p.sku, qty: p.qty, unitPrice: rupeesToPaise(p.unitPriceRupees), hsn: p.hsn })),
    invoiceNumber: input.invoiceNumber, ewayBill: input.ewayBill || null, buyerGstin: input.buyerGstin || null,
  });
  for (const p of input.packages) {
    await db.insert(schema.packages).values({ id: newId("pkg"), orderId: id, count: p.count, lengthMm: Math.round(p.lengthCm * 10), breadthMm: Math.round(p.breadthCm * 10), heightMm: Math.round(p.heightCm * 10), actualWeightGrams: Math.round(p.weightKg * 1000) });
  }
  if (codHold) await startCodHold(orgId, id);
  return { ok: true as const, orderId: id, orderNumber, codHold, origin: wh.pincode };
}

/** WhatsApp COD confirmation hold (reminder + expiry + send job). */
async function startCodHold(orgId: string, id: string) {
  const db = await getDb();
  const [cfgRow] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "cod_confirmation"));
  const cfg = (cfgRow?.value as { reminderMinutes?: number; expiryMinutes?: number } | undefined) ?? {};
  await db.insert(schema.codConfirmations).values({
    id: newId("cod"), orgId, orderId: id, status: "pending",
    reminderAt: new Date(Date.now() + (cfg.reminderMinutes ?? 120) * 60_000), expiresAt: new Date(Date.now() + (cfg.expiryMinutes ?? 1440) * 60_000),
  }).onConflictDoNothing();
  await db.insert(schema.jobs).values({ id: newId("job"), queue: "cod.send", payload: { orderId: id }, dedupeKey: `cod.send:${id}` }).onConflictDoNothing();
}

/**
 * Edit a draft or an unbooked order (Create Shipment → Save / Save as Draft / Save & Assign Courier).
 * Only orders without a live shipment can change; the pickup snapshot and packages are replaced.
 */
export async function updateOrder(orgId: string, orderId: string, input: z.infer<typeof OrderInput>) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.orgId, orgId)));
  if (!o) return { ok: false as const, message: "Order not found" };
  if (!["draft", "ready", "booking_failed"].includes(o.status)) return { ok: false as const, message: "This order can no longer be edited" };
  const [wh] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, input.warehouseId), eq(schema.warehouses.orgId, orgId)));
  if (!wh || !wh.active) return { ok: false as const, message: "Choose an active pickup address" };
  const orderNumber = input.orderNumber ?? o.orderNumber;
  if (orderNumber !== o.orderNumber) {
    const dup = await db.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.orgId, orgId), eq(schema.orders.orderNumber, orderNumber)));
    if (dup.length) return { ok: false as const, message: `Order ID ${orderNumber} already exists` };
  }
  const codOn = await (await import("@/server/whatsapp/service")).codConfirmationOn(orgId);
  const codHold = input.saveAs !== "draft" && collectsCod(input.paymentType, rupeesToPaise(input.codAmountRupees)) && input.direction === "forward" && codOn;
  await db.update(schema.orders).set({
    orderNumber, mode: input.mode, direction: input.direction, paymentType: input.paymentType,
    status: input.saveAs === "draft" ? "draft" : codHold ? "cod_hold" : "ready",
    codAmountPaise: collectsCod(input.paymentType, rupeesToPaise(input.codAmountRupees)) ? rupeesToPaise(input.codAmountRupees) : 0,
    declaredValuePaise: rupeesToPaise(input.declaredValueRupees), warehouseId: wh.id, pickupSnapshot: pickupSnapshot(wh), consignee: input.consignee,
    products: input.products.map((p) => ({ name: p.name, sku: p.sku, qty: p.qty, unitPrice: rupeesToPaise(p.unitPriceRupees), hsn: p.hsn })),
    invoiceNumber: input.invoiceNumber, ewayBill: input.ewayBill || null, buyerGstin: input.buyerGstin || null,
  }).where(eq(schema.orders.id, o.id));
  await db.delete(schema.packages).where(eq(schema.packages.orderId, o.id));
  for (const p of input.packages) {
    await db.insert(schema.packages).values({ id: newId("pkg"), orderId: o.id, count: p.count, lengthMm: Math.round(p.lengthCm * 10), breadthMm: Math.round(p.breadthCm * 10), heightMm: Math.round(p.heightCm * 10), actualWeightGrams: Math.round(p.weightKg * 1000) });
  }
  if (codHold) await startCodHold(orgId, o.id);
  return { ok: true as const, orderId: o.id, orderNumber, codHold, origin: wh.pincode };
}
