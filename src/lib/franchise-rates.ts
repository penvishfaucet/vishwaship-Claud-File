import { mulDivRound, pctOf, type Bps, type Paise } from "@/lib/money";

/** Default margin on the Franchise Rate List page, added on top of the standard public price (10%). */
export const DEFAULT_FRANCHISE_MARGIN_BPS = 1000;

export const FRANCHISE_ZONES = [
  { code: "A", label: "Local", hint: "Within the same city" },
  { code: "B", label: "Regional", hint: "Within the state / region" },
  { code: "C", label: "Metro", hint: "Metro to metro" },
  { code: "D", label: "Rest of India", hint: "Rest of India" },
  { code: "E", label: "NE / J&K", hint: "North-East, J&K & special areas" },
] as const;

export interface CardService { name: string; eta: string; first500Paise: number[]; addl500Paise: number[] }

/** Base (pre-margin, pre-GST) zone rates; the old vishwaship.com rate card. Editable in Admin → Franchise Rate List. */
export const DEFAULT_FRANCHISE_CARD: CardService[] = [
  { name: "Surface", eta: "3–5 days", first500Paise: [3900, 4600, 5600, 7000, 8400], addl500Paise: [3400, 4100, 4800, 6000, 7500] },
  { name: "Express", eta: "1–2 days", first500Paise: [5400, 7200, 8700, 11100, 13200], addl500Paise: [4800, 6600, 7700, 10100, 11800] },
];

export interface MarginInput {
  lines: Array<{ code: string; label: string; sellPreTax: Paise }>;
  sellingSubtotal: Paise;
  gst: Paise;
  total: Paise;
  payer?: { sender: Paise; receiver: Paise };
}

/**
 * Adds the margin to every pre-tax line (freight, fuel, COD charge …). GST is scaled with the subtotal so
 * the offer keeps its own GST rate; who-pays (sender / receiver for FOD) is split in the same proportion.
 * Display only: bookings are always priced from the customer's own quote.
 */
export function addMargin<T extends MarginInput>(offer: T, marginBps: Bps): T {
  const lines = offer.lines.map((l) => ({ ...l, sellPreTax: l.sellPreTax + pctOf(l.sellPreTax, marginBps) }));
  const sellingSubtotal = lines.reduce((s, l) => s + l.sellPreTax, 0);
  const gst = offer.sellingSubtotal > 0 ? mulDivRound(offer.gst, sellingSubtotal, offer.sellingSubtotal) : 0;
  const total = sellingSubtotal + gst;
  const out: T = { ...offer, lines, sellingSubtotal, gst, total };
  if (offer.payer) {
    const receiver = offer.total > 0 ? mulDivRound(offer.payer.receiver, total, offer.total) : 0;
    out.payer = { sender: total - receiver, receiver };
  }
  return out;
}

/** Margin on a rate-card amount (paise), rounded to the whole rupee. */
export function cardWithMargin(paise: Paise, marginBps: Bps): Paise {
  return Math.round((paise + pctOf(paise, marginBps)) / 100) * 100;
}
