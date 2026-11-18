import type { QuoteOffer } from "./service";

/** Customer-facing view of a priced offer: selling breakdown and who pays — never carrier cost or margin. */
export const presentOffer = (o: QuoteOffer) => ({
  quoteId: o.quoteId, carrierCode: o.carrierCode, carrierName: o.carrierName, serviceName: o.serviceName, mode: o.mode,
  etaDays: o.etaDays, chargeableWeightGrams: o.chargeableWeightGrams, isPilot: !!o.isPilot, partnerCode: o.partnerCode ?? null,
  lines: o.lines.map((l) => ({ code: l.code, label: l.label, sellPreTax: l.sellPreTax })),
  sellingSubtotal: o.sellingSubtotal, gst: o.gst, total: o.total, expiresAt: o.expiresAt, isDemo: o.isDemo,
  paymentMode: o.paymentMode, payer: { sender: o.payer.sender, receiver: o.payer.receiver },
});

/** Reasons a service gave no rate, safe to show to the customer (no secrets; provider text trimmed). */
export const presentNotices = (errors: string[]) => errors.map((e) => e.replace(/\s+/g, " ").slice(0, 160));
