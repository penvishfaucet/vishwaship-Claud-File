import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { dbLedgerStore } from "@/server/ledger/db-store";
import { InsufficientBalanceError, credit, debit } from "@/server/ledger/wallet";
import { getSetting } from "@/server/quotes/service";
import { newId } from "@/server/util/ids";
import { planState } from "@/lib/store-plan";
import { rupees } from "@/lib/store-themes";
export { planState, type PlanState } from "@/lib/store-plan";
import { StoreError } from "./catalog";
import { marketing } from "./marketing";
import { metaConnection } from "./meta-connect";
import { storeForOrg } from "./service";

/**
 * Phase 4 billing for the Online Store:
 *  - 15-day free trial, then a plan bought from the shipping wallet. When neither is running the store stays visible
 *    but new orders are paused ("will reopen soon"); orders already placed keep shipping.
 *  - Managed Meta Ads: onboarding checklist, terms the merchant accepts, a refundable security deposit held from the
 *    wallet (own ledger entry + receipt), and campaign changes where anything that can raise spend needs the
 *    merchant's explicit approval. Ads run in the merchant's own Meta ad account, so Meta bills the merchant directly.
 */

type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Store = typeof schema.stores.$inferSelect;
export type Actor = { userId: string; kind: "customer" | "staff" };

// ---------------- admin configuration ----------------
export type BillingConfig = {
  trialDays: number;
  depositPaise: number;
  /** Terms for Managed Meta Ads (deposit, refund and spend rules). Changing the text bumps the version. */
  terms: string;
  termsVersion: number;
  /** Working days within which an approved refund is paid back to the wallet (shown to merchants). */
  refundDays: number;
  /** Theme keys merchants cannot pick (a store already using one keeps it). */
  disabledThemes: string[];
};
export const DEFAULT_TERMS = [
  "1. Vishwaship staff plan and run ads in your own Meta ad account. Meta charges ad spend to the payment method in your ad account; Vishwaship never takes ad spend from your wallet.",
  "2. No campaign, budget increase or restart goes live without your approval in Online Store → Managed Meta Ads. Pauses and budget cuts can be made at once and are shown in the change history.",
  "3. A refundable security deposit is held from your Vishwaship wallet before the service starts. It is not a fee and is not spent on ads.",
  "4. You can end the service at any time and ask for the deposit back. Vishwaship may deduct unpaid Vishwaship service dues from it and will explain any deduction in writing.",
  "5. Ad results depend on Meta and are not guaranteed.",
].join("\n");
export const BILLING_DEFAULTS: BillingConfig = { trialDays: 15, depositPaise: 500_000, terms: DEFAULT_TERMS, termsVersion: 1, refundDays: 7, disabledThemes: [] };
const CONFIG_KEY = "store_billing";

export async function billingConfig(): Promise<BillingConfig> {
  return { ...BILLING_DEFAULTS, ...(await getSetting<Partial<BillingConfig>>(CONFIG_KEY, BILLING_DEFAULTS)).value };
}

export const BillingConfigInput = z.object({
  trialDays: z.coerce.number().int().min(0).max(90),
  depositRupees: z.coerce.number().int().min(0).max(1_000_000),
  terms: z.string().trim().min(20, "Terms are too short").max(8000),
  refundDays: z.coerce.number().int().min(1).max(60),
  disabledThemes: z.array(z.string().max(40)).max(20),
});

