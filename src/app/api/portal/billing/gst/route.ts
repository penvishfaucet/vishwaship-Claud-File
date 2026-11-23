import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { presetRange, istFrom, istTo, type PresetKey } from "@/lib/gst";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { caPack, workbook } from "@/server/gst/pack";
import { XLSX_TYPE } from "@/server/xlsx";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

/** GET ?preset=…&from=&to=&format=zip|xlsx — the customer's CA pack for the period (own documents only). */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await rateLimit(`gst-pack:${s.orgId}:${clientIp(req)}`, 20, 600)).ok) return apiError(429, "rate_limited", "Too many downloads. Please wait a few minutes.");
  const u = new URL(req.url);
  const r = presetRange((u.searchParams.get("preset") ?? "custom") as PresetKey, new Date(), { from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined });
  const from = istFrom(r.from), to = istTo(r.to);
  if (to.getTime() - from.getTime() > 400 * 86400_000) return apiError(422, "validation_error", "Choose a period of up to one financial year");
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "billing.gst_pack", details: { from: r.from, to: r.to, format: u.searchParams.get("format") ?? "zip" } });
  if (u.searchParams.get("format") === "xlsx") {
    const { buffer } = await workbook(s.orgId, from, to, "Vishwaship Purchase and GST Reconciliation Pack");
    return new Response(new Uint8Array(buffer), { headers: { "content-type": XLSX_TYPE, "content-disposition": `attachment; filename="Vishwaship_GST_${r.from}_${r.to}.xlsx"`, "cache-control": "no-store" } });
  }
  const pack = await caPack(s.orgId, from, to);
  return new Response(new Uint8Array(pack.data), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${pack.name}"`, "cache-control": "no-store" } });
}
