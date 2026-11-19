import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { statusLabel } from "@/lib/status";
import { type EmailEventKey, eventForStatus } from "@/lib/email-events";
import { rule, sendEmail } from "./service";

const appUrl = () => (process.env.APP_URL ?? "https://vishwaship.in").replace(/\/+$/, "");
const ist = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
/** A first scan that is already past pickup (e.g. straight to In Transit) still means the parcel was picked up. */
const PICKED = new Set(["picked_up", "in_transit", "at_delivery_center"]);

/** Emails for a confirmed courier status change: "Vishwaship Client" and, if enabled and given, the delivery recipient. */
export async function sendShipmentStatusEmails(shipmentId: string, status: string) {
  const events: EmailEventKey[] = [];
  if (PICKED.has(status)) events.push("shipment_picked_up");
  const e = eventForStatus(status);
  if (e && e.key !== "shipment_picked_up" && !events.includes(e.key)) events.push(e.key);
  const out: Array<{ event: string; to: string; status: string }> = [];
  for (const ev of events) out.push(...(await sendOne(shipmentId, ev)));
  return out;
}

async function sendOne(shipmentId: string, event: EmailEventKey) {
  const r = await rule(event);
  if (!r.enabled || (!r.toClient && !r.toRecipient)) return [];
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders, org: schema.orgs }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId)).where(eq(schema.shipments.id, shipmentId));
  if (!row?.s.awb) return [];
  // demo-courier shipments never email real people in production
  if (row.s.provider === "demo" && process.env.NODE_ENV === "production") return [];
  const { s, o, org } = row;
  const awb = row.s.awb;
  const [pick] = await db.select({ at: schema.shipmentEvents.occurredAt }).from(schema.shipmentEvents)
    .where(and(eq(schema.shipmentEvents.shipmentId, s.id), eq(schema.shipmentEvents.status, "picked_up"))).orderBy(asc(schema.shipmentEvents.occurredAt)).limit(1);
  const [latest] = await db.select({ at: schema.shipmentEvents.occurredAt }).from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, s.id)).orderBy(desc(schema.shipmentEvents.occurredAt)).limit(1);
  const base = {
    order_id: o.orderNumber, awb_number: awb, courier_name: s.carrierName, status: statusLabel(s.status),
    pickup_time: ist(pick?.at ?? latest?.at ?? new Date()), tracking_link: `${appUrl()}/track/?awb=${encodeURIComponent(awb)}`,
  };
  const sent: Array<{ event: string; to: string; status: string }> = [];
  if (r.toClient) {
    // Vishwaship Client: the registered account email of the customer who booked
    const [u] = await db.select({ email: schema.users.email, name: schema.users.name }).from(schema.users)
      .where(and(eq(schema.users.orgId, org.id), eq(schema.users.kind, "customer"), eq(schema.users.active, true))).orderBy(asc(schema.users.createdAt)).limit(1);
    if (u?.email) {
      const x = await sendEmail({ event, to: u.email, toKind: "client", orgId: org.id, shipmentId: s.id, dedupeKey: `${event}:${s.id}:${u.email.toLowerCase()}`, vars: { ...base, customer_name: org.businessName || u.name } });
      sent.push({ event, to: u.email, status: x.status });
    }
  }
  const recipient = ((o.consignee ?? {}) as { email?: string; name?: string });
  if (r.toRecipient && recipient.email) {
    // Delivery recipient: only shipment facts — never the client's pricing or wallet
    const x = await sendEmail({ event, to: recipient.email, toKind: "recipient", orgId: org.id, shipmentId: s.id, dedupeKey: `${event}:${s.id}:${recipient.email.toLowerCase()}`, vars: { ...base, customer_name: recipient.name ?? "" } });
    sent.push({ event, to: recipient.email, status: x.status });
  }
  return sent;
}
