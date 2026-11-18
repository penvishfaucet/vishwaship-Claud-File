import { z } from "zod";
import { apiKeyAuth, withIdempotency } from "@/server/api/auth";
import { bookOrder } from "@/server/booking/service";

const STATUS: Record<string, number> = { not_found: 404, quote_expired: 409, quote_mismatch: 409, price_changed: 409, insufficient_balance: 402, cod_hold: 409, already_booked: 409, provider_failed: 502, ambiguous: 202, unsupported: 422 };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await apiKeyAuth(req, "shipments:write");
  if (!a.ok) return a.res;
  const { id } = await params;
  const raw = await req.text();
  return withIdempotency(req, a.orgId, a.keyId, raw, async () => {
    const p = z.object({ quote_id: z.string() }).safeParse(JSON.parse(raw || "{}"));
    if (!p.success) return { status: 422, body: { error: { code: "validation_error", message: "quote_id is required" } } };
    const r = await bookOrder({ orgId: a.orgId, orderId: id, quoteId: p.data.quote_id, actorUserId: `api:${a.keyId}` });
    if (r.ok) return { status: 201, body: { data: { shipment_id: r.shipmentId, awb: r.awb, booking_state: r.state } } };
    return { status: STATUS[r.code] ?? 400, body: { error: { code: r.code, message: r.message, ...(r.code === "price_changed" ? { new_quote_id: r.newQuoteId, old_total_paise: r.oldTotal, new_total_paise: r.newTotal } : {}) } } };
  });
}
