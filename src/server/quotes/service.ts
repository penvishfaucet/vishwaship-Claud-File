import { modeAllowed, paymentConfig, payerSplit, type PayerSplit } from "@/server/payment-modes";
import { shipmozoB2cTakesB2b } from "@/server/providers/shipmozo-rules";
import { FOD_COD_ADAPTERS } from "@/lib/payment";
import type { PaymentMode } from "@/server/providers/types";
import "server-only";
import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import {
  type ComponentCode, type ComponentRule, type MarkupRow, type MarkupRule, type MarkupSettings, type PricedQuote,
  ALL_ELIGIBLE_COMPONENT_RULES, DEFAULT_COMPONENT_RULES, DELHIVERY_B2B_COMPONENT_RULES, GLOBAL_MARKUP_KEY, pickMarkup, priceQuote,
} from "@/server/pricing/engine";
import { adapterFor, providerContext } from "@/server/providers/registry";
import { canTakeBookings } from "@/server/carriers/verification";
import { CARRIER_SPECS, partnerCodeFor } from "@/server/carriers/specs";
import { hideProviders } from "@/server/customer-safe";
import { isNszPin } from "@/server/carriers/nsz";
import type { QuoteRequest } from "@/server/providers/types";

export const QUOTE_TTL_MS = 30 * 60 * 1000;
/** Each provider gets its own budget; a slow provider never holds back the others' verified quotes. */
export const QUOTE_TIMEOUT_MS = 12_000;

type Account = InferSelectModel<typeof schema.providerAccounts>;

export async function loadMarkupRows(): Promise<MarkupRow[]> {
  const db = await getDb();
  return (await db.select().from(schema.markupRules)).map((r) => ({ id: r.id, provider: r.provider, orgId: r.orgId, bps: r.bps, version: r.version, effectiveFrom: r.effectiveFrom, clearedAt: r.clearedAt }));
}

/** Accounts whose KYC is not approved yet: one margin on every rate (Admin → Pricing → Non-KYC margin). */
export type NonKycMarkup = { enabled: boolean; bps: number };
export const NON_KYC_DEFAULT: NonKycMarkup = { enabled: true, bps: 3000 };

/** The non-KYC margin rule for this account, or null when its KYC is approved (or the rule is off / public). */
export async function nonKycRule(orgId: string | null): Promise<MarkupRule | null> {
  if (!orgId) return null;
  const db = await getDb();
  const [o] = await db.select({ kyc: schema.orgs.kycStatus }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  if (!o || o.kyc === "approved") return null;
  const s = await getSetting<NonKycMarkup>("non_kyc_markup", NON_KYC_DEFAULT);
  const v = { ...NON_KYC_DEFAULT, ...s.value };
  return v.enabled ? { bps: v.bps, source: "non_kyc", ruleId: "non_kyc_markup", ruleVersion: s.version } : null;
}

/** The markup a quote from this provider/service gets for this customer (null = public). */
export async function effectiveMarkup(adapter: string, mode: "B2C" | "B2B", orgId: string | null): Promise<MarkupRule> {
  return (await nonKycRule(orgId)) ?? pickMarkup(await loadMarkupRows(), adapter, mode, orgId);
}

/** Legacy shape (global + customer rows) used by the customer pricing card and price list. */
export async function loadMarkupSettings(): Promise<MarkupSettings> {
  const rows = (await loadMarkupRows()).filter((r) => r.provider === GLOBAL_MARKUP_KEY);
  const g = pickMarkup(rows, "-", "B2C", null);
  return {
    global: { bps: g.bps, ruleId: g.ruleId, version: g.ruleVersion },
    overrides: rows.filter((r) => r.orgId !== null).map((r) => ({ orgId: r.orgId!, bps: r.bps, ruleId: r.id, version: r.version, effectiveFrom: r.effectiveFrom, clearedAt: r.clearedAt })),
  };
}

export async function getSetting<T>(key: string, fallback: T): Promise<{ value: T; version: number }> {
  const db = await getDb();
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, key));
  return row ? { value: row.value as T, version: row.version } : { value: fallback, version: 0 };
}

export interface QuoteOffer extends PricedQuote {
  payer: PayerSplit;
  pricingSource: string;
  paymentMode: PaymentMode;
  quoteId: string;
  expiresAt: string;
  isDemo: boolean;
  /** Offered only to pilot customers while Admin verifies the integration. */
  isPilot?: boolean;
  providerAccountId: string;
  /** Courier partner code of the provider account this rate came from (e.g. VISW001B2C). */
  partnerCode: string | null;
}

/** Which component rules a provider uses (Admin can override per provider via pricing_settings). */
function defaultRules(adapter: string, global: Record<ComponentCode, ComponentRule>) {
  if (adapter === "shipmozo") return ALL_ELIGIBLE_COMPONENT_RULES;
  if (adapter === "delhivery_b2b") return DELHIVERY_B2B_COMPONENT_RULES;
  return global;
}

