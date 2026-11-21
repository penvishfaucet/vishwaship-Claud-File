import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import { pctOf } from "@/lib/money";
import { GLOBAL_MARKUP_KEY, pickMarkup } from "@/server/pricing/engine";
import { getSetting } from "@/server/quotes/service";
import { FranchiseError, getFranchise, type Franchise } from "./service";

/**
 * Franchise phase 3: pricing control and commission.
 *  - Admin sets, per franchise: base markup (Vishwaship's price to the franchise = courier cost + base), and the range
 *    (min..max) the franchise may charge its customers, plus a default for new customers.
 *  - The franchise sets each customer's markup in that range. It is stored as the customer's normal markup rule
 *    (markup_rules, provider "*"), so quotes and booking work exactly as before.
 *  - Commission per delivered shipment = cost × (customer markup − base markup), from the booking quote snapshot.
 *    Cancelled, RTO and undelivered shipments earn nothing. Non-KYC customers pay the non-KYC rate; the commission
 *    still uses the rate actually charged.
 *  - Monthly payouts: statement per franchise (gross − TDS ± adjustment), approved and marked paid with UTR by admin.
 */
type Db = Awaited<ReturnType<typeof getDb>>;
export const pctText = (bps: number | null | undefined) => (bps == null ? "—" : `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`);
const pctToBps = (v: number) => Math.round(v * 100);

/** IST calendar month of a time, e.g. "2026-11". */
export function periodOf(d: Date) {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7);
}
export const periodLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Commission on one shipment (never negative). */
export function commissionFor(eligiblePaise: number, customerBps: number, baseBps: number) {
  return Math.max(0, pctOf(eligiblePaise, customerBps) - pctOf(eligiblePaise, baseBps));
}

// ---------------- admin: commission settings ----------------
const pct = z.coerce.number().min(0, "Percent cannot be negative").max(200, "Percent too high (max 200%)");
export const CommissionInput = z.object({
  basePct: pct, minPct: pct, maxPct: pct, defaultPct: pct.optional().or(z.literal("")).transform((v) => (v === "" || v == null ? null : v)),
  accountName: z.string().trim().max(80).optional().transform((v) => v || null),
  accountLast4: z.string().trim().optional().transform((v) => v || null).refine((v) => !v || /^\d{4}$/.test(v), "Enter only the last 4 digits of the account"),
  ifsc: z.string().trim().toUpperCase().optional().transform((v) => v || null).refine((v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "IFSC looks wrong (e.g. HDFC0001234)"),
}).superRefine((v, ctx) => {
  if (v.minPct < v.basePct) ctx.addIssue({ code: "custom", message: "Customer minimum must be at least the base markup (so commission is never negative)" });
  if (v.maxPct < v.minPct) ctx.addIssue({ code: "custom", message: "Customer maximum must be at least the minimum" });
  if (v.defaultPct != null && (v.defaultPct < v.minPct || v.defaultPct > v.maxPct)) ctx.addIssue({ code: "custom", message: "Default for new customers must be between the minimum and maximum" });
});

export async function saveCommissionSettings(actor: string, franchiseId: string, input: Record<string, unknown>) {
  const f = await getFranchise(franchiseId);
  if (!f) throw new FranchiseError("Franchise not found");
  if (f.status === "terminated") throw new FranchiseError("A terminated franchise cannot be changed");
  const p = CommissionInput.safeParse(input);
  if (!p.success) throw new FranchiseError(p.error.issues[0].message);
  const v = p.data;
  const db = await getDb();
  const next = {
    baseMarkupBps: pctToBps(v.basePct), minCustomerBps: pctToBps(v.minPct), maxCustomerBps: pctToBps(v.maxPct), defaultCustomerBps: v.defaultPct == null ? null : pctToBps(v.defaultPct),
    payoutAccountName: v.accountName, payoutAccountLast4: v.accountLast4, payoutIfsc: v.ifsc,
  };
  await db.update(schema.franchises).set({ ...next, commissionFrom: f.commissionFrom ?? new Date(), updatedAt: new Date() }).where(eq(schema.franchises.id, f.id));
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.commission_settings", targetType: "franchise", targetId: f.id,
    details: { baseBps: next.baseMarkupBps, minBps: next.minCustomerBps, maxBps: next.maxCustomerBps, defaultBps: next.defaultCustomerBps, bank: !!(v.accountLast4 && v.ifsc) } });
}

