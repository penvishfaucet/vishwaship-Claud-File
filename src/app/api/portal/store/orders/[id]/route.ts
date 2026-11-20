import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/http";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { cancelStoreOrder, ensureShippingOrder, markRefunded } from "@/server/store/checkout";
import { storeOrderForOrg } from "@/server/store/orders";

/** cancel | refunded | ship (make sure the shipping order exists, then open it to book a courier). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await storeGuard(); if (g.err) return g.err;
  const { id } = await ctx.params;
  const p = await parseJson(req, z.object({ action: z.enum(["cancel", "refunded", "ship"]), reason: z.string().max(300).default("") })); if (!p.ok) return p.res;
  const o = await storeOrderForOrg(g.s.orgId, id);
  if (!o) return fail("Order not found", 404);
  if (p.data.action === "ship") {
    if (o.status !== "placed") return fail("Only placed orders can be shipped");
    const sid = await ensureShippingOrder(o.id);
    if (!sid) return fail("Could not prepare the shipment. Check the store's pickup warehouse in Store setup → Checkout.");
    return NextResponse.json({ ok: true, shippingOrderId: sid });
  }
  const r = p.data.action === "cancel" ? await cancelStoreOrder(g.s.orgId, id, p.data.reason) : await markRefunded(g.s.orgId, id);
  if (!r.ok) return fail(r.message);
  await storeAudit(g.s, `order.${p.data.action}`, id, { number: o.number });
  return NextResponse.json({ ok: true });
}
