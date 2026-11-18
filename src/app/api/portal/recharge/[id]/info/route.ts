import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { sniffProof } from "@/server/payments/files";
import { provideInfo } from "@/server/payments/recharge";
import { rateLimit } from "@/server/security/rate-limit";
import { newKey, putPrivate } from "@/server/storage";

/** Customer answers "More Information Required" (message + optional new screenshot). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  if (!(await rateLimit(`rcinfo:${id}`, 10, 3600)).ok) return apiError(429, "rate_limited", "Too many updates — please wait");
  let fd: FormData;
  try { fd = await req.formData(); } catch { return apiError(422, "validation_error", "Invalid form"); }
  const message = String(fd.get("message") ?? "").slice(0, 2000);
  let proof: { key: string; name: string; mime: string } | undefined;
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniffProof(buf);
    if (!kind) return apiError(422, "validation_error", "Screenshot must be a JPG, PNG, WebP or PDF up to 5 MB");
    const key = newKey(`recharge-proofs/${s.orgId}`, kind.ext);
    await putPrivate(key, buf);
    proof = { key, name: file.name || `screenshot.${kind.ext}`, mime: kind.mime };
  }
  const r = await provideInfo({ id, orgId: s.orgId, userId: s.userId, message, proof });
  return r.ok ? NextResponse.json(r) : apiError(422, "validation_error", r.message);
}
