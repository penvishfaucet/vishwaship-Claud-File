import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { getPrivate, verifyLink } from "@/server/storage";

/** Serves private documents only with a valid short-lived signature AND a staff session allowed to read KYC. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "", exp = u.searchParams.get("exp") ?? "", sig = u.searchParams.get("sig") ?? "";
  if (!verifyLink(key, exp, sig)) return apiError(403, "forbidden", "Link expired or invalid");
  const s = await apiStaff("kyc.documents.read");
  if (!s) return apiError(403, "forbidden", "Not allowed");
  const buf = await getPrivate(key);
  const type = key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".png") ? "image/png" : "image/jpeg";
  return new Response(new Uint8Array(buf), { headers: { "content-type": type, "cache-control": "private, no-store", "content-disposition": "inline", "x-content-type-options": "nosniff" } });
}