export async function saveBillingConfig(staffId: string, input: z.infer<typeof BillingConfigInput>) {
  const cur = await billingConfig();
  const next: BillingConfig = {
    trialDays: input.trialDays, depositPaise: input.depositRupees * 100, terms: input.terms, refundDays: input.refundDays, disabledThemes: input.disabledThemes,
    termsVersion: input.terms.replace(/\r\n/g, "\n") === cur.terms.replace(/\r\n/g, "\n") ? cur.termsVersion : cur.termsVersion + 1,
  };
  const db = await getDb();
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, CONFIG_KEY));
  if (row) await db.update(schema.pricingSettings).set({ value: next, version: row.version + 1, updatedAt: new Date() }).where(eq(schema.pricingSettings.key, CONFIG_KEY));
  else await db.insert(schema.pricingSettings).values({ key: CONFIG_KEY, value: next });
  await audit({ actorUserId: staffId, actorKind: "staff", action: "store.billing_config", targetType: "setting", targetId: CONFIG_KEY,
    details: { trialDays: next.trialDays, depositPaise: next.depositPaise, refundDays: next.refundDays, termsVersion: next.termsVersion, termsChanged: next.termsVersion !== cur.termsVersion, disabledThemes: next.disabledThemes } });
  return next;
}

// ---------------- plans & trial ----------------
export const trialEndFor = async (from = new Date()) => new Date(from.getTime() + (await billingConfig()).trialDays * 86400_000);

export async function listPlans(activeOnly = true) {
  const db = await getDb();
  return db.select().from(schema.storePlans).where(activeOnly ? eq(schema.storePlans.active, true) : undefined).orderBy(asc(schema.storePlans.sort), asc(schema.storePlans.pricePaise));
}

export const PlanInput = z.object({
  id: z.string().max(60).optional(),
  name: z.string().trim().min(2).max(60),
  interval: z.enum(["month", "year"]),
  priceRupees: z.coerce.number().min(1).max(1_000_000),
  active: z.boolean(),
  sort: z.coerce.number().int().min(0).max(100).default(0),
});

export async function savePlan(staffId: string, p: z.infer<typeof PlanInput>) {
  const db = await getDb();
  const v = { name: p.name, interval: p.interval, pricePaise: Math.round(p.priceRupees * 100), active: p.active, sort: p.sort, updatedAt: new Date() };
  let id = p.id;
  if (id) {
    const r = await db.update(schema.storePlans).set(v).where(eq(schema.storePlans.id, id)).returning({ id: schema.storePlans.id });
    if (!r.length) throw new StoreError("Plan not found");
  } else {
    id = newId("spl");
    await db.insert(schema.storePlans).values({ id, ...v });
  }
  await audit({ actorUserId: staffId, actorKind: "staff", action: p.id ? "store.plan_update" : "store.plan_create", targetType: "store_plan", targetId: id, details: { name: v.name, interval: v.interval, pricePaise: v.pricePaise, active: v.active } });
  return id;
}

/** Price includes GST: split into taxable value and GST for the receipt. */
export function gstSplit(totalPaise: number, gstBps: number) {
  const base = Math.round((totalPaise * 10_000) / (10_000 + gstBps));
  return { basePaise: base, gstPaise: totalPaise - base };
}

/** Plan price (before GST) + GST = what the wallet pays. */
export const planGross = (pricePaise: number, gstBps: number) => pricePaise + Math.round((pricePaise * gstBps) / 10_000);

export function addInterval(d: Date, interval: string) {
  const x = new Date(d);
  if (interval === "year") x.setUTCFullYear(x.getUTCFullYear() + 1);
  else x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
}

const receiptNo = (prefix: string, now = new Date()) =>
  `${prefix}-${now.toISOString().slice(2, 7).replace("-", "")}-${randomBytes(5).toString("hex").toUpperCase()}`;

async function walletFor(orgId: string, q: Db | Tx) {
  const [w] = await q.select().from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  if (!w) throw new StoreError("Wallet not found");
  return w;
}

const insufficient = (need: number) => new StoreError(`Not enough wallet balance. You need ${rupees(need)} available. Recharge your wallet and try again.`);

/**
 * Buy a plan from the wallet. Idempotent per (org, idem): a retried click never charges twice. The new period starts
 * after whatever is already running (remaining trial or paid days are kept).
 */
