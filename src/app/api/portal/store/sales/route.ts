import { z } from "zod";
import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { SaleInput, deleteSale, saveSale } from "@/server/store/sales";

/** Create (no id) or update a sale event. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ id: z.string().max(60).optional(), sale: SaleInput })); if (!p.ok) return p.res;
  return run(async () => {
    const id = await saveSale(g.s.orgId, p.data.sale, p.data.id);
    await storeAudit(g.s, p.data.id ? "sale.update" : "sale.create", id, { name: p.data.sale.name, percentOff: p.data.sale.percentOff, scope: p.data.sale.scope });
    return { ok: true, id };
  });
}

export async function DELETE(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ id: z.string().max(60) })); if (!p.ok) return p.res;
  return run(async () => { await deleteSale(g.s.orgId, p.data.id); await storeAudit(g.s, "sale.delete", p.data.id); return { ok: true }; });
}
