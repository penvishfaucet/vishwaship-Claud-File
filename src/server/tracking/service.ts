import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { adapterFor, providerContext } from "@/server/providers/registry";
import type { Address, NormalizedStatus, TrackingEvent } from "@/server/providers/types";
import { enqueue } from "@/server/jobs/runner";
import { noteCapability } from "@/server/carriers/verification";
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
  // Duplicate and out-of-order updates are safe: every event is kept in history (deduped), but the
  // shipment's status / latest location / time only move to an event at least as new as the stored one.
  const valid = events.filter((e) => e && e.status && !Number.isNaN(new Date(e.occurredAt).getTime()));
  const time = (e: TrackingEvent) => new Date(e.occurredAt).getTime();
  for (const e of [...valid].sort((a, b) => time(a) - time(b))) {
    const at = new Date(e.occurredAt);
    const r = await db.insert(schema.shipmentEvents).values({
      id: newId("ev"), shipmentId, dedupeKey: `${shipmentId}:${e.status}:${e.rawStatus}:${at.toISOString()}`,
      status: e.status, rawStatus: e.rawStatus, location: e.location ?? null, occurredAt: at, source, remark: e.remark?.slice(0, 300) ?? null,
    }).onConflictDoNothing().returning({ id: schema.shipmentEvents.id });
    inserted += r.length;
    if (r.length && e.destinationAmendment) await amendDestination(sh.orderId, shipmentId, e.destinationAmendment, source, at);
  }
  const latest = [...valid].sort((a, b) => time(b) - time(a))[0];
  const latestAt = latest ? new Date(latest.occurredAt) : null;
  const newer = !!latestAt && (!sh.lastEventAt || latestAt >= sh.lastEventAt);
  let status = sh.status;
  const patch: Partial<typeof schema.shipments.$inferInsert> = {};
  if (etaDate && !Number.isNaN(new Date(etaDate).getTime())) patch.etaDate = new Date(etaDate);
  if (latest && newer) {
    patch.lastEventAt = latestAt!;
    if (latest.location) patch.lastLocation = latest.location.slice(0, 200);
    if (isProgress(sh.status, latest.status)) {
      status = latest.status;
      patch.status = status;
      if (status === "delivered" || status === "rto_delivered") patch.deliveredAt = latestAt!;
      if (["picked_up", "in_transit", "at_delivery_center"].includes(status)) patch.pickupStatus = "picked_up";
    }
  }
  if (Object.keys(patch).length) await db.update(schema.shipments).set(patch).where(eq(schema.shipments.id, shipmentId));
  if (status !== sh.status) await onStatusChange(sh.orgId, sh.orderId, shipmentId, status as NormalizedStatus);
  return { inserted, status };
}

/** Carrier-confirmed change of the delivery address: update the order and keep the history. Never inferred from scans. */
async function amendDestination(orderId: string, shipmentId: string, next: Partial<Address>, source: "webhook" | "poll" | "manual", at: Date) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) return;
  const prev = o.consignee as Record<string, unknown>;
  const allowed = ["name", "mobile", "line1", "line2", "pincode", "city", "state"] as const;
  const changes = Object.fromEntries(allowed.filter((k) => typeof next[k] === "string" && next[k] !== prev[k]).map((k) => [k, String(next[k]).slice(0, 200)]));
  if (!Object.keys(changes).length) return;
  const ins = await db.insert(schema.destinationAmendments).values({
    id: newId("dam"), orderId, shipmentId, previous: prev, next: { ...prev, ...changes }, source: source === "webhook" ? "webhook" : "poll",
    dedupeKey: `${shipmentId}:${at.toISOString()}:${JSON.stringify(changes)}`.slice(0, 500), occurredAt: at,
  }).onConflictDoNothing().returning({ id: schema.destinationAmendments.id });
  if (!ins.length) return;
  await db.update(schema.orders).set({ consignee: { ...prev, ...changes } }).where(eq(schema.orders.id, orderId));
  await audit({ actorKind: "system", orgId: o.orgId, action: "shipment.destination_amended", targetType: "order", targetId: orderId, details: { fields: Object.keys(changes) } });
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

/** Ask the carrier for the latest scans ("Refresh", "Retry sync" and the scheduled poll). Records sync health. */
export async function refreshFromCarrier(shipmentId: string) {
  const db = await getDb();
  const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (!sh?.awb) return { ok: false as const, message: "No AWB yet" };
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, sh.providerAccountId));
  const ad = acct && adapterFor(acct);
  if (!ad) return syncFailed(shipmentId, "Carrier adapter not available");
  if (!ad.implemented.includes("track")) return syncFailed(shipmentId, `${acct.label} tracking is not available through Vishwaship yet`);
  let r;
  try { r = await ad.track(await providerContext(acct), sh.awb); } catch (e) { return syncFailed(shipmentId, (e as Error).message); }
  if (!r.ok) return syncFailed(shipmentId, r.error.message);
  const res = await ingestEvents(shipmentId, r.value.events, "poll", r.value.etaDate);
  await markSynced(shipmentId);
  if (r.value.events.length) await noteCapability(acct.id, "track", true, { evidence: `AWB ${sh.awb}` });
  return { ok: true as const, ...res };
}

export async function markSynced(shipmentId: string) {
  const db = await getDb();
  await db.update(schema.shipments).set({ lastSyncAt: new Date(), lastSyncError: null, syncFailures: 0 }).where(eq(schema.shipments.id, shipmentId));
}

async function syncFailed(shipmentId: string, message: string) {
  const db = await getDb();
  await db.update(schema.shipments).set({ lastSyncError: message.slice(0, 300), syncFailures: sql`${schema.shipments.syncFailures} + 1` }).where(eq(schema.shipments.id, shipmentId));
  return { ok: false as const, message };
}

/** Verified provider push: route each AWB/LR to its shipment (same provider only) and ingest. Unknown AWBs are counted, never created. */
export async function ingestPushed(provider: string, updates: Array<{ awb: string; events: TrackingEvent[]; etaDate?: string }>) {
  const db = await getDb();
  const out = { matched: 0, unknown: 0, inserted: 0 };
  for (const u of updates.slice(0, 500)) {
    const awb = String(u.awb ?? "").trim();
    if (!awb) { out.unknown++; continue; }
    const [sh] = await db.select({ id: schema.shipments.id }).from(schema.shipments)
      .where(and(eq(schema.shipments.provider, provider), or(eq(schema.shipments.awb, awb), eq(schema.shipments.lrNumber, awb))));
    if (!sh) { out.unknown++; continue; }
    const r = await ingestEvents(sh.id, u.events ?? [], "webhook", u.etaDate);
    await markSynced(sh.id);
    out.matched++; out.inserted += r.inserted;
  }
  return out;
}

export async function timeline(shipmentId: string) {
  const db = await getDb();
  return db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, shipmentId)).orderBy(asc(schema.shipmentEvents.occurredAt));
}