// ---------------- customer prices (markup rules) ----------------
async function activeOverride(db: Db, orgId: string) {
  const [r] = await db.select().from(schema.markupRules)
    .where(and(eq(schema.markupRules.provider, GLOBAL_MARKUP_KEY), eq(schema.markupRules.orgId, orgId), isNull(schema.markupRules.clearedAt)))
    .orderBy(desc(schema.markupRules.effectiveFrom), desc(schema.markupRules.version)).limit(1);
  return r ?? null;
}

/** Versioned like the admin pricing page: clear the active row, insert the next version (saved quotes keep theirs). */
async function writeOverride(db: Db, orgId: string, bps: number | null, actorUserId: string) {
  const [last] = await db.select({ v: sql<number>`coalesce(max(${schema.markupRules.version}), 0)::int` }).from(schema.markupRules)
    .where(and(eq(schema.markupRules.provider, GLOBAL_MARKUP_KEY), eq(schema.markupRules.orgId, orgId)));
  await db.update(schema.markupRules).set({ clearedAt: new Date() })
    .where(and(eq(schema.markupRules.provider, GLOBAL_MARKUP_KEY), eq(schema.markupRules.orgId, orgId), isNull(schema.markupRules.clearedAt)));
  if (bps == null) return null;
  const id = newId("mk");
  await db.insert(schema.markupRules).values({ id, provider: GLOBAL_MARKUP_KEY, orgId, bps, version: (last?.v ?? 0) + 1, effectiveFrom: new Date(), createdBy: actorUserId });
  return id;
}

/** Vishwaship's standard customer markup (what a customer without its own rate pays on most services). */
export async function standardBps() {
  const db = await getDb();
  const rows = await db.select().from(schema.markupRules).where(and(eq(schema.markupRules.provider, GLOBAL_MARKUP_KEY), isNull(schema.markupRules.orgId)));
  return pickMarkup(rows.map((r) => ({ ...r, bps: r.bps })), "-", "B2C", null).bps;
}

export async function customerPrices(franchiseId: string) {
  const db = await getDb();
  const orgs = await db.select({ id: schema.orgs.id, name: schema.orgs.businessName, kyc: schema.orgs.kycStatus }).from(schema.orgs).where(eq(schema.orgs.franchiseId, franchiseId)).orderBy(asc(schema.orgs.businessName));
  if (!orgs.length) return [];
  const rules = await db.select().from(schema.markupRules)
    .where(and(eq(schema.markupRules.provider, GLOBAL_MARKUP_KEY), inArray(schema.markupRules.orgId, orgs.map((o) => o.id)), isNull(schema.markupRules.clearedAt)));
  return orgs.map((o) => {
    const r = rules.filter((x) => x.orgId === o.id).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    return { orgId: o.id, name: o.name, kycApproved: o.kyc === "approved", bps: r?.bps ?? null, setAt: r?.effectiveFrom ?? null };
  });
}

/** Franchise sets one customer's markup (percent) within the admin's range. null = back to Vishwaship's standard rate. */
export async function setCustomerPrice(franchiseUserId: string, f: Franchise, orgId: string, percent: number | null) {
  if (f.status !== "active") throw new FranchiseError("Prices can be changed only while your franchise is active");
  if (f.baseMarkupBps == null || f.minCustomerBps == null || f.maxCustomerBps == null) throw new FranchiseError("Vishwaship has not set up your commission yet");
  const db = await getDb();
  const [o] = await db.select({ id: schema.orgs.id }).from(schema.orgs).where(and(eq(schema.orgs.id, orgId), eq(schema.orgs.franchiseId, f.id)));
  if (!o) throw new FranchiseError("Customer not found");
  let bps: number | null = null;
  if (percent != null) {
    if (!Number.isFinite(percent)) throw new FranchiseError("Enter a percent");
    bps = pctToBps(percent);
    if (bps < f.minCustomerBps || bps > f.maxCustomerBps) throw new FranchiseError(`Choose between ${pctText(f.minCustomerBps)} and ${pctText(f.maxCustomerBps)}`);
  }
  const before = await activeOverride(db, orgId);
  await writeOverride(db, orgId, bps, franchiseUserId);
  await audit({ actorUserId: franchiseUserId, actorKind: "franchise", orgId, action: "franchise.customer_price", targetType: "franchise", targetId: f.id, details: { fromBps: before?.bps ?? null, toBps: bps } });
}

