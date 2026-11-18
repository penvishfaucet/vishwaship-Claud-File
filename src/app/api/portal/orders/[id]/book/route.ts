import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { bookOrder } from "@/server/booking/service";
import { apiError, parseJson } from "@/server/http";

const STATUS: Record<string, number> = { not_found: 404, quote_expired: 409, quote_mismatch: 409, price_changed: 409, insufficient_balance: 402, cod_hold: 409, already_booked: 409, provider_failed: 502, ambiguous: 202, unsupported: 422 };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const p = await parseJson(req, z.object({ quoteId: z.string().min(1) }));
  if (!p.ok) return p.res;
  const r = await bookOrder({ orgId: s.orgId, orderId: id, quoteId: p.data.quoteId, actorUserId: s.userId });
  if (r.ok) return NextResponse.json(r, { status: 201 });
  const extra = r.code === "price_changed" ? { newQuoteId: r.newQuoteId, oldTotal: r.oldTotal, newTotal: r.newTotal } : {};
  return NextResponse.json({ error: { code: r.code, message: r.message, ...extra } }, { status: STATUS[r.code] ?? 400 });
}
