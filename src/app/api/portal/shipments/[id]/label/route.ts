import { orgSetting } from "@/server/couriers";
import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { getAdapter, providerContext } from "@/server/providers/registry";
import type { LabelFormat } from "@/server/providers/types";
import { code128Svg } from "@/lib/code128";
import { formatINR } from "@/lib/money";

const SIZES: Record<LabelFormat, { w: string; h: string; name: string }> = {
  a4: { w: "210mm", h: "297mm", name: "A4" }, thermal_4x6: { w: "4in", h: "6in", name: "4×6 in" }, thermal_3x4: { w: "3in", h: "4in", name: "3×4 in" },
  thermal_4x4: { w: "4in", h: "4in", name: "4×4 in" }, thermal_2x4: { w: "2in", h: "4in", name: "2×4 in" }, thermal_38x100: { w: "38mm", h: "100mm", name: "38×100 mm" },
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const asked = new URL(req.url).searchParams.get("format");
  const pref = asked ? null : await orgSetting<{ format?: LabelFormat }>(s.orgId, "label_settings");
  const format = (asked ?? pref?.format ?? "thermal_4x6") as LabelFormat;
  if (!SIZES[format]) return apiError(422, "validation_error", "Unknown label format");
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders, w: schema.warehouses }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).leftJoin(schema.warehouses, eq(schema.warehouses.id, schema.orders.warehouseId))
    .where(and(eq(schema.shipments.id, id), eq(schema.shipments.orgId, s.orgId)));
  if (!row || !row.s.awb) return apiError(404, "not_found", "Label not available");

  // Live carriers: return the carrier-approved label document from the provider.
  if (row.s.provider !== "demo") {
    const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, row.s.providerAccountId));
    const ad = acct && getAdapter(acct.adapter);
    if (!ad) return apiError(422, "provider_error", "Adapter required");
    const r = await ad.label(await providerContext(acct), { providerOrderRef: row.s.providerOrderRef!, awb: row.s.awb }, format);
    if (!r.ok) return apiError(422, "provider_error", r.error.message);
    if (!r.value.formatsAvailable.includes(format)) return apiError(422, "validation_error", `${row.s.carrierName} does not provide ${SIZES[format].name} labels. Available: ${r.value.formatsAvailable.join(", ")}`);
    if (r.value.pdf) return new Response(Buffer.from(r.value.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${row.s.awb}.pdf"` } });
    if (r.value.url) return Response.redirect(r.value.url, 302);
  }

  const snap = row.o.pickupSnapshot as { label: string; line1: string; city: string; pincode: string } | null;
  const pw = snap ?? row.w;
  const c = row.o.consignee as { name: string; line1: string; line2?: string; city: string; state: string; pincode: string; mobile: string };
  const small = format === "thermal_2x4" || format === "thermal_38x100";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Label ${esc(row.s.awb)}</title>
<style>@page{size:${SIZES[format].w} ${SIZES[format].h};margin:0}*{box-sizing:border-box}body{margin:0;font:${small ? 8 : 11}px/1.3 Arial,sans-serif;color:#000}
.l{width:${SIZES[format].w};height:${SIZES[format].h};padding:${small ? "2mm" : "4mm"};display:flex;flex-direction:column;gap:${small ? "1mm" : "2mm"};overflow:hidden}
.r{display:flex;justify-content:space-between;gap:2mm}.b{font-weight:700}.box{border:1px solid #000;padding:${small ? "1mm" : "2mm"}}.bc svg{width:100%;height:${small ? "12mm" : "18mm"}}
.demo{border:2px dashed #000;text-align:center;font-weight:700;padding:1mm}.h{font-size:${small ? 10 : 15}px}@media screen{body{background:#eee;padding:10px}.l{background:#fff;margin:auto}}</style></head>
<body onload="window.print()"><div class="l">
${row.s.provider === "demo" ? `<div class="demo">DEMO LABEL — NOT VALID FOR CARRIER HANDOVER</div>` : ""}
<div class="r"><span class="b h">${esc(row.s.carrierName)}</span><span class="b">${esc(row.o.mode)} · ${row.o.paymentType === "cod" ? `COD ${esc(formatINR(row.o.codAmountPaise))}` : "PREPAID"}</span></div>
<div class="bc">${code128Svg(row.s.awb)}</div><div class="b" style="text-align:center">${esc(row.s.awb)}</div>
<div class="box"><div class="b">Deliver to</div>${esc(c.name)}<br>${esc(c.line1)}${c.line2 ? ", " + esc(c.line2) : ""}<br>${esc(c.city)}, ${esc(c.state)} <b>${esc(c.pincode)}</b>${small ? "" : `<br>Ph: ${esc(c.mobile)}`}</div>
${small ? "" : `<div class="box"><div class="b">Return / pickup</div>${esc(pw?.label)}, ${esc(pw?.line1)}, ${esc(pw?.city)} ${esc(pw?.pincode)}</div>`}
<div class="r"><span>Order ${esc(row.o.orderNumber)}</span><span>${(row.s.chargeableWeightGrams / 1000).toFixed(2)} kg</span></div>
${small ? "" : `<div class="bc">${code128Svg(row.o.orderNumber)}</div>`}
</div></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
