import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { newId } from "@/server/util/ids";

/** Accepted by content (magic bytes), never by the browser-supplied type. SVG is excluded (can carry script). */
const TYPES: Array<{ mime: string; kind: "image" | "video"; max: number; test: (b: Buffer) => boolean }> = [
  { mime: "image/png", kind: "image", max: 3 << 20, test: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { mime: "image/jpeg", kind: "image", max: 3 << 20, test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", kind: "image", max: 3 << 20, test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mime: "video/webm", kind: "video", max: 20 << 20, test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { mime: "video/mp4", kind: "video", max: 20 << 20, test: (b) => b.subarray(4, 8).toString() === "ftyp" },
];

export async function POST(req: Request) {
  const s = await apiStaff("content.write");
  if (!s) return apiError(403, "forbidden", "You cannot edit website content");
  let fd: FormData;
  try { fd = await req.formData(); } catch { return apiError(400, "validation_error", "Send the file as form data"); }
  const file = fd.get("file");
  if (!(file instanceof Blob) || file.size === 0) return apiError(422, "validation_error", "Choose a file to upload");
  if (file.size > 20 << 20) return apiError(422, "validation_error", "File is too large (max 20 MB for video, 3 MB for images)");
  const buf = Buffer.from(await file.arrayBuffer());
  const t = TYPES.find((x) => x.test(buf));
  if (!t) return apiError(422, "validation_error", "Use a PNG, JPG or WebP image, or an MP4/WebM video");
  if (buf.length > t.max) return apiError(422, "validation_error", t.kind === "image" ? "Images must be 3 MB or smaller" : "Videos must be 20 MB or smaller");
  const id = newId("sa", 20); // sa_<time><random>, matched by /api/site-assets/[id]
  const name = (fd.get("name")?.toString() ?? (file as File).name ?? "").slice(0, 120) || null;
  const db = await getDb();
  await db.insert(schema.siteAssets).values({ id, kind: t.kind, mime: t.mime, sizeBytes: buf.length, name, data: buf, createdBy: s.userId });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "site.asset_upload", targetType: "site_asset", targetId: id, details: { mime: t.mime, size: buf.length } });
  return NextResponse.json({ ok: true, id, url: `/api/site-assets/${id}`, kind: t.kind, mime: t.mime });
}
