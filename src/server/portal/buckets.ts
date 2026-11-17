import "server-only";
import { type SQL, and, count, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

/**
 * Dashboard buckets. The SAME condition builds the card count and the Orders list it opens, so the numbers
 * always agree for the same date range (orders.created_at, IST days).
 */
export const BUCKETS = {
  new: { label: "New Orders", desc: "Awaiting courier assignment or processing" },
  assigned: { label: "Courier Assigned", desc: "Courier booked, pickup not yet scheduled" },
  scheduled: { label: "Scheduled", desc: "Pickup scheduled" },
  all: { label: "All Orders", desc: "Every order in the date range" },
  returns: { label: "Customer Returns", desc: "Customer-initiated returns (reverse pickups)" },
  rto: { label: "RTO", desc: "Return to origin" },
  in_transit: { label: "In Transit", desc: "Picked up and moving" },
  ofd: { label: "Out for Delivery", desc: "With the delivery agent" },
  delivered: { label: "Delivered", desc: "Delivered to the buyer" },
  ndr: { label: "NDR", desc: "Delivery attempt failed" },
  rto_in_transit: { label: "RTO In-Transit", desc: "Returning to you" },
  rto_delivered: { label: "RTO Delivered", desc: "Returned to you" },
} as const;
export type BucketKey = keyof typeof BUCKETS;
export const isBucket = (k: string | undefined): k is BucketKey => !!k && k in BUCKETS;

const OPEN_ORDER = ["draft", "ready", "cod_hold", "booking_failed", "needs_reconcile", "booking"];
const S = schema.shipments, O = schema.orders;

/** Condition over orders LEFT JOIN shipments (the shipment row is the live one, if any). */
export function bucketCondition(b: BucketKey): SQL | undefined {
  switch (b) {
    case "new": return and(eq(O.direction, "forward"), inArray(O.status, OPEN_ORDER), isNull(S.id));
    case "assigned": return and(inArray(S.status, ["booked", "pickup_pending"]), ne(S.pickupStatus, "scheduled"), ne(S.bookingStatus, "failed"), ne(S.bookingStatus, "cancelled"));
    case "scheduled": return and(eq(S.pickupStatus, "scheduled"), inArray(S.status, ["booked", "pickup_pending"]));
    case "all": return undefined;
    case "returns": return eq(O.direction, "reverse");
    case "rto": return inArray(S.status, ["rto_initiated", "rto_in_transit", "rto_delivered"]);
    case "in_transit": return inArray(S.status, ["picked_up", "in_transit", "at_delivery_center"]);
    case "ofd": return eq(S.status, "out_for_delivery");
    case "delivered": return eq(S.status, "delivered");
    case "ndr": return eq(S.status, "ndr");
    case "rto_in_transit": return inArray(S.status, ["rto_initiated", "rto_in_transit"]);
    case "rto_delivered": return eq(S.status, "rto_delivered");
  }
}

/** IST date range (inclusive). Defaults to the last 30 days. */
export function dashRange(sp: { from?: string; to?: string }) {
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const todayIst = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const toStr = ok(sp.to) ? sp.to! : todayIst;
  const fromStr = ok(sp.from) ? sp.from! : new Date(new Date(`${toStr}T00:00:00Z`).getTime() - 29 * 86400_000).toISOString().slice(0, 10);
  return { fromStr, toStr, from: new Date(`${fromStr}T00:00:00+05:30`), to: new Date(`${toStr}T23:59:59.999+05:30`) };
}
export const rangeCondition = (r: { from: Date; to: Date }) => and(gte(O.createdAt, r.from), lte(O.createdAt, r.to));

export async function bucketCounts(orgId: string, r: { from: Date; to: Date }, keys: BucketKey[]) {
  const db = await getDb();
  const out = {} as Record<BucketKey, number>;
  for (const k of keys) {
    const [row] = await db.select({ n: count() }).from(O).leftJoin(S, eq(S.orderId, O.id)).where(and(eq(O.orgId, orgId), rangeCondition(r), bucketCondition(k)));
    out[k] = Number(row?.n ?? 0);
  }
  return out;
}

