import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { newKey, putPrivate, sniffUpload } from "@/server/storage";
import { newId } from "@/server/util/ids";

const RULES: Record<string, RegExp> = {
  pan: /^[A-Z]{5}\d{4}[A-Z]$/, aadhaar: /^\d{12}$/, cancelled_cheque: /^\d{9,18}$/, gst_certificate: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
};
const mask = (s: string) => `${"•".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const rl = await rateLimit(`kyc:${s.orgId}`, 20, 3600);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many uploads");
  const fd = await req.formData();
  const docType = String(fd.get("docType") ?? "");
  const number = String(fd.get("number") ?? "").replace(/\s/g, "").toUpperCase();
  const file = fd.get("file");
  if (!RULES[docType]) return apiError(422, "validation_error", "Unknown document type");
  if (!RULES[docType].test(number)) return apiError(422, "validation_error", "Number format is invalid");
  if (!(file instanceof File)) return apiError(422, "validation_error", "Choose a file");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniffUpload(buf);
  if (!kind) return apiError(422, "validation_error", "Only PDF, JPG or PNG files up to 5 MB are accepted");
  const key = newKey(`kyc/${s.orgId}`, kind.ext);
  await putPrivate(key, buf);
  const db = await getDb();
  await db.insert(schema.kycDocuments).values({ id: newId("kyc"), orgId: s.orgId, docType, storageKey: key, mime: kind.mime, sizeBytes: buf.length, maskedNumber: mask(number), status: "pending" });
  if (docType === "cancelled_cheque") await db.update(schema.orgs).set({ bankAccountMasked: mask(number), bankIfsc: String(fd.get("ifsc") ?? "").toUpperCase() }).where(eq(schema.orgs.id, s.orgId));
  await db.update(schema.orgs).set({ kycStatus: "pending" }).where(eq(schema.orgs.id, s.orgId));
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "kyc.upload", details: { docType } });
  return NextResponse.json({ ok: true }, { status: 201 });
}
