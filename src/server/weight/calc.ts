/**
 * Weight discrepancy charge (owner-approved 2026-11-22).
 *
 *   revised weight = the courier's charged weight (their re-weigh / volumetric, already rounded to their slab)
 *   only when revised > the chargeable weight the client was billed for at booking (no tolerance)
 *   new courier cost: the weight-driven lines of the booking quote (base freight, fuel %) are re-rated at the
 *     booking rate for the revised weight; docket, ROV, ODA, COD/FOD fees stay the same. When the courier report
 *     states its real extra charge, that amount is used instead (split over the same lines).
 *   client price before / after = the booking quote formula with the SAME markup and component rules that were
 *     applied at booking: eligible cost × (1 + markup) + pass-through, then GST once on the subtotal.
 *   charge to the client = price after − price before (GST included).
 */
import { mulDivRound, pctOf } from "@/lib/money";

/** The parts of a booking quote snapshot (quotes.priced) the calculation needs. */
export interface PricedSnapshot {
  lines?: Array<{ code: string; label?: string; costPreTax: number; markupEligible: boolean }>;
  costPreTax?: number;
  eligibleCostPreTax?: number;
  passThroughPreTax?: number;
  markup?: { bps: number };
  gstBps?: number;
}

export interface WeightCalc {
  bookedGrams: number;
  revisedGrams: number;
  markupBps: number;
  gstBps: number;
  /** "rerated" = booking rate × revised weight; "courier" = courier-reported extra amount. */
  basis: "rerated" | "courier";
  before: { costPreTax: number; subtotal: number; gst: number; total: number };
  after: { costPreTax: number; subtotal: number; gst: number; total: number };
  /** Extra pre-tax cost the courier bills Vishwaship. */
  extraCostPreTax: number;
  /** Extra amount debited from the client wallet (GST included). */
  chargePaise: number;
  lines: Array<{ code: string; label: string; markupEligible: boolean; beforeCost: number; afterCost: number }>;
}

const WEIGHT_DRIVEN = new Set(["freight", "fuel"]);

function price(eligible: number, pass: number, markupBps: number, gstBps: number) {
  const subtotal = eligible + pctOf(eligible, markupBps) + pass;
  const gst = pctOf(subtotal, gstBps);
  return { costPreTax: eligible + pass, subtotal, gst, total: subtotal + gst };
}

export function computeWeightCharge(a: { priced: PricedSnapshot; bookedGrams: number; revisedGrams: number; courierExtraPreTax?: number | null; defaultGstBps?: number }): WeightCalc | null {
  const booked = Math.round(a.bookedGrams), revised = Math.round(a.revisedGrams);
  if (!(booked > 0) || !(revised > booked)) return null;
  const markupBps = Math.max(0, Math.round(a.priced.markup?.bps ?? 0));
  const gstBps = Math.max(0, Math.round(a.priced.gstBps ?? a.defaultGstBps ?? 1800));
  const src = a.priced.lines?.length
    ? a.priced.lines
    : [{ code: "freight", label: "Base freight", costPreTax: a.priced.costPreTax ?? 0, markupEligible: true }];
  const lines = src.map((l) => ({ code: l.code, label: l.label ?? l.code, markupEligible: !!l.markupEligible, beforeCost: Math.round(l.costPreTax), afterCost: Math.round(l.costPreTax) }));
  if (!lines.some((l) => l.beforeCost > 0)) return null;

  // Re-rate the weight-driven lines at the booking rate.
  const driven = lines.filter((l) => WEIGHT_DRIVEN.has(l.code) && l.beforeCost > 0);
  const rerate = driven.length ? driven : [lines.find((l) => l.beforeCost > 0)!];
  for (const l of rerate) l.afterCost = mulDivRound(l.beforeCost, revised, booked);
  const reratedExtra = rerate.reduce((t, l) => t + l.afterCost - l.beforeCost, 0);

  let basis: WeightCalc["basis"] = "rerated";
  const courier = a.courierExtraPreTax != null && Number.isFinite(a.courierExtraPreTax) ? Math.round(a.courierExtraPreTax) : null;
  if (courier != null && courier > 0) {
    // Courier's real extra amount, split over the same lines in the re-rated proportion (last line absorbs rounding).
    basis = "courier";
    let left = courier;
    rerate.forEach((l, i) => {
      const share = i === rerate.length - 1 ? left : reratedExtra > 0 ? mulDivRound(courier, l.afterCost - l.beforeCost, reratedExtra) : 0;
      l.afterCost = l.beforeCost + share;
      left -= share;
    });
  }

  const sum = (k: "beforeCost" | "afterCost", elig: boolean) => lines.filter((l) => l.markupEligible === elig).reduce((t, l) => t + l[k], 0);
  const before = price(sum("beforeCost", true), sum("beforeCost", false), markupBps, gstBps);
  const after = price(sum("afterCost", true), sum("afterCost", false), markupBps, gstBps);
  const chargePaise = after.total - before.total;
  if (chargePaise <= 0) return null;
  return { bookedGrams: booked, revisedGrams: revised, markupBps, gstBps, basis, before, after, extraCostPreTax: after.costPreTax - before.costPreTax, chargePaise, lines };
}