/** When a customer joins a franchise: apply the franchise's default price if the customer has no own rate yet. */
export async function applyDefaultPrice(orgId: string, franchiseId: string) {
  try {
    const f = await getFranchise(franchiseId);
    if (!f || f.defaultCustomerBps == null) return;
    const db = await getDb();
    if (await activeOverride(db, orgId)) return;
    await writeOverride(db, orgId, f.defaultCustomerBps, `franchise:${f.id}`);
    await audit({ actorKind: "system", orgId, action: "franchise.customer_price_default", targetType: "franchise", targetId: f.id, details: { toBps: f.defaultCustomerBps } });
  } catch (e) {
    console.error("[franchise] default price", (e as Error).message);
  }
}

// ---------------- accrual ----------------
/**
 * Create commission lines for delivered shipments that do not have one yet. Counts only shipments booked after the
 * customer joined the franchise and after commission was set up. Idempotent (one line per shipment).
 */
export async function accrueCommissions(franchiseId?: string) {
  const db = await getDb();
  const rows = await db.select({
    shipmentId: schema.shipments.id, orgId: schema.shipments.orgId, deliveredAt: schema.shipments.deliveredAt, createdAt: schema.shipments.createdAt, quoteId: schema.shipments.quoteId,
    franchiseId: schema.franchises.id, baseBps: schema.franchises.baseMarkupBps, from: schema.franchises.commissionFrom, linkedAt: schema.orgs.franchiseLinkedAt,
  }).from(schema.shipments)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .innerJoin(schema.franchises, eq(schema.franchises.id, schema.orgs.franchiseId))
    .leftJoin(schema.franchiseCommissions, eq(schema.franchiseCommissions.shipmentId, schema.shipments.id))
    .where(and(
      franchiseId ? eq(schema.franchises.id, franchiseId) : undefined,
      inArray(schema.franchises.status, ["active", "suspended"]),
      sql`${schema.franchises.baseMarkupBps} is not null`,
      eq(schema.shipments.status, "delivered"),
      sql`${schema.shipments.bookingStatus} <> 'cancelled'`,
      sql`${schema.shipments.deliveredAt} is not null`,
      isNull(schema.franchiseCommissions.id),
      sql`${schema.shipments.createdAt} >= ${schema.franchises.commissionFrom}`,
      sql`${schema.shipments.createdAt} >= coalesce(${schema.orgs.franchiseLinkedAt}, ${schema.orgs.createdAt})`,
    )).limit(2000);
  if (!rows.length) return 0;
  const quotes = await db.select({ id: schema.quotes.id, priced: schema.quotes.priced }).from(schema.quotes).where(inArray(schema.quotes.id, [...new Set(rows.map((r) => r.quoteId))]));
  let n = 0;
  for (const r of rows) {
    const q = quotes.find((x) => x.id === r.quoteId)?.priced as { eligibleCostPreTax?: number; markup?: { bps?: number } } | undefined;
    const eligible = Number(q?.eligibleCostPreTax ?? NaN), customerBps = Number(q?.markup?.bps ?? NaN);
    if (!Number.isSafeInteger(eligible) || !Number.isSafeInteger(customerBps)) continue;
    const res = await db.insert(schema.franchiseCommissions).values({
      id: newId("frc"), franchiseId: r.franchiseId, orgId: r.orgId, shipmentId: r.shipmentId, eligiblePaise: eligible, customerBps, baseBps: r.baseBps!,
      amountPaise: commissionFor(eligible, customerBps, r.baseBps!), deliveredAt: r.deliveredAt!, period: periodOf(r.deliveredAt!),
    }).onConflictDoNothing().returning({ id: schema.franchiseCommissions.id });
    n += res.length;
  }
  return n;
}

