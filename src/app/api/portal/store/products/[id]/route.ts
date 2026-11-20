import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { ProductInput, archiveProduct, saveProduct } from "@/server/store/catalog";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const g = await storeGuard(); if (g.err) return g.err;
  const { id } = await ctx.params;
  const p = await parseJson(req, ProductInput); if (!p.ok) return p.res;
  return run(async () => {
    const r = await saveProduct(g.s.orgId, p.data, id);
    await storeAudit(g.s, "product.update", id);
    return { ok: true, ...r };
  });
}

/** Archive (never hard-deletes, so past orders keep their product). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await storeGuard(); if (g.err) return g.err;
  const { id } = await ctx.params;
  return run(async () => { await archiveProduct(g.s.orgId, id); await storeAudit(g.s, "product.archive", id); return { ok: true }; });
}
