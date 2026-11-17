import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { toCsv } from "@/lib/csv";

const r2 = (p: number) => (p / 100).toFixed(2);

export async function GET(req: Request) {
  const s = await apiStaff("reports.export");
  if (!s) return apiError(403, "forbidden", "Not allowed");
  const u = new URL(req.url);
  const conds: SQL[] = [];
  if (u.searchParams.get("org")) conds.push(eq(schema.shipments.orgId, u.searchParams.get("org")!));
  if (u.searchParams.get("provider")) conds.push(eq(schema.shipments.provider, u.searchParams.get("provider")!));
  if (u.searchParams.get("from")) conds.push(gte(schema.shipments.createdAt, new Date(`${u.searchParams.get("from")}T00:00:00+05:30`)));
  if (u.searchParams.get("to")) conds.push(lte(schema.shipments.createdAt, new Date(`${u.searchParams.get("to")}T23:59:59.999+05:30`)));
  const db = await getDb();
  const rows = await db.select({ s: schema.shipments, o: schema.orders, org: schema.orgs, q: schema.quotes }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .leftJoin(schema.quotes, eq(schema.quotes.id, schema.shipments.quoteId)).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.shipments.createdAt));
  const cost = can(s.role, "shipments.cost.read");
  const headers = ["Date (IST)", "Customer", "Order", "AWB/LR", "Provider", "Carrier", "Type", "Payment", "Status", "Chargeable kg", "Selling incl. GST (INR)", ...(cost ? ["Carrier cost pre-tax (INR)", "Selling pre-tax (INR)", "Margin pre-tax (INR)", "Markup %", "Rule version"] : [])];
  let tSell = 0, tCost = 0, tSub = 0;
  const data = rows.map(({ s: x, o, org, q }) => {
    const p = q?.priced as { sellingSubtotal?: number; markup?: { bps: number; ruleVersion: number } } | undefined;
    tSell += x.sellPaise; tCost += x.costPaise; tSub += p?.sellingSubtotal ?? 0;
    return [x.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), org.businessName, o.orderNumber, x.awb, x.provider, x.carrierName, o.mode, o.paymentType, x.status, (x.chargeableWeightGrams / 1000).toFixed(2), r2(x.sellPaise),
      ...(cost ? [r2(x.costPaise), p?.sellingSubtotal !== undefined ? r2(p.sellingSubtotal) : "", p?.sellingSubtotal !== undefined ? r2(p.sellingSubtotal - x.costPaise) : "", p?.markup ? p.markup.bps / 100 : "", p?.markup?.ruleVersion ?? ""] : [])];
  });
  data.push(["TOTAL", "", "", "", "", "", "", "", "", "", r2(tSell), ...(cost ? [r2(tCost), r2(tSub), r2(tSub - tCost), "", ""] : [])]);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "export.admin_shipments", details: { rows: rows.length, filters: Object.fromEntries(u.searchParams) } });
  return new Response(toCsv(headers, data), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="vishwaship-shipments-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
}
