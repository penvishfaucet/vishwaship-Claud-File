import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getAdapter, providerContext } from "@/server/providers/registry";
import type { NormalizedStatus, TrackingEvent } from "@/server/providers/types";
import { enqueue } from "@/server/jobs/runner";
import { newId } from "@/server/util/ids";

/** Forward progress order. Terminal/exception states are handled separately so they always apply. */
const RANK: Record<string, number> = {
  booked: 0, pickup_pending: 1, picked_up: 2, in_transit: 3, at_delivery_center: 4, out_for_delivery: 5, ndr: 5, delivered: 9,
  rto_initiated: 6, rto_in_transit: 7, rto_delivered: 10, cancelled: 10, lost: 10, reverse_in_transit: 3, reverse_delivered: 9,
};

/** True if moving from `current` to `next` is progress (prevents stale scans rolling status back). */
export function isProgress(current: string, next: string) {
  if (current === next) return false;
  if (["delivered", "rto_delivered", "cancelled", "lost"].includes(current)) return false;
  if (next === "out_for_delivery" && current === "ndr") return true; // re-attempt
  if (next === "ndr" && current === "out_for_delivery") return true;
  return (RANK[next] ?? 0) >= (RANK[current] ?? 0);
}

/** Unguessable public reference for buyer tracking links. Created lazily, never changes. */
export async function ensurePublicRef(shipmentId: string): Promise<string> {
  const db = await getDb();
  const [s] = await db.select({ ref: schema.shipments.publicRef }).from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (s?.ref) return s.ref;
  const ref = `t${randomBytes(12).toString("base64url")}`;
  await db.update(schema.shipments).set({ publicRef: ref }).where(and(eq(schema.shipments.id, shipmentId), isNull(schema.shipments.publicRef)));
  const [after] = await db.select({ ref: schema.shipments.publicRef }).from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  return after!.ref!;
}

/**
 * Save carrier events (deduped), advance the shipment status only forward, and fire side effects
 * (WhatsApp Out-for-Delivery) exactly once per status via job dedupe keys.
 */
export async function ingestEvents(shipmentId: string, events: TrackingEvent[], source: "webhook" | "poll" | "manual", etaDate?: string) {
  const db = await getDb();
  const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (!sh) return { inserted: 0, status: null as string | null };
  let inserted = 0;
  for (const e of [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const r = await db.insert(schema.shipmentEvents).values({
      id: newId("ev"), shipmentId, dedupeKey: `${shipmentId}:${e.status}:${e.rawStatus}:${e.occurredAt}`,
      status: e.status, rawStatus: e.rawStatus, location: e.location ?? null, occurredAt: new Date(e.occurredAt), source,
    }).onConflictDoNothing().returning({ id: schema.shipmentEvents.id });
    inserted += r.length;
  }
  const latest = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  let status = sh.status;
  if (latest && isProgress(sh.status, latest.status)) {
    status = latest.status;
    await db.update(schema.shipments).set({ status, lastEventAt: new Date(latest.occurredAt), ...(etaDate ? { etaDate: new Date(etaDate) } : {}) }).where(eq(schema.shipments.id, shipmentId));
    await onStatusChange(sh.orgId, sh.orderId, shipmentId, status as NormalizedStatus);
  } else if (etaDate) {
    await db.update(schema.shipments).set({ etaDate: new Date(etaDate) }).where(eq(schema.shipments.id, shipmentId));
  }
  return { inserted, status };
}

async function onStatusChange(orgId: string, orderId: string, shipmentId: string, status: NormalizedStatus) {
  if (status === "out_for_delivery") {
    // dedupe per shipment+day so a re-attempt next day can notify again, but retries never double-send
    const day = new Date().toISOString().slice(0, 10);
    await enqueue("whatsapp.send", { event: "out_for_delivery", shipmentId, orderId, orgId, day }, { dedupeKey: `wa:ofd:${shipmentId}:${day}` });
  }
  const db = await getDb();
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId, kind: "tracking", title: `Shipment ${status.replace(/_/g, " ")}`, href: `/portal/orders/${orderId}/` }).onConflictDoNothing();
}

/** Ask the carrier for the latest scans (used by "Refresh" and the scheduled poll). */
export async function refreshFromCarrier(shipmentId: string) {
  const db = await getDb();
  const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (!sh?.awb) return { ok: false as const, message: "No AWB yet" };
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, sh.providerAccountId));
  const ad = acct && getAdapter(acct.adapter);
  if (!ad) return { ok: false as const, message: "Carrier adapter not available" };
  const r = await ad.track(await providerContext(acct), sh.awb);
  if (!r.ok) return { ok: false as const, message: r.error.message };
  const res = await ingestEvents(shipmentId, r.value.events, "poll", r.value.etaDate);
  return { ok: true as const, ...res };
}

export async function timeline(shipmentId: string) {
  const db = await getDb();
  return db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, shipmentId)).orderBy(asc(schema.shipmentEvents.occurredAt));
}
