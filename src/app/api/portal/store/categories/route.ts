import { z } from "zod";
import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { addCategory, deleteCategory } from "@/server/store/catalog";

export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ name: z.string().max(60) })); if (!p.ok) return p.res;
  return run(async () => { const id = await addCategory(g.s.orgId, p.data.name); await storeAudit(g.s, "category.create", id); return { ok: true, id }; });
}

export async function DELETE(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return run(async () => { await deleteCategory(g.s.orgId, id); await storeAudit(g.s, "category.delete", id); return { ok: true }; });
}
