import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/http";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { cancelStoreOrder, ensureShippingOrder, markRefunded } from "@/server/store/checkout";
import { acceptOrders, rejectOrders } from "@/server/store/ops";
import { storeOrderForOrg } from "@/server/store/orders";
import { startRefund } from "@/server/store/refunds";
import { ReturnError, decideReturn } from "@/server/store/returns";

/** accept | reject (reason required) | cancel | refund (retry at the gateway) | refunded (marked by hand) | ship (open the shipping order). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await storeGuard(); if (g.err) return g.err;
  const { id } = await ctx.params;
  const p = await parseJson(req, z.object({ action: z.enum(["accept", "reject", "cancel", "refund", "refunded", "ship", "return_approve", "return_reject", "return_complete"]), reason: z.string().max(300).default("") })); if (!p.ok) return p.res;
  const o = await storeOrderForOrg(g.s.orgId, id);
  if (!o) return fail("Order not found", 404);
  const a = p.data.action;
  if (a === "return_approve" || a === "return_reject" || a === "return_complete") {
    try {
      const r = await decideReturn(g.s.orgId, id, a === "return_approve" ? "approve" : a === "return_reject" ? "reject" : "complete", p.data.reason);
      await storeAudit(g.s, `order.${a}`, id, { number: o.number, status: r.status });
      return NextResponse.json({ ok: true, status: r.status });
    } catch (e) { if (e instanceof ReturnError) return fail(e.message); throw e; }
  }
  if (a === "ship") {
    if (o.status !== "placed" || o.acceptance !== "accepted") return fail("Accept the order first");
    const sid = await ensureShippingOrder(o.id);
    if (!sid) return fail("Could not prepare the shipment. Check the store's pickup warehouse in Store setup → Checkout.");
    return NextResponse.json({ ok: true, shippingOrderId: sid });
  }
  if (a === "accept" || a === "reject") {
    const [r] = a === "accept" ? await acceptOrders(g.s.orgId, g.s.userId, [id]) : await rejectOrders(g.s.orgId, g.s.userId, [id], p.data.reason);
    if (!r.ok) return fail(r.message);
    await storeAudit(g.s, `order.${a}`, id, { number: o.number, ...(a === "reject" ? { reason: p.data.reason } : {}) });
    return NextResponse.json({ ok: true, message: r.message, refund: "refund" in r ? r.refund : null });
  }
  if (a === "refund") {
    if (o.status !== "cancelled" || !["refund_due", "paid"].includes(o.paymentStatus)) return fail("Only cancelled, paid orders can be refunded");
    const r = await startRefund(o.id, g.s.userId);
    await storeAudit(g.s, "order.refund", id, { number: o.number, status: r?.status ?? null });
    return NextResponse.json({ ok: true, refund: r?.status ?? null, message: r?.message ?? "" });
  }
  if (a === "cancel" && p.data.reason.trim().length < 3) return fail("Give a reason for cancelling");
  const r = a === "cancel" ? await cancelStoreOrder(g.s.orgId, id, p.data.reason, g.s.userId) : await markRefunded(g.s.orgId, id);
  if (!r.ok) return fail(r.message);
  await storeAudit(g.s, `order.${a}`, id, { number: o.number });
  return NextResponse.json({ ok: true, refund: "refund" in r ? r.refund : null });
}
