import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import { type MarkupSettings, type PricedQuote, DEFAULT_COMPONENT_RULES, priceQuote, resolveMarkup } from "@/server/pricing/engine";
import { getAdapter, providerContext } from "@/server/providers/registry";
import type { QuoteRequest } from "@/server/providers/types";

export const QUOTE_TTL_MS = 30 * 60 * 1000;

export async function loadMarkupSettings(provider: string): Promise<MarkupSettings> {
  const db = await getDb();
  const rows = await db.select().from(schema.markupRules).where(eq(schema.markupRules.provider, provider));
  const globals = rows.filter((r) => r.orgId === null && !r.clearedAt).sort((a, b) => b.version - a.version);
  const g = globals[0];
  return {
    global: g ? { bps: g.bps, ruleId: g.id, version: g.version } : { bps: 2500, ruleId: "default-25", version: 0 },
    overrides: rows.filter((r) => r.orgId !== null).map((r) => ({
      orgId: r.orgId!, bps: r.bps, ruleId: r.id, version: r.version, effectiveFrom: r.effectiveFrom, clearedAt: r.clearedAt,
    })),
  };
}

export async function getSetting<T>(key: string, fallback: T): Promise<{ value: T; version: number }> {
  const db = await getDb();
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, key));
  return row ? { value: row.value as T, version: row.version } : { value: fallback, version: 0 };
}

export interface QuoteOffer extends PricedQuote {
  quoteId: string;
  expiresAt: string;
  isDemo: boolean;
}

/**
 * Get priced offers from every enabled shipping account. `orgId` MUST come from the authenticated
 * session/API key (null for the public calculator). One markup is applied per offer.
 */
export async function getQuotes(req: QuoteRequest, orgId: string | null): Promise<{ offers: QuoteOffer[]; errors: string[] }> {
  const db = await getDb();
  const accounts = await db.select().from(schema.providerAccounts)
    .where(and(eq(schema.providerAccounts.category, "shipping"), eq(schema.providerAccounts.status, "enabled")));

  const gst = await getSetting<number>("gst_bps", 1800);
  const rules = await getSetting("component_rules", DEFAULT_COMPONENT_RULES);
  const offers: QuoteOffer[] = [];
  const errors: string[] = [];
  const now = new Date();

  for (const acct of accounts) {
    const adapter = getAdapter(acct.adapter);
    if (!adapter) { errors.push(`${acct.label}: adapter required`); continue; }
    const ctx = await providerContext(acct);
    const res = await adapter.quote(ctx, req);
    if (!res.ok) { if (res.error.category !== "unsupported") errors.push(`${acct.label}: ${res.error.message}`); continue; }

    // Markup source: Shipmozo has a mandatory provider-specific rule; demo mirrors it so the demo
    // exercises the same path. Other providers use the same table keyed by their adapter name.
    const markupProvider = acct.adapter === "demo" ? "shipmozo" : acct.adapter;
    const settings = await loadMarkupSettings(markupProvider);
    const markup = resolveMarkup(settings, orgId, now);

    for (const q of res.value) {
      const priced = priceQuote(q, markup, { gstBps: gst.value, componentRules: rules.value, componentRulesVersion: rules.version });
      const quoteId = newId("qt");
      const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);
      offers.push({ ...priced, quoteId, expiresAt: expiresAt.toISOString(), isDemo: acct.adapter === "demo" });
      await db.insert(schema.quotes).values({
        id: quoteId, orgId, providerAccountId: acct.id, provider: acct.adapter, carrierCode: q.carrierCode,
        serviceName: q.serviceName, mode: q.mode, request: req, priced: { ...priced, providerQuoteRef: q.providerQuoteRef },
        totalPaise: priced.total, expiresAt,
      });
    }
  }
  offers.sort((a, b) => a.total - b.total);
  return { offers, errors };
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