export async function buyPlan(orgId: string, actor: Actor, planId: string, idem: string, now = new Date()) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const db = await getDb();
  const [plan] = await db.select().from(schema.storePlans).where(and(eq(schema.storePlans.id, planId), eq(schema.storePlans.active, true)));
  if (!plan) throw new StoreError("This plan is not available");
  const key = `storeplan:${orgId}:${idem}`;
  const gstBps = (await getSetting<number>("gst_bps", 1800)).value;
  const wallet = await walletFor(orgId, db);
  const gross = planGross(plan.pricePaise, gstBps); // plan prices are before GST (owner 2026-11-23: Rs 2,499 + GST)
  try {
    const sub = await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(schema.storeSubscriptions).where(eq(schema.storeSubscriptions.idempotencyKey, key));
      if (prev) return { sub: prev, replayed: true };
      const [locked] = await tx.select().from(schema.stores).where(eq(schema.stores.id, s.id)).for("update");
      const start = new Date(Math.max(now.getTime(), locked.paidUntil?.getTime() ?? 0, locked.trialEndsAt?.getTime() ?? 0));
      const end = addInterval(start, plan.interval);
      const id = newId("ssub");
      const r = await debit(dbLedgerStore(tx), { walletId: wallet.id, amount: gross, kind: "store_plan", idempotencyKey: key, refType: "store_subscription", refId: id, memo: `Online Store ${plan.name} plan` });
      const [row] = await tx.insert(schema.storeSubscriptions).values({
        id, storeId: s.id, orgId, planId: plan.id, planName: plan.name, interval: plan.interval, amountPaise: gross, basePaise: plan.pricePaise, gstPaise: gross - plan.pricePaise,
        periodStart: start, periodEnd: end, receiptNumber: receiptNo("VSP", now), ledgerEntryId: r.entry.id, idempotencyKey: key, createdBy: actor.userId,
      }).returning();
      await tx.update(schema.stores).set({ paidUntil: end, planId: plan.id, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
      return { sub: row, replayed: false };
    });
    if (!sub.replayed) await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId, action: "store.plan_purchase", targetType: "store_subscription", targetId: sub.sub.id, details: { plan: plan.name, amountPaise: gross, until: sub.sub.periodEnd.toISOString() } });
    return sub;
  } catch (e) {
    if (e instanceof InsufficientBalanceError) throw insufficient(gross);
    throw e;
  }
}

export async function planHistory(storeId: string) {
  const db = await getDb();
  return db.select().from(schema.storeSubscriptions).where(eq(schema.storeSubscriptions.storeId, storeId)).orderBy(desc(schema.storeSubscriptions.createdAt)).limit(50);
}