export async function voidCommission(actor: string, commissionId: string, reason: string) {
  if (reason.trim().length < 5) throw new FranchiseError("Write the reason (at least 5 characters)");
  const db = await getDb();
  const res = await db.update(schema.franchiseCommissions).set({ status: "void", voidReason: reason.trim().slice(0, 300) })
    .where(and(eq(schema.franchiseCommissions.id, commissionId), eq(schema.franchiseCommissions.status, "earned"))).returning();
  if (!res.length) throw new FranchiseError("Only commission that is not in a payout can be removed");
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.commission_void", targetType: "franchise", targetId: res[0].franchiseId, details: { shipmentId: res[0].shipmentId, amountPaise: res[0].amountPaise, reason } });
}

export async function commissionLines(franchiseId: string, opts: { period?: string; payoutId?: string; limit?: number } = {}) {
  const db = await getDb();
  return db.select({ c: schema.franchiseCommissions, business: schema.orgs.businessName, awb: schema.shipments.awb, orderNumber: schema.orders.orderNumber })
    .from(schema.franchiseCommissions)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.franchiseCommissions.orgId))
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.franchiseCommissions.shipmentId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(eq(schema.franchiseCommissions.franchiseId, franchiseId), opts.period ? eq(schema.franchiseCommissions.period, opts.period) : undefined, opts.payoutId ? eq(schema.franchiseCommissions.payoutId, opts.payoutId) : undefined))
    .orderBy(desc(schema.franchiseCommissions.deliveredAt)).limit(Math.min(opts.limit ?? 200, 2000));
}

