import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { ProductInput, saveProduct } from "@/server/store/catalog";

export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, ProductInput); if (!p.ok) return p.res;
  return run(async () => {
    const r = await saveProduct(g.s.orgId, p.data);
    await storeAudit(g.s, "product.create", r.id, { title: p.data.title });
    return { ok: true, ...r };
  });
}
