/**
 * Vishwaship pricing engine. One code path is used by the public calculator, the portal
 * calculator, booking, bulk/store imports and the /api/v1 quote endpoint.
 *
 * Shipmozo rule (owner spec, section 5):
 *   selling subtotal = markup-eligible subtotal x (1 + effective markup / 100) + pass-through fees
 *   Exactly one markup per quote. The effective markup is the customer's active override, if any,
 *   otherwise the global default (seeded at 25%). Unauthenticated quotes use the global default.
 *
 * Tax: provider quotes may arrive tax-inclusive or tax-exclusive. We normalise every component
 * to pre-tax paise first, apply markup to pre-tax eligible components only, then charge GST once
 * on the Vishwaship selling subtotal. The buyer's COD collection amount is never a pricing
 * component, so it can never be marked up. Only the carrier's COD *fee* is a component, and
 * whether that fee is markup-eligible is configured per component code.
 */
import { type Bps, type Paise, mulDivRound, pctOf } from "@/lib/money";

export type ComponentCode =
  | "freight" | "fuel" | "fov" | "oda" | "handling" | "cod_fee"
  | "rto" | "reverse" | "docket" | "other";

export interface ProviderQuoteComponent {
  code: ComponentCode;
  label: string;
  amount: Paise;
}

export interface ProviderQuote {
  provider: string;            // adapter key, e.g. "shipmozo"
  carrierCode: string;         // actual carrier, e.g. "delhivery"
  carrierName: string;
  serviceName: string;
  mode: "B2C" | "B2B";
  etaDays?: number;
  components: ProviderQuoteComponent[];
  /** True if component amounts already include GST at `taxRateBps`. */
  taxInclusive: boolean;
  taxRateBps: Bps;
  chargeableWeightGrams: number;
  providerQuoteRef?: string;
}

export interface ComponentRule {
  /** Receives the markup. */
  markupEligible: boolean;
}

/** Default component treatment. Admin can edit; the version is stored on every priced quote. */
export const DEFAULT_COMPONENT_RULES: Record<ComponentCode, ComponentRule> = {
  freight: { markupEligible: true },
  fuel: { markupEligible: true },
  docket: { markupEligible: true },
  rto: { markupEligible: true },
  reverse: { markupEligible: true },
  handling: { markupEligible: true },
  oda: { markupEligible: true },
  fov: { markupEligible: false },     // insurance/owner's-risk: pass-through
  cod_fee: { markupEligible: false }, // carrier COD handling fee: pass-through by default
  other: { markupEligible: false },
};

export type MarkupSource = "global" | "provider_default" | "customer_override";

export interface MarkupRule {
  bps: Bps;
  source: MarkupSource;
  ruleId: string;
  ruleVersion: number;
}

export interface PricedLine {
  code: ComponentCode;
  label: string;
  costPreTax: Paise;
  markupEligible: boolean;
  sellPreTax: Paise;
}

export interface PricedQuote {
  provider: string;
  carrierCode: string;
  carrierName: string;
  serviceName: string;
  mode: "B2C" | "B2B";
  etaDays?: number;
  chargeableWeightGrams: number;
  lines: PricedLine[];
  costPreTax: Paise;
  eligibleCostPreTax: Paise;
  passThroughPreTax: Paise;
  markup: MarkupRule;
  sellingSubtotal: Paise;
  gstBps: Bps;
  gst: Paise;
  total: Paise;
  componentRulesVersion: number;
}

/** Remove tax from a tax-inclusive amount: amount * 10000 / (10000 + rate). */
export function stripTax(amount: Paise, rateBps: Bps): Paise {
  return mulDivRound(amount, 10_000, 10_000 + rateBps);
}

export function priceQuote(
  q: ProviderQuote,
  markup: MarkupRule,
  opts: {
    gstBps: Bps;
    componentRules?: Record<ComponentCode, ComponentRule>;
    componentRulesVersion?: number;
  },
): PricedQuote {
  if (!Number.isSafeInteger(markup.bps) || markup.bps < 0 || markup.bps > 50_000) {
    throw new Error(`Markup out of range: ${markup.bps} bps`);
  }
  const rules = opts.componentRules ?? DEFAULT_COMPONENT_RULES;

  const lines: PricedLine[] = q.components.map((c) => {
    const costPreTax = q.taxInclusive ? stripTax(c.amount, q.taxRateBps) : c.amount;
    const eligible = rules[c.code]?.markupEligible ?? false;
    return { code: c.code, label: c.label, costPreTax, markupEligible: eligible, sellPreTax: costPreTax };
  });

  const eligibleCostPreTax = lines.filter((l) => l.markupEligible).reduce((s, l) => s + l.costPreTax, 0);
  const passThroughPreTax = lines.filter((l) => !l.markupEligible).reduce((s, l) => s + l.costPreTax, 0);

  // Markup is computed once on the eligible subtotal (not per line) so rounding happens once.
  const markedUpEligible = eligibleCostPreTax + pctOf(eligibleCostPreTax, markup.bps);

  // Distribute the marked-up eligible subtotal back over lines for display; the last eligible
  // line absorbs rounding so lines always sum to the subtotal exactly.
  const eligibleLines = lines.filter((l) => l.markupEligible);
  let allocated = 0;
  eligibleLines.forEach((l, i) => {
    if (i === eligibleLines.length - 1) {
      l.sellPreTax = markedUpEligible - allocated;
    } else {
      l.sellPreTax = eligibleCostPreTax === 0 ? 0 : mulDivRound(markedUpEligible, l.costPreTax, eligibleCostPreTax);
      allocated += l.sellPreTax;
    }
  });

  const sellingSubtotal = markedUpEligible + passThroughPreTax;
  const gst = pctOf(sellingSubtotal, opts.gstBps);

  return {
    provider: q.provider,
    carrierCode: q.carrierCode,
    carrierName: q.carrierName,
    serviceName: q.serviceName,
    mode: q.mode,
    etaDays: q.etaDays,
    chargeableWeightGrams: q.chargeableWeightGrams,
    lines,
    costPreTax: eligibleCostPreTax + passThroughPreTax,
    eligibleCostPreTax,
    passThroughPreTax,
    markup,
    sellingSubtotal,
    gstBps: opts.gstBps,
    gst,
    total: sellingSubtotal + gst,
    componentRulesVersion: opts.componentRulesVersion ?? 1,
  };
}