/** Admin: give extra trial days (e.g. a merchant still setting up). Audited. */
export async function extendTrial(staffId: string, storeId: string, days: number, reason: string) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new StoreError("Days must be 1-90");
  if (reason.trim().length < 5) throw new StoreError("Enter a reason");
  const db = await getDb();
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!s) throw new StoreError("Store not found");
  const from = new Date(Math.max(Date.now(), s.trialEndsAt?.getTime() ?? 0));
  const until = new Date(from.getTime() + days * 86400_000);
  await db.update(schema.stores).set({ trialEndsAt: until, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  await audit({ actorUserId: staffId, actorKind: "staff", orgId: s.orgId, action: "store.trial_extend", targetType: "store", targetId: s.id, details: { days, until: until.toISOString(), reason: reason.trim().slice(0, 300) } });
  return until;
}

// ---------------- managed Meta Ads ----------------
export const MERCHANT_ITEMS = ["partner_added", "payment_method"] as const;
export const STAFF_ITEMS = ["partner_verified"] as const;
type ManualKey = (typeof MERCHANT_ITEMS)[number] | (typeof STAFF_ITEMS)[number];
type ChecklistStore = Partial<Record<ManualKey, { at: string; by: string }>>;
export type AdsCheckItem = { key: string; label: string; ok: boolean; who: "auto" | "merchant" | "staff"; hint: string; href?: string };

export async function managedAdsRow(storeId: string, q?: Db | Tx) {
  const db = q ?? (await getDb());
  const [m] = await db.select().from(schema.storeManagedAds).where(eq(schema.storeManagedAds.storeId, storeId));
  return m ?? null;
}

export async function activeDeposit(storeId: string, q?: Db | Tx) {
  const db = q ?? (await getDb());
  const [d] = await db.select().from(schema.storeDeposits).where(and(eq(schema.storeDeposits.storeId, storeId), inArray(schema.storeDeposits.status, ["held", "refund_requested"]))).orderBy(desc(schema.storeDeposits.createdAt));
  return d ?? null;
}

/** The onboarding checklist. Items about connected accounts are read live, never ticked by hand. */
export async function adsChecklist(s: Store): Promise<AdsCheckItem[]> {
  const [m, cfg, mk, conn, dep] = await Promise.all([managedAdsRow(s.id), billingConfig(), marketing(s.orgId), metaConnection(s.orgId), activeDeposit(s.id)]);
  const manual = (m?.checklist ?? {}) as ChecklistStore;
  const plan = planState(s);
  return [
    { key: "store_live", label: "Store is published", ok: s.status === "live", who: "auto", hint: "Publish your store from Store Overview.", href: "/portal/store/" },
    { key: "plan", label: "Store plan or trial is running", ok: plan.ordersOpen, who: "auto", hint: "Buy a plan in Store Plan.", href: "/portal/store/plan/" },
    { key: "pixel", label: "Meta Pixel connected", ok: mk.meta?.check?.state === "connected", who: "auto", hint: "Add your Pixel ID and access token in Meta & Google, then Save & check.", href: "/portal/store/marketing/" },
    { key: "ad_account", label: "Meta ad account connected", ok: !!conn?.verified?.adAccount, who: "auto", hint: "Connect with Facebook in Meta & Google and pick your ad account.", href: "/portal/store/marketing/" },
    { key: "partner_added", label: "Vishwaship added as a partner on your ad account", ok: !!manual.partner_added, who: "merchant", hint: "Meta Business Settings → Ad accounts → your account → Assign partners → share with Vishwaship's Business ID (your account manager will send it)." },
    { key: "partner_verified", label: "Vishwaship confirmed partner access", ok: !!manual.partner_verified, who: "staff", hint: "Your account manager confirms this after checking access." },
    { key: "payment_method", label: "Payment method added in your Meta ad account", ok: !!manual.payment_method, who: "merchant", hint: "Meta charges ad spend to this card/UPI, not your Vishwaship wallet." },
    { key: "terms", label: "Managed Ads terms accepted", ok: !!m?.termsAcceptedAt && m.termsVersion === cfg.termsVersion, who: "auto", hint: m?.termsAcceptedAt && m.termsVersion !== cfg.termsVersion ? "The terms changed. Please read and accept them again." : "Read and accept the terms below." },
    { key: "deposit", label: `Security deposit (${rupees(cfg.depositPaise)}) paid`, ok: dep?.status === "held", who: "auto", hint: "Paid from your wallet after accepting the terms." },
  ];
}

async function ensureAdsRow(s: Store, tx?: Tx) {
  const db = tx ?? (await getDb());
  const m = await managedAdsRow(s.id, db);
  if (m) return m;
  const [row] = await db.insert(schema.storeManagedAds).values({ id: newId("sma"), storeId: s.id, orgId: s.orgId }).onConflictDoNothing().returning();
  return row ?? (await managedAdsRow(s.id, db))!;
}

async function needStore(orgId: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  return s;
}

export async function acceptTerms(orgId: string, actor: Actor, version: number, monthlyCapRupees: number) {
  const s = await needStore(orgId);
  const cfg = await billingConfig();
  if (version !== cfg.termsVersion) throw new StoreError("The terms were just updated. Please read them again.");
  if (!Number.isFinite(monthlyCapRupees) || monthlyCapRupees < 1000 || monthlyCapRupees > 10_000_000) throw new StoreError("Monthly ad spend limit must be between ₹1,000 and ₹1,00,00,000");
  const m = await ensureAdsRow(s);
  const db = await getDb();
  await db.update(schema.storeManagedAds).set({ termsVersion: version, termsAcceptedAt: new Date(), termsAcceptedBy: actor.userId, monthlyCapPaise: Math.round(monthlyCapRupees) * 100, updatedAt: new Date() }).where(eq(schema.storeManagedAds.id, m.id));
  await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId, action: "store.ads_terms_accept", targetType: "store", targetId: s.id, details: { version, monthlyCapPaise: Math.round(monthlyCapRupees) * 100 } });
}

