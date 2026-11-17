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

export type MarkupSource = "global" | "customer_override";

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