/** Totals per month and status for one franchise. */
export async function commissionByPeriod(franchiseId: string) {
  const db = await getDb();
  const rows = await db.select({ period: schema.franchiseCommissions.period, status: schema.franchiseCommissions.status, n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${schema.franchiseCommissions.amountPaise}),0)::bigint` })
    .from(schema.franchiseCommissions).where(eq(schema.franchiseCommissions.franchiseId, franchiseId)).groupBy(schema.franchiseCommissions.period, schema.franchiseCommissions.status);
  const out = new Map<string, { period: string; shipments: number; earnedPaise: number; unpaidPaise: number; paidPaise: number }>();
  for (const r of rows) {
    if (r.status === "void") continue;
    const o = out.get(r.period) ?? { period: r.period, shipments: 0, earnedPaise: 0, unpaidPaise: 0, paidPaise: 0 };
    o.shipments += r.n; o.earnedPaise += Number(r.sum);
    if (r.status === "paid") o.paidPaise += Number(r.sum); else o.unpaidPaise += Number(r.sum);
    out.set(r.period, o);
  }
  return [...out.values()].sort((a, b) => b.period.localeCompare(a.period));
}

// ---------------- payouts ----------------
export type PayoutConfig = { tdsBps: number };
export const PAYOUT_DEFAULTS: PayoutConfig = { tdsBps: 200 };
export async function payoutConfig(): Promise<PayoutConfig & { version: number }> {
  const s = await getSetting<Partial<PayoutConfig>>("franchise_payout", PAYOUT_DEFAULTS);
  return { ...PAYOUT_DEFAULTS, ...s.value, version: s.version };
}
export async function savePayoutConfig(actor: string, tdsPct: number) {
  if (!Number.isFinite(tdsPct) || tdsPct < 0 || tdsPct > 30) throw new FranchiseError("TDS must be between 0% and 30%");
  const db = await getDb();
  const value = { tdsBps: pctToBps(tdsPct) };
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "franchise_payout"));
  if (row) await db.update(schema.pricingSettings).set({ value, version: row.version + 1, updatedAt: new Date() }).where(eq(schema.pricingSettings.key, "franchise_payout"));
  else await db.insert(schema.pricingSettings).values({ key: "franchise_payout", value });
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.payout_settings", details: value });
}

/** The month just finished (IST), the newest one payouts can be made for. */
export function lastClosedPeriod(now = new Date()) {
  const [y, m] = periodOf(now).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Make draft statements for a closed month: each franchise's unpaid commission delivered in that month or earlier
 * (late lines roll into the next statement). One live statement per franchise per month.
 */
export async function generatePayouts(actor: string, period: string, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new FranchiseError("Choose a month");
  if (period >= periodOf(now)) throw new FranchiseError("Payouts can be made only for a month that has ended");
  await accrueCommissions();
  const db = await getDb();
  const cfg = await payoutConfig();
  const due = await db.select({ franchiseId: schema.franchiseCommissions.franchiseId, n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${schema.franchiseCommissions.amountPaise}),0)::bigint` })
    .from(schema.franchiseCommissions).where(and(eq(schema.franchiseCommissions.status, "earned"), lte(schema.franchiseCommissions.period, period)))
    .groupBy(schema.franchiseCommissions.franchiseId);
  const made: string[] = [];
  for (const d of due) {
    const gross = Number(d.sum);
    if (gross <= 0) continue;
    const id = newId("frp");
    const tds = pctOf(gross, cfg.tdsBps);
    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.franchisePayouts).values({
          id, franchiseId: d.franchiseId, period, statementNumber: `VFP-${period.replace("-", "")}-${id.slice(-6).toUpperCase()}`, shipments: 0,
          grossPaise: 0, tdsBps: cfg.tdsBps, tdsPaise: 0, netPaise: 0, createdBy: actor,
        });
        const lines = await tx.update(schema.franchiseCommissions).set({ status: "in_payout", payoutId: id })
          .where(and(eq(schema.franchiseCommissions.franchiseId, d.franchiseId), eq(schema.franchiseCommissions.status, "earned"), lte(schema.franchiseCommissions.period, period)))
          .returning({ amount: schema.franchiseCommissions.amountPaise });
        const g = lines.reduce((s, l) => s + l.amount, 0), t = pctOf(g, cfg.tdsBps);
        await tx.update(schema.franchisePayouts).set({ shipments: lines.length, grossPaise: g, tdsPaise: t, netPaise: g - t }).where(eq(schema.franchisePayouts.id, id));
      });
      made.push(id);
      await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.payout_created", targetType: "franchise", targetId: d.franchiseId, details: { period, grossPaise: gross, tdsPaise: tds } });
    } catch (e) {
      if (!/unique|duplicate/i.test(String((e as Error).message) + String((e as { cause?: { message?: string } }).cause?.message ?? ""))) throw e;
      // a statement for this month already exists: its lines stay earned and roll into the next month's statement
    }
  }
  return made.length;
}

async function payout(id: string) {
  const db = await getDb();
  const [p] = await db.select().from(schema.franchisePayouts).where(eq(schema.franchisePayouts.id, id));
  if (!p) throw new FranchiseError("Statement not found");
  return p;
}

export async function adjustPayout(actor: string, id: string, adjustmentRupees: number, note: string) {
  const p = await payout(id);
  if (p.status !== "draft") throw new FranchiseError("Only a draft statement can be adjusted");
  if (!Number.isFinite(adjustmentRupees) || Math.abs(adjustmentRupees) > 10_000_000) throw new FranchiseError("Enter the adjustment in rupees (minus for a deduction)");
  const adj = Math.round(adjustmentRupees * 100);
  if (adj !== 0 && note.trim().length < 5) throw new FranchiseError("Write what the adjustment is for");
  const net = p.grossPaise - p.tdsPaise + adj;
  if (net < 0) throw new FranchiseError("The statement cannot go below zero");
  const db = await getDb();
  await db.update(schema.franchisePayouts).set({ adjustmentPaise: adj, adjustmentNote: adj ? note.trim().slice(0, 300) : null, netPaise: net, updatedAt: new Date() }).where(eq(schema.franchisePayouts.id, id));
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.payout_adjusted", targetType: "franchise", targetId: p.franchiseId, details: { statement: p.statementNumber, adjustmentPaise: adj } });
}

