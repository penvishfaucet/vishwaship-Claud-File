import { apiCustomer, apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { fileResponse } from "@/server/payments/files";
import { getPaymentSettings } from "@/server/payments/settings";
import { getPrivate } from "@/server/storage";

/** Manual UPI QR image for signed-in customers (and staff previewing settings). ?download=1 saves it. */
export async function GET(req: Request) {
  const s = (await apiCustomer()) ?? (await apiStaff());
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const m = (await getPaymentSettings()).manual;
  if (!m.qrKey || (!m.enabled && s.kind !== "staff")) return apiError(404, "not_found", "No QR code available");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return fileResponse(await getPrivate(m.qrKey), m.qrMime || "image/png", `vishwaship-upi-qr.${m.qrMime === "image/jpeg" ? "jpg" : m.qrMime === "image/webp" ? "webp" : "png"}`, download);
}