/** Merchant ticks their own checklist items; staff tick theirs. */
export async function setChecklistItem(orgId: string, actor: Actor, key: string, done: boolean) {
  const allowed: readonly string[] = actor.kind === "staff" ? [...MERCHANT_ITEMS, ...STAFF_ITEMS] : MERCHANT_ITEMS;
  if (!allowed.includes(key)) throw new StoreError("This item is checked automatically");
  const s = await needStore(orgId);
  const m = await ensureAdsRow(s);
  const list = { ...(m.checklist as ChecklistStore) };
  if (done) list[key as ManualKey] = { at: new Date().toISOString(), by: actor.userId };
  else delete list[key as ManualKey];
  const db = await getDb();
  await db.update(schema.storeManagedAds).set({ checklist: list, updatedAt: new Date() }).where(eq(schema.storeManagedAds.id, m.id));
  await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId, action: "store.ads_checklist", targetType: "store", targetId: s.id, details: { key, done } });
}

/** Hold the security deposit from the wallet. Needs the current terms accepted; one active deposit per store. */
export async function payDeposit(orgId: string, actor: Actor, idem: string) {
  const s = await needStore(orgId);
  const cfg = await billingConfig();
  if (cfg.depositPaise <= 0) throw new StoreError("No deposit is needed right now");
  const m = await managedAdsRow(s.id);
  if (!m?.termsAcceptedAt || m.termsVersion !== cfg.termsVersion) throw new StoreError("Accept the Managed Ads terms first");
  const key = `storedep:${orgId}:${idem}`;
  const db = await getDb();
  const wallet = await walletFor(orgId, db);
  try {
    const r = await db.transaction(async (tx) => {
      const [prev] = await tx.select().from(schema.storeDeposits).where(eq(schema.storeDeposits.idempotencyKey, key));
      if (prev) return { dep: prev, replayed: true };
      await tx.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.id, s.id)).for("update");
      if (await activeDeposit(s.id, tx)) throw new StoreError("A deposit is already held for this store");
      const id = newId("sdep");
      const e = await debit(dbLedgerStore(tx), { walletId: wallet.id, amount: cfg.depositPaise, kind: "store_deposit", idempotencyKey: key, refType: "store_deposit", refId: id, memo: "Managed Meta Ads security deposit (refundable)" });
      const [dep] = await tx.insert(schema.storeDeposits).values({
        id, storeId: s.id, orgId, amountPaise: cfg.depositPaise, status: "held", receiptNumber: receiptNo("VSD"), ledgerEntryId: e.entry.id, idempotencyKey: key, termsVersion: cfg.termsVersion, paidBy: actor.userId,
      }).returning();
      return { dep, replayed: false };
    });
    if (!r.replayed) await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId, action: "store.deposit_paid", targetType: "store_deposit", targetId: r.dep.id, details: { amountPaise: r.dep.amountPaise, receipt: r.dep.receiptNumber } });
    return r;
  } catch (e) {
    if (e instanceof InsufficientBalanceError) throw insufficient(cfg.depositPaise);
    throw e;
  }
}

/** Merchant asks for the deposit back. The service must not be running (end it first). */
export async function requestDepositRefund(orgId: string, actor: Actor, reason: string) {
  const s = await needStore(orgId);
  const dep = await activeDeposit(s.id);
  if (!dep || dep.status !== "held") throw new StoreError(dep ? "A refund is already requested" : "No deposit is held");
  const m = await managedAdsRow(s.id);
  if (m && m.status === "active") throw new StoreError("End Managed Meta Ads first, then ask for the deposit back");
  const db = await getDb();
  await db.update(schema.storeDeposits).set({ status: "refund_requested", refundRequestedAt: new Date(), refundReason: reason.trim().slice(0, 500) || null }).where(and(eq(schema.storeDeposits.id, dep.id), eq(schema.storeDeposits.status, "held")));
  await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId, action: "store.deposit_refund_request", targetType: "store_deposit", targetId: dep.id });
}

