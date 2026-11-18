import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { sniffProof } from "@/server/payments/files";
import { submitManual } from "@/server/payments/recharge";
import { getPaymentSettings } from "@/server/payments/settings";
import { rateLimit } from "@/server/security/rate-limit";
import { newKey, putPrivate } from "@/server/storage";
import { formatINR } from "@/lib/money";
import { manualQuote, normaliseUtr, validUtr } from "@/lib/recharge";

/**
 * "I Have Paid — Submit Recharge Request" (multipart): amountRupees, utr, paidAt (ISO), paidRupees, remarks, file.
 * Discount and payable are recomputed here from the current Admin setting and stored with the request.
 * Creates a Pending Verification request + linked ticket; never credits the wallet.
 */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const rl = await rateLimit(`rcmanual:${s.orgId}`, 8, 3600);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many recharge requests — please wait and try again");
  const settings = await getPaymentSettings();
  const m = settings.manual;
  if (!m.enabled || !m.upiId) return apiError(422, "validation_error", "Manual UPI recharge is not available right now");
  let fd: FormData;
  try { fd = await req.formData(); } catch { return apiError(422, "validation_error", "Invalid form"); }
  const rupees = Number(fd.get("amountRupees"));
  if (!Number.isInteger(rupees) || rupees <= 0) return apiError(422, "validation_error", "Enter the recharge amount in whole rupees");
  const rechargePaise = rupees * 100;
  if (rechargePaise < m.minPaise || rechargePaise > m.maxPaise) return apiError(422, "validation_error", `Manual recharge must be between ${formatINR(m.minPaise)} and ${formatINR(m.maxPaise)}`);
  const utr = normaliseUtr(String(fd.get("utr") ?? ""));
  if (!validUtr(utr)) return apiError(422, "validation_error", "Enter the UPI transaction reference / UTR (6–30 letters or digits)");
  const paidAt = new Date(String(fd.get("paidAt") ?? ""));
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 10 * 60_000 || paidAt.getTime() < Date.now() - 30 * 86400_000) return apiError(422, "validation_error", "Enter the payment date and time (within the last 30 days)");
  const paidRupees = Number(fd.get("paidRupees"));
  if (!Number.isFinite(paidRupees) || paidRupees <= 0 || paidRupees > 10_000_000) return apiError(422, "validation_error", "Enter the amount you paid");
  const reportedPaidPaise = Math.round(paidRupees * 100);
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return apiError(422, "validation_error", "Upload the payment screenshot");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniffProof(buf);
  if (!kind) return apiError(422, "validation_error", "Screenshot must be a JPG, PNG, WebP or PDF up to 5 MB");
  const q = manualQuote(rechargePaise, m.discountBps);
  const key = newKey(`recharge-proofs/${s.orgId}`, kind.ext);
  await putPrivate(key, buf);
  const r = await submitManual({
    orgId: s.orgId, userId: s.userId, rechargePaise, discountBps: m.discountBps, reportedPaidPaise, utr, paidAt,
    remarks: String(fd.get("remarks") ?? "").trim().slice(0, 500), proof: { key, name: file.name || `screenshot.${kind.ext}`, mime: kind.mime },
  });
  return NextResponse.json({
    id: r.id, requestNumber: r.number, ticketId: r.ticketId, ticketNumber: r.ticketNumber,
    creditPaise: q.creditPaise, discountPaise: q.discountPaise, payablePaise: q.payablePaise, reportedPaidPaise,
    paidDiffers: reportedPaidPaise !== q.payablePaise, message: m.reviewMessage,
  });
}
