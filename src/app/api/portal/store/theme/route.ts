import { NextResponse } from "next/server";
import { z } from "zod";
import { ThemeConfig } from "@/lib/store-themes";
import { parseJson } from "@/server/http";
import { fail, run, storeAudit, storeGuard } from "@/server/store/api";
import { markStep, publishStore, restoreVersion, saveDraftTheme, unpublishStore } from "@/server/store/service";

/** Save the draft theme (the live store does not change until Publish). */
export async function PUT(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ themeKey: z.string().max(30), config: ThemeConfig, completeStep: z.boolean().optional() })); if (!p.ok) return p.res;
  return run(async () => {
    const r = await saveDraftTheme(g.s.orgId, p.data.themeKey, p.data.config);
    if (!r.ok) throw new (await import("@/server/store/catalog")).StoreError(r.message);
    if (p.data.completeStep) await markStep(g.s.orgId, 2);
    return { ok: true };
  });
}

/** publish | unpublish | restore a published version into the draft. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ action: z.enum(["publish", "unpublish", "restore"]), versionId: z.string().max(60).optional(), note: z.string().max(140).optional() })); if (!p.ok) return p.res;
  if (p.data.action === "publish") {
    const r = await publishStore(g.s.orgId, g.s.userId, p.data.note);
    if (!r.ok) return fail(r.message);
    await storeAudit(g.s, "publish", undefined, { version: r.version });
    return NextResponse.json(r);
  }
  if (p.data.action === "unpublish") {
    const r = await unpublishStore(g.s.orgId);
    if (!r.ok) return fail(r.message);
    await storeAudit(g.s, "unpublish");
    return NextResponse.json(r);
  }
  if (!p.data.versionId) return fail("Choose a version");
  const r = await restoreVersion(g.s.orgId, p.data.versionId);
  if (!r.ok) return fail(r.message, 404);
  await storeAudit(g.s, "restore_version", p.data.versionId, { version: r.version });
  return NextResponse.json(r);
}
