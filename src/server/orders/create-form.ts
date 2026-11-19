import "server-only";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { CreateOrderForm, crossIssues } from "@/lib/order-form-schema";
import { getDb, schema } from "@/server/db/client";
import { PACKAGE_TYPES, ewayEnabled, invoiceTotals, toPaise, totalWeightKg } from "@/lib/order-form";
import { createOrder } from "./create";


/** Server-side totals (the saved order always uses these, never the browser's numbers). */
export function formTotals(v: z.infer<typeof CreateOrderForm>) {
  const t = invoiceTotals(v.products.map((p) => ({ qty: p.qty, unitPricePaise: toPaise(p.unitPriceRupees), discountPaise: toPaise(p.discountRupees), taxBps: Math.round(p.taxPct * 100) })));
  const eway = ewayEnabled(t.grandTotal);
  return { ...t, eway, weightKg: totalWeightKg(v.boxes) };
}

export type FormIssue = { path: string; message: string };

/** Validate, total, apply the E-Way Bill rule and save the order through the existing createOrder(). */
export async function createOrderFromForm(orgId: string, raw: unknown):
  Promise<{ ok: true; orderId: string; orderNumber: string } | { ok: false; status: number; message: string; issues?: FormIssue[]; duplicateOf?: string }> {
  const p = CreateOrderForm.safeParse(raw);
  const cross = crossIssues(raw);
  if (!p.success || cross.length) return { ok: false, status: 422, message: "Please correct the highlighted fields", issues: [...(p.success ? [] : p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))), ...cross] };
  const v = p.data;
  const t = formTotals(v);
  const pkg = PACKAGE_TYPES.find((x) => x.key === v.packageType)!;
  // E-Way Bill: only above ₹50,000; at or below the threshold any typed number is dropped.
  const eway = t.eway ? v.ewayBill : "";
  if (t.eway && eway && !/^\d{12}$/.test(eway)) return { ok: false, status: 422, message: "Please correct the highlighted fields", issues: [{ path: "ewayBill", message: "E-Way Bill number must be 12 digits" }] };
  if (t.eway && pkg.mode === "B2B" && !eway) return { ok: false, status: 422, message: "Please correct the highlighted fields", issues: [{ path: "ewayBill", message: "E-Way Bill number is required above ₹50,000 for heavy shipments" }] };

  const r = await createOrder(orgId, {
    orderNumber: v.orderNumber, mode: pkg.mode, direction: "forward", paymentType: v.paymentType,
    codAmountRupees: v.paymentType === "cod" ? t.grandTotal / 100 : 0, declaredValueRupees: t.grandTotal / 100, saveAs: "ready", warehouseId: v.warehouseId,
    consignee: { name: v.buyer.name, mobile: v.buyer.mobile, email: v.buyer.email, line1: v.buyer.line1, line2: v.buyer.line2 || undefined, pincode: v.buyer.pincode, city: v.buyer.city, state: v.buyer.state },
    products: v.products.map((x) => ({ name: x.name, sku: x.sku || undefined, qty: x.qty, unitPriceRupees: x.unitPriceRupees, hsn: x.hsn || undefined })),
    packages: v.boxes.map((b) => ({ count: b.count, lengthCm: b.lengthCm, breadthCm: b.breadthCm, heightCm: b.heightCm, weightKg: b.weightKg })),
    invoiceNumber: v.invoiceNumber || undefined, ewayBill: eway || undefined, buyerGstin: v.buyer.gstin || undefined,
  });
  if (!r.ok) return { ok: false, status: 409, message: r.message, ...("duplicateOf" in r && r.duplicateOf ? { duplicateOf: r.duplicateOf } : {}) };
  const db = await getDb();
  await db.update(schema.orders).set({
    consignee: { name: v.buyer.name, mobile: v.buyer.mobile, altMobile: v.buyer.altMobile || undefined, email: v.buyer.email, line1: v.buyer.line1, line2: v.buyer.line2 || undefined, pincode: v.buyer.pincode, city: v.buyer.city, state: v.buyer.state },
    products: v.products.map((x, i) => ({ name: x.name, sku: x.sku || undefined, qty: x.qty, unitPrice: toPaise(x.unitPriceRupees), hsn: x.hsn || undefined, category: x.category || undefined, discount: toPaise(x.discountRupees) || undefined, taxBps: Math.round(x.taxPct * 100) || undefined, lineTotal: t.rows[i].total })),
    meta: {
      referenceId: v.referenceId || undefined, orderDate: v.orderDate, billingSame: v.billingSame, billing: v.billingSame ? undefined : v.billing,
      productsTotalPaise: t.products, grandTotalPaise: t.grandTotal, packageType: v.packageType, rovType: pkg.rov ? v.rovType ?? "owner" : undefined,
      totalWeightKg: t.weightKg, minChargeableKg: pkg.minChargeKg,
    },
  }).where(eq(schema.orders.id, r.orderId));
  return { ok: true, orderId: r.orderId, orderNumber: r.orderNumber };
}