export interface MarkupSettings {
  global: { bps: Bps; ruleId: string; version: number };
  overrides: Array<{
    orgId: string;
    bps: Bps;
    ruleId: string;
    version: number;
    effectiveFrom: Date;
    clearedAt?: Date | null;
  }>;
}

/**
 * Pick exactly one markup. orgId must come from the authenticated session or API key on the
 * server, never from request input. A null orgId (public calculator) always gets the global rule.
 */
export function resolveMarkup(settings: MarkupSettings, orgId: string | null, now = new Date()): MarkupRule {
  if (orgId) {
    const active = settings.overrides
      .filter((o) => o.orgId === orgId && o.effectiveFrom <= now && !o.clearedAt)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    if (active) {
      return { bps: active.bps, source: "customer_override", ruleId: active.ruleId, ruleVersion: active.version };
    }
  }
  return { bps: settings.global.bps, source: "global", ruleId: settings.global.ruleId, ruleVersion: settings.global.version };
}

/** Versioned rule rows as stored (provider key "*" = all providers; orgId null = not customer-specific). */
export interface MarkupRow { id: string; provider: string; orgId: string | null; bps: Bps; version: number; effectiveFrom: Date; clearedAt?: Date | null }

export const GLOBAL_MARKUP_KEY = "*";
export const DEFAULT_GLOBAL_BPS = 2500;
/** Provider + service default key, e.g. "shipmozo:B2C". */
export const serviceMarkupKey = (adapter: string, mode: "B2C" | "B2B") => `${adapter}:${mode}`;

/**
 * Pick exactly one markup, in this priority:
 *   1. the customer's own active percentage (an explicitly saved 0% counts);
 *   2. the provider + service default ("shipmozo:B2C"), or the provider-wide default ("delhivery_b2b");
 *   3. the Vishwaship global default ("*"), initially 25%.
 * orgId must come from the authenticated session (null for the public calculator → never a customer rule).
 */
export function pickMarkup(rows: MarkupRow[], adapter: string, mode: "B2C" | "B2B", orgId: string | null, now = new Date()): MarkupRule {
  const live = rows.filter((r) => !r.clearedAt && r.effectiveFrom <= now);
  const newest = (xs: MarkupRow[]) => xs.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.version - a.version)[0];
  if (orgId) {
    const c = newest(live.filter((r) => r.orgId === orgId && r.provider === GLOBAL_MARKUP_KEY));
    if (c) return { bps: c.bps, source: "customer_override", ruleId: c.id, ruleVersion: c.version };
  }
  for (const key of [serviceMarkupKey(adapter, mode), adapter]) {
    const d = newest(live.filter((r) => r.orgId === null && r.provider === key));
    if (d) return { bps: d.bps, source: "provider_default", ruleId: d.id, ruleVersion: d.version };
  }
  const g = newest(live.filter((r) => r.orgId === null && r.provider === GLOBAL_MARKUP_KEY));
  return g ? { bps: g.bps, source: "global", ruleId: g.id, ruleVersion: g.version } : { bps: DEFAULT_GLOBAL_BPS, source: "global", ruleId: "default-25", ruleVersion: 0 };
}

/** Shipmozo: customer price = provider rate × (1 + markup) — the whole comparable (pre-tax) rate is marked up once. */
export const ALL_ELIGIBLE_COMPONENT_RULES: Record<ComponentCode, ComponentRule> = {
  freight: { markupEligible: true }, fuel: { markupEligible: true }, fov: { markupEligible: true }, oda: { markupEligible: true }, handling: { markupEligible: true },
  cod_fee: { markupEligible: true }, rto: { markupEligible: true }, reverse: { markupEligible: true }, docket: { markupEligible: true }, other: { markupEligible: true },
};

/**
 * Delhivery Direct B2B: "Customer B2B freight = Delhivery base freight × (1 + markup / 100)".
 * Only the base freight receives the markup; fuel, docket, ROV, ODA, COD/FOD and other carrier charges pass
 * through at cost, and GST is charged once on the Vishwaship subtotal.
 */
export const DELHIVERY_B2B_COMPONENT_RULES: Record<ComponentCode, ComponentRule> = {
  freight: { markupEligible: true },
  fuel: { markupEligible: false }, docket: { markupEligible: false }, rto: { markupEligible: false }, reverse: { markupEligible: false },
  handling: { markupEligible: false }, oda: { markupEligible: false }, fov: { markupEligible: false }, cod_fee: { markupEligible: false }, other: { markupEligible: false },
};