/**
 * Finance decides a refund request. Approve returns `refundPaise` (≤ deposit) to the wallet with its own ledger entry;
 * any deduction needs a written note the merchant sees. Reject puts the deposit back to held, also with a note.
 */
export async function decideDepositRefund(staffId: string, depositId: string, approve: boolean, refundPaise: number, note: string) {
  const db = await getDb();
  const [dep] = await db.select().from(schema.storeDeposits).where(eq(schema.storeDeposits.id, depositId));
  if (!dep) throw new StoreError("Deposit not found");
  if (dep.status !== "refund_requested") throw new StoreError("This deposit has no open refund request");
  const n = note.trim().slice(0, 500);
  if (!approve) {
    if (n.length < 5) throw new StoreError("Write why the refund is not approved (the merchant sees this)");
    await db.update(schema.storeDeposits).set({ status: "held", decidedBy: staffId, decidedAt: new Date(), decisionNote: n }).where(and(eq(schema.storeDeposits.id, dep.id), eq(schema.storeDeposits.status, "refund_requested")));
    await audit({ actorUserId: staffId, actorKind: "staff", orgId: dep.orgId, action: "store.deposit_refund_reject", targetType: "store_deposit", targetId: dep.id, details: { note: n } });
    return { refunded: 0 };
  }
  if (!Number.isInteger(refundPaise) || refundPaise < 0 || refundPaise > dep.amountPaise) throw new StoreError("Refund must be between ₹0 and the deposit amount");
  if (refundPaise < dep.amountPaise && n.length < 5) throw new StoreError("Explain the deduction (the merchant sees this)");
  const wallet = await walletFor(dep.orgId, db);
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.storeDeposits).where(eq(schema.storeDeposits.id, dep.id)).for("update");
    if (locked.status !== "refund_requested") throw new StoreError("This refund was already decided");
    let ledgerId: string | null = null;
    if (refundPaise > 0) {
      const r = await credit(dbLedgerStore(tx), { walletId: wallet.id, amount: refundPaise, kind: "store_deposit_refund", idempotencyKey: `storedepref:${dep.id}`, refType: "store_deposit", refId: dep.id, memo: `Security deposit refund (${dep.receiptNumber})` });
      ledgerId = r.entry.id;
    }
    await tx.update(schema.storeDeposits).set({ status: refundPaise > 0 ? "refunded" : "forfeited", refundPaise, refundLedgerEntryId: ledgerId, decidedBy: staffId, decidedAt: new Date(), decisionNote: n || null }).where(eq(schema.storeDeposits.id, dep.id));
  });
  await audit({ actorUserId: staffId, actorKind: "staff", orgId: dep.orgId, action: "store.deposit_refund_approve", targetType: "store_deposit", targetId: dep.id, details: { refundPaise, deductedPaise: dep.amountPaise - refundPaise, note: n || undefined } });
  return { refunded: refundPaise };
}

/** Service status changes. Starting/resuming needs the whole checklist; merchant may pause or end, never start. */
export async function setAdsStatus(orgId: string, actor: Actor, to: "active" | "paused" | "ended") {
  const s = await needStore(orgId);
  const m = await ensureAdsRow(s);
  if (m.status === to) return;
  if (to === "active") {
    if (actor.kind !== "staff") throw new StoreError("Your account manager starts the service once everything is ready");
    const missing = (await adsChecklist(s)).filter((i) => !i.ok);
    if (missing.length) throw new StoreError(`Not ready: ${missing.map((i) => i.label).join("; ")}`);
  }
  if (m.status === "ended" && to !== "active") throw new StoreError("The service has ended");
  const db = await getDb();
  await db.update(schema.storeManagedAds).set({ status: to, updatedAt: new Date() }).where(eq(schema.storeManagedAds.id, m.id));
  if (to !== "active") {
    // nothing can go live while the service is not running
    await db.update(schema.storeAdChanges).set({ status: "withdrawn", decisionNote: `Service ${to}` }).where(and(eq(schema.storeAdChanges.storeId, s.id), inArray(schema.storeAdChanges.status, ["pending", "approved"])));
  }
  await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId, action: "store.ads_status", targetType: "store", targetId: s.id, details: { from: m.status, to } });
}

