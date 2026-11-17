import { NextResponse } from "next/server";
import { apiKeyAuth, v1Error } from "@/server/api/auth";
import { QuoteInput, toQuoteRequest } from "@/server/quotes/input";
import { getQuotes } from "@/server/quotes/service";

/** POST /api/v1/quotes — same engine + org markup as the portal (parity). */
export async function POST(req: Request) {
  const a = await apiKeyAuth(req, "quotes:read");
  if (!a.ok) return a.res;
  let body: unknown;
  try { body = await req.json(); } catch { return v1Error(400, "validation_error", "Body must be JSON"); }
  const p = QuoteInput.safeParse(body);
  if (!p.success) return NextResponse.json({ error: { code: "validation_error", message: "Invalid request", issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, { status: 422 });
  const { offers } = await getQuotes(toQuoteRequest(p.data), a.orgId);
  return NextResponse.json({
    data: offers.map((o) => ({
      quote_id: o.quoteId, carrier: { code: o.carrierCode, name: o.carrierName }, service: o.serviceName, shipment_type: o.mode,
      eta_days: o.etaDays ?? null, chargeable_weight_grams: o.chargeableWeightGrams,
      charges: o.lines.map((l) => ({ code: l.code, label: l.label, amount_paise: l.sellPreTax })),
      subtotal_paise: o.sellingSubtotal, gst_paise: o.gst, total_paise: o.total, currency: "INR", expires_at: o.expiresAt, sandbox: o.isDemo,
    })),
  });
}
