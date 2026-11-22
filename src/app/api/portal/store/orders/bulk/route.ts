import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/http";
import { storeAudit, storeGuard } from "@/server/store/api";
import { acceptOrders, rejectOrders } from "@/server/store/ops";

/** Bulk accept / reject. Every order gets its own result; one problem never stops the others. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ action: z.enum(["accept", "reject"]), ids: z.array(z.string().max(60)).min(1).max(200), reason: z.string().max(300).default("") })); if (!p.ok) return p.res;
  const results = p.data.action === "accept" ? await acceptOrders(g.s.orgId, g.s.userId, p.data.ids) : await rejectOrders(g.s.orgId, g.s.userId, p.data.ids, p.data.reason);
  await storeAudit(g.s, `orders.bulk_${p.data.action}`, undefined, { done: results.filter((r) => r.ok).map((r) => r.number), failed: results.filter((r) => !r.ok).map((r) => r.number) });
  return NextResponse.json({ ok: true, results });
}
