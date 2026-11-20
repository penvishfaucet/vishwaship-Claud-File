import { and, eq } from "drizzle-orm";
import { hideProviders } from "@/server/customer-safe";
import { orgSetting } from "@/server/couriers";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { adapterFor, providerContext } from "@/server/providers/registry";
import { getSetting } from "@/server/quotes/service";
import { type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";

/**
 * GET /api/portal/shipments/:id/label[?format=…] — one shipment's label.
 * Goes through the same validated PDF path as bulk downloads (/api/portal/labels), in the customer's saved size.
 * Shipora X returns its label as a web page; that one is served sandboxed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments }).from(schema.shipments).where(and(eq(schema.shipments.id, id), eq(schema.shipments.orgId, s.orgId)));
  if (!row) return apiError(404, "not_found", "Shipment not found");
  if (!row.s.awb) return apiError(409, "conflict", "Label pending — the courier has not assigned the AWB / LRN yet. Try again in a few minutes.");
  const asked = new URL(req.url).searchParams.get("format");
  if (row.s.provider === "shiporax" && (!asked || asked === "original")) {
    const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, row.s.providerAccountId));
    const ad = acct && adapterFor(acct);
    if (ad) {
      const r = await ad.label(await providerContext(acct), { providerOrderRef: row.s.providerOrderRef ?? row.s.id, awb: row.s.awb }, "thermal_4x6");
      if (r.ok && r.value.html) return new Response(hideProviders(r.value.html).replace(/courier partner/gi, ""), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "content-security-policy": "sandbox allow-scripts allow-modals allow-downloads", "x-content-type-options": "nosniff" } });
    }
  }
  const own = (await orgSetting<{ format?: string }>(s.orgId, "label_settings"))?.format;
  const adminDefault = (await getSetting<PrintFormat>("orders_label_default", "a4_fit")).value;
  const pick = [asked, own, adminDefault, "thermal_4x6"].find((f) => f && PRINT_FORMATS.some((p) => p.key === f))!;
  return Response.redirect(new URL(`/api/portal/labels?ids=${encodeURIComponent(id)}&format=${pick}`, req.url), 302);
}
