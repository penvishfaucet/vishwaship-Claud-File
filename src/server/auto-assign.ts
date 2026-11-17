import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { courierPrefs } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { getQuotes, type QuoteOffer } from "@/server/quotes/service";

export const RuleConditions = z.object({
  mode: z.enum(["B2C", "B2B"]).optional(),
  payment: z.enum(["prepaid", "cod"]).optional(),
  warehouseId: z.string().max(60).optional(),
  pinPrefixes: z.array(z.string().regex(/^\d{1,6}$/)).max(50).default([]),
  minGrams: z.number().int().min(0).max(5_000_000).optional(),
  maxGrams: z.number().int().min(1).max(5_000_000).optional(),
});
export const RuleInput = z.object({
  name: z.string().trim().min(2).max(60),
  priority: z.number().int().min(1).max(999).default(100),
  active: z.boolean().default(true),
  conditions: RuleConditions,
  couriers: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).min(1, "Pick at least one courier").max(10),
});
export type Rule = typeof schema.assignRules.$inferSelect;

interface OrderFacts { mode: string; payment: string; warehouseId: string | null; pincode: string; grams: number }

export function ruleMatches(c: z.output<typeof RuleConditions>, f: OrderFacts): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (c.mode && c.mode !== f.mode) return { ok: false, why: [`type is ${f.mode}`] };
  if (c.mode) why.push(c.mode);
  if (c.payment && c.payment !== f.payment) return { ok: false, why: [`payment is ${f.payment}`] };
  if (c.payment) why.push(c.payment === "cod" ? "COD" : "prepaid");
  if (c.warehouseId && c.warehouseId !== f.warehouseId) return { ok: false, why: ["different warehouse"] };
  if (c.warehouseId) why.push("warehouse");
  if (c.pinPrefixes.length && !c.pinPrefixes.some((p) => f.pincode.startsWith(p))) return { ok: false, why: [`PIN ${f.pincode} not in list`] };
  if (c.pinPrefixes.length) why.push(`PIN ${f.pincode}`);
  if (c.minGrams != null && f.grams < c.minGrams) return { ok: false, why: ["below weight range"] };
  if (c.maxGrams != null && f.grams > c.maxGrams) return { ok: false, why: ["above weight range"] };
  if (c.minGrams != null || c.maxGrams != null) why.push(`${(f.grams / 1000).toFixed(2)} kg`);
  return { ok: true, why };
}

/** Pick the courier for an order: first matching active rule (by priority) with an eligible courier, else preference order, else cheapest. */
export function choose(offers: QuoteOffer[], rules: Rule[], prefs: string[], f: OrderFacts): { offer: QuoteOffer; reason: string; ruleId: string | null } | null {
  if (!offers.length) return null;
  const cheapestOf = (code: string) => offers.filter((o) => o.carrierCode === code).sort((a, b) => a.total - b.total)[0];
  const skipped: string[] = [];
  for (const r of rules.filter((x) => x.active).sort((a, b) => a.priority - b.priority)) {
    const m = ruleMatches(RuleConditions.parse(r.conditions), f);
    if (!m.ok) continue;
    for (const code of r.couriers as string[]) {
      const o = cheapestOf(code);
      if (o) return { offer: o, ruleId: r.id, reason: `Rule “${r.name}” (${m.why.join(", ") || "all orders"}) → ${o.carrierName}${skipped.length ? `; skipped ${skipped.join(", ")} (not serviceable)` : ""}` };
      skipped.push(code);
    }
  }
  for (const code of prefs) {
    const o = cheapestOf(code);
    if (o) return { offer: o, ruleId: null, reason: `${skipped.length ? `No rule courier serviceable (${skipped.join(", ")}); ` : "No rule matched; "}used your courier preference order → ${o.carrierName}` };
  }
  const o = [...offers].sort((a, b) => a.total - b.total)[0];
  return { offer: o, ruleId: null, reason: `${skipped.length ? `No rule courier serviceable (${skipped.join(", ")}); ` : "No rule matched; "}cheapest serviceable courier → ${o.carrierName}` };
}

export async function autoAssign(orgId: string, orderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.orgId, orgId)));
  if (!o) return { ok: false as const, message: "Order not found" };
  const [wh] = o.warehouseId ? await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, o.warehouseId)) : [];
  if (!wh) return { ok: false as const, message: "Order has no pickup address" };
  const pk = await db.select().from(schema.packages).where(eq(schema.packages.orderId, o.id));
  const c = o.consignee as { pincode: string };
  const { offers } = await getQuotes({
    mode: o.mode as "B2C" | "B2B", originPincode: wh.pincode, destinationPincode: c.pincode, paymentType: o.paymentType as "prepaid" | "cod",
    codAmount: o.codAmountPaise, declaredValue: o.declaredValuePaise, direction: o.direction as "forward" | "reverse",
    packages: pk.map((p) => ({ count: p.count, lengthMm: p.lengthMm, breadthMm: p.breadthMm, heightMm: p.heightMm, actualWeightGrams: p.actualWeightGrams })),
  }, orgId);
  const rules = await db.select().from(schema.assignRules).where(eq(schema.assignRules.orgId, orgId)).orderBy(asc(schema.assignRules.priority));
  const prefs = await courierPrefs(orgId);
  const grams = pk.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
  const pick = choose(offers, rules, prefs.priority, { mode: o.mode, payment: o.paymentType, warehouseId: o.warehouseId, pincode: c.pincode, grams });
  if (!pick) return { ok: false as const, message: "No courier is serviceable for this order" };
  return { ok: true as const, ...pick };
}