/** Accounts that may quote for this customer: Active ones, plus accounts in verification for their pilot customers. */
async function quotingAccounts(orgId: string | null, only?: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.category, "shipping"), ne(schema.providerAccounts.status, "archived")));
  return rows.filter((a) => {
    if (only && a.id !== only) return false;
    if (!adapterFor(a)?.implemented.includes("book")) return false; // never show a rate the customer cannot book (e.g. Shipora X until order-create is documented)
    if (a.status === "enabled") return canTakeBookings(a); // never quote an unverified service, even if switched on
    if (a.status !== "disabled" || !orgId || !a.secretsEnc) return false; // paused accounts never quote
    const pilots = ((a.configPublic as Record<string, unknown>)?.pilotOrgIds as string[] | undefined) ?? [];
    return pilots.includes(orgId);
  });
}

export function accountServes(a: Account, mode: "B2C" | "B2B", req?: Pick<QuoteRequest, "packages">) {
  const cfg = (a.configPublic as Record<string, unknown>) ?? {};
  const svc = cfg.service;
  if (svc !== "B2C" && svc !== "B2B") return true;
  if (svc === mode) return true;
  // A heavy (B2B-class) parcel can also go by the B2C couriers of a Shipmozo account (TCI Express, Blue Dart, Ekart,
  // Xpressbees, Amazon, Delhivery heavy …, as the Shipmozo panel shows them) — when that account can book it:
  // one box, or several once its multi-carton (MPS) booking is verified.
  if (a.adapter === "shipmozo" && svc === "B2C" && mode === "B2B" && req) return shipmozoB2cTakesB2b(req, cfg);
  return false;
}


function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} did not respond within ${Math.round(ms / 1000)} s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Get priced offers from every quoting shipping account, in parallel with an independent timeout each.
 * `orgId` MUST come from the authenticated session/API key (null for the public calculator).
 */
/** Outcome of one shipping service for one quote request (public calculator shows these per service). */
export type ServiceStatus = {
  accountId: string; adapter: string; mode: "B2C" | "B2B";
  /** ok = returned rates; no_service = answered but does not serve this route/shipment; failed = timeout/error (retry); skipped = not offered for this payment mode */
  status: "ok" | "no_service" | "failed" | "skipped";
  category?: string; message?: string; count: number;
};

