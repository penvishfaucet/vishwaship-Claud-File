import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { getSetting } from "@/server/quotes/service";

/** Admin-managed Early COD terms. `version` changes whenever terms change; subscriptions keep the version they accepted. */
export interface EarlyCodTerms { enabled: boolean; feeBps: number; cycleDays: number; standardCycleDays: number; minDelivered: number; requireKyc: boolean; version: number }
export const EARLY_COD_DEFAULTS: EarlyCodTerms = { enabled: true, feeBps: 150, cycleDays: 2, standardCycleDays: 7, minDelivered: 0, requireKyc: true, version: 1 };
export const earlyCodTerms = async () => ({ ...EARLY_COD_DEFAULTS, ...(await getSetting<Partial<EarlyCodTerms>>("early_cod_terms", EARLY_COD_DEFAULTS)).value }) as EarlyCodTerms;

export async function earlyCodState(orgId: string) {
  const db = await getDb();
  const terms = await earlyCodTerms();
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  const [sub] = await db.select().from(schema.earlyCodSubscriptions).where(and(eq(schema.earlyCodSubscriptions.orgId, orgId), eq(schema.earlyCodSubscriptions.status, "active"))).orderBy(desc(schema.earlyCodSubscriptions.startedAt)).limit(1);
  const delivered = await db.select({ s: schema.shipments, o: schema.orders, item: schema.codRemittanceItems }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .leftJoin(schema.codRemittanceItems, eq(schema.codRemittanceItems.shipmentId, schema.shipments.id))
    .where(and(eq(schema.shipments.orgId, orgId), gt(schema.orders.codAmountPaise, 0), eq(schema.shipments.status, "delivered")));
  const reasons: string[] = [];
  if (!terms.enabled) reasons.push("Early COD is not open for new subscriptions right now.");
  if (!(await hasFeature(orgId, "early_cod"))) reasons.push("Early COD is not enabled for your account.");
  if (terms.requireKyc && org?.kycStatus !== "approved") reasons.push("Complete KYC (approved) to receive COD payouts.");
  if (delivered.length < terms.minDelivered) reasons.push(`At least ${terms.minDelivered} delivered COD shipments are needed (you have ${delivered.length}).`);
  const feeBps = sub?.feeBps ?? terms.feeBps;
  const cycle = sub?.cycleDays ?? terms.cycleDays;
  const qualifying = delivered.filter((d) => !d.item).map((d) => {
    const at = d.s.lastEventAt ?? d.s.createdAt;
    const fee = Math.round((d.o.codAmountPaise * feeBps) / 10_000);
    return { shipmentId: d.s.id, orderId: d.o.id, orderNumber: d.o.orderNumber, awb: d.s.awb, deliveredAt: at, cod: d.o.codAmountPaise, fee, net: d.o.codAmountPaise - fee,
      payoutAt: new Date(at.getTime() + (sub ? cycle : terms.standardCycleDays) * 86400_000) };
  });
  return { terms, sub: sub ?? null, eligible: reasons.length === 0, reasons, qualifying, termsChanged: !!sub && sub.termsVersion !== terms.version };
}
