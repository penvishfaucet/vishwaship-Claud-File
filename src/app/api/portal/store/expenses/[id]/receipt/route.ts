import { apiError } from "@/server/http";
import { storeGuard } from "@/server/store/api";
import { expenseReceipt } from "@/server/store/expenses";

/** The receipt of one expense, only for the account that added it. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await storeGuard(); if (g.err) return g.err;
  const { id } = await ctx.params;
  const r = await expenseReceipt(g.s.orgId, id);
  if (!r) return apiError(404, "not_found", "No receipt");
  return new Response(new Uint8Array(r.data), { headers: { "content-type": r.mime, "content-disposition": "inline", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