export async function getQuotes(req: QuoteRequest, orgId: string | null, opts: { persist?: boolean; onlyAccountId?: string } = {}): Promise<{ offers: QuoteOffer[]; errors: string[]; statuses: ServiceStatus[] }> {
  const persist = opts.persist ?? true;
  const allowed = await (await import("@/server/couriers")).courierFilter(orgId);
  const db = await getDb();
  const accounts = (await quotingAccounts(orgId, opts.onlyAccountId)).filter((a) => accountServes(a, req.mode, req));
  const gst = await getSetting<number>("gst_bps", 1800);
  const rules = await getSetting("component_rules", DEFAULT_COMPONENT_RULES);
  const markupRows = await loadMarkupRows();
  const nonKyc = await nonKycRule(orgId);
  const now = new Date();

  const results = await Promise.all(accounts.map(async (acct) => {
    const offers: QuoteOffer[] = [];
    // Customer-facing name: aggregator accounts appear only by partner code (never "Shipmozo" / "Shipora X").
    const spec = CARRIER_SPECS[acct.adapter];
    const label = spec?.route === "aggregator" ? (partnerCodeFor(acct.adapter, acct.configPublic as Record<string, unknown>) ?? "Courier partner") : String((acct.configPublic as Record<string, unknown>)?.brandName ?? acct.label);
    const adapter = adapterFor(acct);
    const st = (status: ServiceStatus["status"], message?: string, category?: string): ServiceStatus => ({ accountId: acct.id, adapter: acct.adapter, mode: req.mode, status, message: message ? hideProviders(message) : undefined, category, count: offers.length });
    if (!adapter) return { offers, error: `${label}: integration pending`, status: st("failed", "integration pending", "unsupported") };
    const pay = paymentConfig(acct, adapter);
    const allowedMode = modeAllowed(pay, req.paymentType);
    if (!allowedMode.ok) return { offers, error: pay.fodStatus === "not_supported" && req.paymentType === "fod" ? null : `${label}: ${allowedMode.reason}`, status: st("skipped", allowedMode.reason, "payment_mode") };
    // FOD + COD: only couriers that collect cash on a FOD shipment (Delhivery B2B — Shipmozo does not)
    if (req.paymentType === "fod" && (req.codAmount ?? 0) > 0 && (!FOD_COD_ADAPTERS.includes(acct.adapter) || !pay.cod)) return { offers, error: null, status: st("skipped", "COD on FOD is not offered", "payment_mode") };
    // a PIN this courier rejected as a non-serviceable zone (NSZ) at booking is not offered again for a while
    if (await isNszPin(acct.adapter, req.destinationPincode).catch(() => false)) {
      return { offers, error: `${label}: does not deliver to ${req.destinationPincode} (non-serviceable zone)`, status: st("no_service", `does not deliver to ${req.destinationPincode} (non-serviceable zone)`, "not_serviceable") };
    }
    let res;
    try {
      res = await withTimeout(adapter.quote(await providerContext(acct), req), QUOTE_TIMEOUT_MS, label);
    } catch (e) {
      return { offers, error: `${label}: rate unavailable — ${(e as Error).message}`.slice(0, 200), status: st("failed", (e as Error).message, "timeout") };
    }
    if (!res.ok) {
      const c = res.error.category;
      const kind: ServiceStatus["status"] = c === "unsupported" || c === "not_serviceable" || c === "validation" ? "no_service" : "failed";
      return { offers, error: c === "unsupported" ? null : `${label}: ${res.error.message}`, status: st(kind, res.error.message, c) };
    }

    // KYC not approved yet → the non-KYC margin on every courier and service; approved → the normal rules
    const markup = nonKyc ?? pickMarkup(markupRows, acct.adapter, req.mode, orgId, now);
    const partnerCode = partnerCodeFor(acct.adapter, acct.configPublic as Record<string, unknown>);
    // Owner rule (2026-11-19): margin on the whole verified carrier subtotal (freight + fuel + docket + ODA + FOD + other)
    // for every courier and service; GST once on the result. Older per-provider overrides are no longer applied.
    const provRules = { value: ALL_ELIGIBLE_COMPONENT_RULES, version: 2 };
    for (const q of res.value) {
      if (!allowed(q.carrierCode)) continue; // switched off by Admin or by this customer (Manage Courier)
      const priced = priceQuote(q, markup, { gstBps: gst.value, componentRules: provRules.value, componentRulesVersion: provRules.version });
      const payer = payerSplit(priced, req.paymentType, pay.fodBasis, gst.value);
      const pricingSource = q.providerQuoteRef?.split(":")[0] ?? acct.adapter;
      const quoteId = newId("qt");
      const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);
      const isPilot = acct.status !== "enabled";
      offers.push({ ...priced, quoteId, expiresAt: expiresAt.toISOString(), isDemo: acct.adapter === "demo", isPilot, payer, pricingSource, paymentMode: req.paymentType, providerAccountId: acct.id, partnerCode });
      if (persist) await db.insert(schema.quotes).values({
        id: quoteId, orgId, providerAccountId: acct.id, provider: acct.adapter, carrierCode: q.carrierCode,
        serviceName: q.serviceName, mode: q.mode, request: req,
        priced: { ...priced, providerQuoteRef: q.providerQuoteRef, payer, pricingSource, paymentMode: req.paymentType, markupKey: markup.source, isPilot, partnerCode, providerComponents: q.components, providerTaxInclusive: q.taxInclusive },
        totalPaise: priced.total, expiresAt,
      });
    }
    return { offers, error: null as string | null, status: st(offers.length ? "ok" : "no_service", offers.length ? undefined : "no courier for this shipment", offers.length ? undefined : "not_serviceable") };
  }));

  // the same courier service from two accounts (e.g. "Delhivery Heavy MPS" on both Shipmozo accounts): the cheaper one
  const best = new Map<string, QuoteOffer>();
  for (const o of results.flatMap((r) => r.offers).sort((a, b) => a.total - b.total)) {
    const k = `${o.carrierCode}|${o.serviceName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${o.paymentMode}`;
    if (!best.has(k)) best.set(k, o);
  }
  const offers = [...best.values()];
  const errors = results.map((r) => r.error).filter((e): e is string => !!e).map(hideProviders);
  // Say so instead of an empty list when no courier service is switched on for this shipment type.
  if (!offers.length && !errors.length && !opts.onlyAccountId) errors.push(`${req.mode} rates are not available right now — no ${req.mode} courier service is active yet. Please try again later.`);
  return { offers, errors, statuses: results.map((r) => r.status) };
}

/** Load a saved quote for booking; honours the original rule while valid. */
export async function loadQuoteForBooking(quoteId: string, orgId: string) {
  const db = await getDb();
  const [q] = await db.select().from(schema.quotes).where(and(eq(schema.quotes.id, quoteId), eq(schema.quotes.orgId, orgId)));
  if (!q) return { ok: false as const, reason: "not_found" as const };
  if (q.expiresAt.getTime() < Date.now()) return { ok: false as const, reason: "expired" as const };
  return { ok: true as const, quote: q };
}

export async function quotesByIds(ids: string[]) {
  const db = await getDb();
  return ids.length ? db.select().from(schema.quotes).where(inArray(schema.quotes.id, ids)) : [];
}

/** Same provider account + carrier + service (+ Shipmozo courier_id) as an earlier quote. */
export function sameService(a: { carrierCode: string; serviceName: string; providerQuoteRef?: string }, b: { carrierCode: string; serviceName: string; providerQuoteRef?: string }) {
  const id = (r?: string) => (r?.startsWith("shipmozo_api:") ? r.split(":")[1] : null);
  if (id(a.providerQuoteRef) || id(b.providerQuoteRef)) return id(a.providerQuoteRef) === id(b.providerQuoteRef);
  return a.carrierCode === b.carrierCode && a.serviceName === b.serviceName;
}
