import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { findManifest, serveSigned, storeSigned } from "@/server/manifests/files";

/** The signed copy (photo / scan) of this account's manifest. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const m = await findManifest((await params).id, s.orgId);
  return m ? serveSigned(m) : apiError(404, "not_found", "Manifest not found");
}

/** Upload Signed Copy (multipart "file"). Does not change any shipment or pickup status. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const m = await findManifest((await params).id, s.orgId);
  if (!m) return apiError(404, "not_found", "Manifest not found");
  const fd = await req.formData().catch(() => null);
  const f = fd?.get("file");
  if (!f || typeof f === "string" || !(f as File).size) return apiError(422, "validation_error", "Choose the signed copy to upload");
  const r = await storeSigned(m, f as File);
  if (!r.ok) return apiError(415, "validation_error", r.message);
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "manifest.signed_upload", targetType: "manifest", targetId: m.id, details: { manifestNo: m.manifestNo, size: r.signed.size } });
  return NextResponse.json({ ok: true, uploadedAt: r.signed.uploadedAt });
}
