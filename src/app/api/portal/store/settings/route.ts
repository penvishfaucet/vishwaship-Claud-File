import { NextResponse } from "next/server";
import { z } from "zod";
import { StoreSettings } from "@/lib/store-themes";
import { parseJson } from "@/server/http";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { saveSettings } from "@/server/store/service";

/** Save part of the store settings (pages, contact, SEO, checkout basics). `step` marks an onboarding step done. */
export async function PUT(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ patch: StoreSettings.partial(), step: z.number().int().min(1).max(7).optional() })); if (!p.ok) return p.res;
  const ck = p.data.patch.checkout;
  if (ck && ck.codMaxPaise > 0 && ck.codMinPaise > ck.codMaxPaise) return fail("COD minimum can't be more than the maximum");
  const r = await saveSettings(g.s.orgId, p.data.patch, p.data.step);
  if (!r.ok) return fail(r.message);
  await storeAudit(g.s, "settings", undefined, { sections: Object.keys(p.data.patch) });
  return NextResponse.json({ ok: true });
}