export async function assignStaff(staffId: string, storeId: string, assignee: string | null) {
  const db = await getDb();
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!s) throw new StoreError("Store not found");
  if (assignee) {
    const [u] = await db.select().from(schema.users).where(and(eq(schema.users.id, assignee), eq(schema.users.kind, "staff"), eq(schema.users.active, true)));
    if (!u) throw new StoreError("Staff member not found");
  }
  await db.update(schema.stores).set({ assignedStaffId: assignee, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  await audit({ actorUserId: staffId, actorKind: "staff", orgId: s.orgId, action: "store.assign_staff", targetType: "store", targetId: s.id, details: { assignee } });
}

// ---------------- campaign changes (spend approvals + history) ----------------
export const CHANGE_KINDS = {
  new_campaign: "New campaign", budget_increase: "Budget increase", resume: "Restart campaign",
  budget_decrease: "Budget decrease", pause: "Pause campaign", end: "End campaign", creative: "New ads / creative", note: "Note",
} as const;
export type ChangeKind = keyof typeof CHANGE_KINDS;
/** Changes that can raise spend: never applied without the merchant's explicit approval. */
export const NEEDS_APPROVAL: ChangeKind[] = ["new_campaign", "budget_increase", "resume"];

export const ChangeInput = z.object({
  kind: z.enum(Object.keys(CHANGE_KINDS) as [ChangeKind, ...ChangeKind[]]),
  campaignName: z.string().trim().min(2).max(120),
  dailyBudgetRupees: z.coerce.number().min(0).max(1_000_000).optional(),
  totalBudgetRupees: z.coerce.number().min(0).max(10_000_000).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  details: z.string().trim().max(2000).optional(),
});

export async function proposeChange(staffId: string, storeId: string, input: z.infer<typeof ChangeInput>) {
  const db = await getDb();
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!s) throw new StoreError("Store not found");
  const m = await managedAdsRow(s.id);
  if (!m || m.status === "ended") throw new StoreError("Managed Meta Ads is not set up for this store");
  const needs = NEEDS_APPROVAL.includes(input.kind);
  const daily = input.dailyBudgetRupees ? Math.round(input.dailyBudgetRupees * 100) : null;
  const total = input.totalBudgetRupees ? Math.round(input.totalBudgetRupees * 100) : null;
  if (needs && !daily && !total) throw new StoreError("Give a daily or total budget so the merchant knows what they approve");
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new StoreError("End date is before the start date");
  if (needs && m.monthlyCapPaise) {
    const monthly = daily ? daily * 30 : 0;
    if (monthly > m.monthlyCapPaise || (total ?? 0) > m.monthlyCapPaise * 12)
      throw new StoreError(`Above the merchant's monthly ad spend limit (${rupees(m.monthlyCapPaise)}). Ask them to raise it first.`);
  }
  if (!needs && m.status !== "active" && input.kind !== "note") throw new StoreError("Start the service before recording campaign changes");
  const id = newId("sac");
  const now = new Date();
  await db.insert(schema.storeAdChanges).values({
    id, storeId: s.id, orgId: s.orgId, kind: input.kind, campaignName: input.campaignName, dailyBudgetPaise: daily, totalBudgetPaise: total,
    startDate: input.startDate ?? null, endDate: input.endDate ?? null, details: input.details || null,
    status: needs ? "pending" : "applied", needsApproval: needs, proposedBy: staffId, appliedBy: needs ? null : staffId, appliedAt: needs ? null : now,
  });
  await audit({ actorUserId: staffId, actorKind: "staff", orgId: s.orgId, action: needs ? "store.ads_change_propose" : "store.ads_change_record", targetType: "store_ad_change", targetId: id, details: { kind: input.kind, campaign: input.campaignName, daily, total } });
  return id;
}