export async function approvePayout(actor: string, id: string) {
  const p = await payout(id);
  if (p.status !== "draft") throw new FranchiseError("Only a draft statement can be approved");
  const f = await getFranchise(p.franchiseId);
  if (!f) throw new FranchiseError("Franchise not found");
  if (f.status === "suspended") throw new FranchiseError("Commission is on hold while the franchise is suspended (Terms 7.3)");
  if (!f.payoutAccountLast4 || !f.payoutIfsc) throw new FranchiseError("Add the franchise's payout bank details (last 4 digits and IFSC) first");
  const db = await getDb();
  await db.update(schema.franchisePayouts).set({ status: "approved", approvedBy: actor, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.franchisePayouts.id, id), eq(schema.franchisePayouts.status, "draft")));
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.payout_approved", targetType: "franchise", targetId: p.franchiseId, details: { statement: p.statementNumber, netPaise: p.netPaise } });
}

export async function markPayoutPaid(actor: string, id: string, utrIn: string, paidOn: string) {
  const p = await payout(id);
  if (p.status !== "approved") throw new FranchiseError("Approve the statement before marking it paid");
  const utr = utrIn.trim();
  if (!/^[A-Za-z0-9]{6,30}$/.test(utr)) throw new FranchiseError("Enter the bank UTR / transaction reference");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new FranchiseError("Enter the payment date");
  const at = new Date(`${paidOn}T00:00:00+05:30`);
  if (at.getTime() > Date.now() + 86400_000) throw new FranchiseError("Payment date cannot be in the future");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(schema.franchisePayouts).set({ status: "paid", utr, paidOn: at, paidBy: actor, updatedAt: new Date() }).where(eq(schema.franchisePayouts.id, id));
    await tx.update(schema.franchiseCommissions).set({ status: "paid" }).where(eq(schema.franchiseCommissions.payoutId, id));
  });
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.payout_paid", targetType: "franchise", targetId: p.franchiseId, details: { statement: p.statementNumber, netPaise: p.netPaise, utr } });
}

/** Cancel a statement that is not paid; its lines go back to unpaid and join the next statement. */
export async function cancelPayout(actor: string, id: string, reason: string) {
  const p = await payout(id);
  if (p.status === "paid" || p.status === "cancelled") throw new FranchiseError("A paid or cancelled statement cannot be cancelled");
  if (reason.trim().length < 5) throw new FranchiseError("Write the reason (at least 5 characters)");
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(schema.franchisePayouts).set({ status: "cancelled", note: reason.trim().slice(0, 300), updatedAt: new Date() }).where(eq(schema.franchisePayouts.id, id));
    await tx.update(schema.franchiseCommissions).set({ status: "earned", payoutId: null }).where(eq(schema.franchiseCommissions.payoutId, id));
  });
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.payout_cancelled", targetType: "franchise", targetId: p.franchiseId, details: { statement: p.statementNumber, reason } });
}

export async function payoutsList(opts: { franchiseId?: string; period?: string } = {}) {
  const db = await getDb();
  return db.select({ p: schema.franchisePayouts, code: schema.franchises.code, name: schema.franchises.businessName, last4: schema.franchises.payoutAccountLast4, ifsc: schema.franchises.payoutIfsc, fstatus: schema.franchises.status })
    .from(schema.franchisePayouts).innerJoin(schema.franchises, eq(schema.franchises.id, schema.franchisePayouts.franchiseId))
    .where(and(opts.franchiseId ? eq(schema.franchisePayouts.franchiseId, opts.franchiseId) : undefined, opts.period ? eq(schema.franchisePayouts.period, opts.period) : undefined))
    .orderBy(desc(schema.franchisePayouts.period), desc(schema.franchisePayouts.createdAt)).limit(500);
}

/** Unpaid commission not yet in a statement, per franchise (for the admin payouts tab). */
export async function unpaidByFranchise(upToPeriod?: string) {
  const db = await getDb();
  return db.select({ franchiseId: schema.franchiseCommissions.franchiseId, n: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${schema.franchiseCommissions.amountPaise}),0)::bigint` })
    .from(schema.franchiseCommissions).where(and(eq(schema.franchiseCommissions.status, "earned"), upToPeriod ? lte(schema.franchiseCommissions.period, upToPeriod) : undefined))
    .groupBy(schema.franchiseCommissions.franchiseId);
}

