import { NextResponse } from "next/server";
import { z } from "zod";
import { apiStaff } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { StoreError } from "@/server/store/catalog";
import { applyPackage, resolveCustomer, startPackageImport, uploadPackageMedia } from "@/server/store/package";

export const maxDuration = 300;

/**
 * Store package import, driven by the admin page in three steps so large packages go up in small requests:
 *  start (manifest) → media (batches of images, base64) → apply (manifest + image ids).
 */
const Body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("start"), customer: z.string().trim().min(3).max(120), slug: z.string().trim().max(40).default(""), manifest: z.unknown() }),
  z.object({ step: z.literal("media"), orgId: z.string().max(60), files: z.array(z.object({ name: z.string().max(140), base64: z.string().max(2_200_000) })).min(1).max(40) }),
  z.object({ step: z.literal("apply"), orgId: z.string().max(60), manifest: z.unknown(), media: z.record(z.string().max(140), z.string().max(60)) }),
]);

export async function POST(req: Request) {
  const s = await apiStaff("modules.manage");
  if (!s) return apiError(403, "forbidden", "Only the owner can import store packages");
  const p = await parseJson(req, Body); if (!p.ok) return p.res;
  const b = p.data;
  try {
    if (b.step === "start") {
      const orgId = await resolveCustomer(b.customer);
      if (!orgId) return apiError(404, "not_found", "No customer found with this ID, email or mobile");
      return NextResponse.json({ orgId, ...(await startPackageImport(orgId, s.userId, b.manifest, b.slug || undefined)) });
    }
    if (b.step === "media") {
      const total = b.files.reduce((n, f) => n + f.base64.length, 0);
      if (total > 8_000_000) return apiError(413, "validation_error", "Send fewer images per batch");
      return NextResponse.json({ media: await uploadPackageMedia(b.orgId, b.files.map((f) => ({ name: f.name, data: Buffer.from(f.base64, "base64") }))) });
    }
    return NextResponse.json(await applyPackage(b.orgId, s.userId, b.manifest, b.media));
  } catch (e) {
    if (e instanceof StoreError) return apiError(422, "validation_error", e.message);
    throw e;
  }
}