/** Merchant approves or rejects. Approval must be explicit (confirm=true) and is recorded with who and when. */
export async function decideChange(orgId: string, actor: Actor, changeId: string, approve: boolean, confirm: boolean, note: string) {
  const s = await needStore(orgId);
  if (approve && !confirm) throw new StoreError("Tick the box to confirm you approve this spend");
  const db = await getDb();
  const [c] = await db.select().from(schema.storeAdChanges).where(and(eq(schema.storeAdChanges.id, changeId), eq(schema.storeAdChanges.storeId, s.id)));
  if (!c) throw new StoreError("Change not found");
  if (c.status !== "pending") throw new StoreError("This change was already decided");
  const r = await db.update(schema.storeAdChanges).set({ status: approve ? "approved" : "rejected", decidedBy: actor.userId, decidedAt: new Date(), decisionNote: note.trim().slice(0, 500) || null })
    .where(and(eq(schema.storeAdChanges.id, c.id), eq(schema.storeAdChanges.status, "pending"))).returning({ id: schema.storeAdChanges.id });
  if (!r.length) throw new StoreError("This change was already decided");
  await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId, action: approve ? "store.ads_change_approve" : "store.ads_change_reject", targetType: "store_ad_change", targetId: c.id, details: { kind: c.kind, campaign: c.campaignName, daily: c.dailyBudgetPaise, total: c.totalBudgetPaise } });
}

/** Staff: an approved change was made in Meta Ads Manager (records the Meta campaign id), or a pending one is withdrawn. */
export async function staffChangeAction(staffId: string, changeId: string, action: "applied" | "withdrawn", metaCampaignId?: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.storeAdChanges).where(eq(schema.storeAdChanges.id, changeId));
  if (!c) throw new StoreError("Change not found");
  if (action === "applied") {
    if (c.status !== "approved") throw new StoreError("Only merchant-approved changes can be marked as done");
    const m = await managedAdsRow(c.storeId);
    if (m?.status !== "active") throw new StoreError("Managed Meta Ads is not active for this store");
    const mid = (metaCampaignId ?? "").trim();
    if (mid && !/^\d{5,25}$/.test(mid)) throw new StoreError("Meta campaign ID is digits only");
    await db.update(schema.storeAdChanges).set({ status: "applied", appliedBy: staffId, appliedAt: new Date(), metaCampaignId: mid || null }).where(and(eq(schema.storeAdChanges.id, c.id), eq(schema.storeAdChanges.status, "approved")));
  } else {
    if (!["pending", "approved"].includes(c.status)) throw new StoreError("Only open changes can be withdrawn");
    await db.update(schema.storeAdChanges).set({ status: "withdrawn" }).where(eq(schema.storeAdChanges.id, c.id));
  }
  await audit({ actorUserId: staffId, actorKind: "staff", orgId: c.orgId, action: `store.ads_change_${action}`, targetType: "store_ad_change", targetId: c.id, details: { metaCampaignId: metaCampaignId || undefined } });
}

export async function adChanges(storeId: string) {
  const db = await getDb();
  return db.select().from(schema.storeAdChanges).where(eq(schema.storeAdChanges.storeId, storeId)).orderBy(desc(schema.storeAdChanges.createdAt)).limit(200);
}

export async function depositHistory(storeId: string) {
  const db = await getDb();
  return db.select().from(schema.storeDeposits).where(eq(schema.storeDeposits.storeId, storeId)).orderBy(desc(schema.storeDeposits.createdAt));
}

/** Names for staff ids shown to merchants (first name only) and admins. */
export async function staffNames(ids: Array<string | null | undefined>) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const db = await getDb();
  const rows = await db.select({ id: schema.users.id, name: schema.users.name, kind: schema.users.kind }).from(schema.users).where(inArray(schema.users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}
