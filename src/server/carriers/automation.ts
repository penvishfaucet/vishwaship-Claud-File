import "server-only";
import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray, ne } from "drizzle-orm";
import { audit } from "@/server/audit";
import { canTakeBookings, noteCapability } from "@/server/carriers/verification";
import { getDb, schema } from "@/server/db/client";
import { adapterFor, providerContext } from "@/server/providers/registry";
import type { Result } from "@/server/providers/types";
import { courierEmail } from "@/server/client-email";
import { newId } from "@/server/util/ids";

type Warehouse = InferSelectModel<typeof schema.warehouses>;
type Account = InferSelectModel<typeof schema.providerAccounts>;

/**
 * Courier-side name of a pickup address. After the customer edits the address the sync row is reset and the
 * name gets an edit stamp, so providers that return an existing warehouse for the same title (Shipmozo,
 * Delhivery) register the new address instead of reusing the old one.
 */
function courierCode(wh: Warehouse) {
  const base = wh.code ?? wh.id;
  return wh.updatedAt ? `${base}-${wh.updatedAt.toISOString().replace(/\D/g, "").slice(2, 12)}` : base;
}

/** Register one pickup address with one courier account (idempotent: an existing registration is reused). */
export async function registerWarehouseAt(wh: Warehouse, acct: Account): Promise<Result<{ ref: string | null }>> {
  const db = await getDb();
  const adapter = adapterFor(acct);
  if (!adapter?.registerWarehouse) return { ok: true, value: { ref: null } }; // provider has no warehouse concept
  const [sync] = await db.select().from(schema.warehouseProviderSync).where(and(eq(schema.warehouseProviderSync.warehouseId, wh.id), eq(schema.warehouseProviderSync.providerAccountId, acct.id)));
  if (sync?.status === "registered" && sync.providerWarehouseRef) return { ok: true, value: { ref: sync.providerWarehouseRef } };
  let reg;
  try {
    reg = await adapter.registerWarehouse(await providerContext(acct), { code: courierCode(wh), label: wh.label, contactName: wh.contactName, mobile: wh.mobile, email: await courierEmail(wh.orgId, wh.email), line1: wh.line1, line2: wh.line2, pincode: wh.pincode, city: wh.city, state: wh.state });
  } catch (e) { reg = { ok: false as const, error: { category: "upstream" as const, message: (e as Error).message, retryable: true } }; }
  const row = { status: reg.ok ? "registered" : "failed", providerWarehouseRef: reg.ok ? reg.value.ref : null, lastError: reg.ok ? null : reg.error.message.slice(0, 300), updatedAt: new Date() };
  await db.insert(schema.warehouseProviderSync).values({ id: newId("wps"), warehouseId: wh.id, providerAccountId: acct.id, ...row })
    .onConflictDoUpdate({ target: [schema.warehouseProviderSync.warehouseId, schema.warehouseProviderSync.providerAccountId], set: row });
  return reg.ok ? { ok: true, value: { ref: reg.value.ref } } : reg;
}

/** Courier accounts a customer can book: Active and verified (or "Activate now"), plus pilot accounts for that customer. */
async function bookableAccounts(orgId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.category, "shipping"), ne(schema.providerAccounts.status, "archived")));
  return rows.filter((a) => a.adapter !== "demo" && adapterFor(a)?.registerWarehouse && (
    (a.status === "enabled" && canTakeBookings(a)) ||
    (a.status === "disabled" && !!a.secretsEnc && (((a.configPublic as Record<string, unknown>)?.pilotOrgIds as string[] | undefined) ?? []).includes(orgId))));
}

/**
 * warehouse.sync — a customer added or edited a pickup address: register it with every courier account they
 * can book (Shipmozo B2C/B2B, Delhivery B2C/B2B, Shipora X …) so the first booking needs no extra step.
 */
export async function syncWarehouseEverywhere(warehouseId: string) {
  const db = await getDb();
  const [wh] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId));
  if (!wh || !wh.active) return { done: 0, failed: [] as string[] };
  const failed: string[] = [];
  let done = 0;
  for (const acct of await bookableAccounts(wh.orgId)) {
    const r = await registerWarehouseAt(wh, acct);
    if (r.ok) done++; else failed.push(`${acct.label}: ${r.error.message}`);
  }
  return { done, failed };
}

/** Next pickup slot in IST: today before 2 pm, otherwise the next day; Sundays move to Monday. */
export function nextPickupDate(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  if (ist.getUTCHours() >= 14) ist.setUTCDate(ist.getUTCDate() + 1);
  if (ist.getUTCDay() === 0) ist.setUTCDate(ist.getUTCDate() + 1);
  return ist.toISOString().slice(0, 10);
}

export type PickupOutcome = { ok: true; pickupRef: string | null; date: string; duplicate?: boolean; requestId?: string } | { ok: false; retry: boolean; message: string };

/**
 * Raise a courier pickup request (PR) for a booked shipment — used by the automatic job after booking, the
 * per-order "Schedule pickup" button and the bulk "Generate pickup request". Couriers with a warehouse-level PR
 * (Delhivery) get ONE request per pickup address + date + account; later shipments attach to it instead of
 * creating another. Every PR is recorded in pickup_requests with the courier's PR ID and pickup agent, if given.
 */
export async function requestPickup(shipmentId: string, date: string, actor: { userId?: string; kind: "customer" | "staff" | "system" }, opts: { packageCount?: number } = {}): Promise<PickupOutcome> {
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(eq(schema.shipments.id, shipmentId));
  if (!row) return { ok: false, retry: false, message: "Shipment not found" };
  const sh = row.s;
  if (sh.bookingStatus !== "confirmed") return { ok: false, retry: sh.bookingStatus === "pending", message: "The courier has not confirmed this booking yet" };
  if (!["booked", "pickup_pending"].includes(sh.status)) return { ok: false, retry: false, message: `Shipment is already ${sh.status.replace(/_/g, " ")}` };
  const { pickupBlockedByCod } = await import("@/server/whatsapp/service");
  const codHold = await pickupBlockedByCod(row.o.id);
  if (codHold) return { ok: false, retry: true, message: codHold };
  if (sh.pickupRef && sh.pickupDate && sh.pickupDate.toISOString().slice(0, 10) === date) return { ok: true, pickupRef: sh.pickupRef, date, duplicate: true, requestId: sh.pickupRequestId ?? undefined };
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, sh.providerAccountId));
  const ad = acct && adapterFor(acct);
  if (!ad || !ad.implemented.includes("pickup")) return { ok: false, retry: false, message: "This courier schedules pickup itself — no pickup request is needed" };
  const whId = row.o.warehouseId;
  if (!whId) return { ok: false, retry: false, message: "Order has no pickup address" };
  // Warehouse-level couriers: reuse this date's PR for the same address + account instead of raising another.
  if (ad.pickupScope === "warehouse") {
    const [pr] = await db.select().from(schema.pickupRequests).where(and(eq(schema.pickupRequests.orgId, sh.orgId), eq(schema.pickupRequests.warehouseId, whId), eq(schema.pickupRequests.providerAccountId, acct.id), eq(schema.pickupRequests.pickupDate, date), eq(schema.pickupRequests.status, "requested")));
    if (pr) {
      await db.update(schema.pickupRequests).set({ shipmentIds: Array.from(new Set([...(pr.shipmentIds as string[]), sh.id])) }).where(eq(schema.pickupRequests.id, pr.id));
      await markShipment(sh, date, pr.providerRef, pr.id, pr.agentName, pr.agentPhone);
      return { ok: true, pickupRef: pr.providerRef, date, requestId: pr.id };
    }
  }
  const [sync] = await db.select().from(schema.warehouseProviderSync).where(and(eq(schema.warehouseProviderSync.warehouseId, whId), eq(schema.warehouseProviderSync.providerAccountId, acct.id)));
  const boxes = opts.packageCount ?? (await db.select().from(schema.packages).where(eq(schema.packages.orderId, row.o.id))).reduce((t, x) => t + x.count, 0);
  let r;
  try { r = await ad.schedulePickup(await providerContext(acct), { providerOrderRef: sh.providerOrderRef ?? sh.id, awb: sh.awb ?? "", pickupLocation: sync?.providerWarehouseRef ?? undefined, packageCount: boxes || 1 }, date); }
  catch (e) { r = { ok: false as const, error: { category: "upstream" as const, message: (e as Error).message, retryable: true } }; }
  await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId: sh.orgId, action: r.ok ? "pickup.requested" : "pickup.failed", targetType: "order", targetId: row.o.id, details: { date, auto: actor.kind === "system", error: r.ok ? undefined : r.error.message } });
  if (!r.ok) return { ok: false, retry: r.error.retryable, message: r.error.message };
  await noteCapability(acct.id, "pickup", true, { evidence: `pickup ${r.value.pickupRef ?? date}` });
  const prId = newId("pr");
  await db.insert(schema.pickupRequests).values({ id: prId, orgId: sh.orgId, warehouseId: whId, providerAccountId: acct.id, pickupDate: date, providerRef: r.value.pickupRef ?? null, status: "requested", shipmentIds: [sh.id], packageCount: boxes || 1, agentName: r.value.agentName ?? null, agentPhone: r.value.agentPhone ?? null, createdBy: actor.userId ?? actor.kind });
  await markShipment(sh, date, r.value.pickupRef ?? null, prId, r.value.agentName ?? null, r.value.agentPhone ?? null);
  return { ok: true, pickupRef: r.value.pickupRef ?? null, date, requestId: prId };
}

async function markShipment(sh: InferSelectModel<typeof schema.shipments>, date: string, ref: string | null, prId: string, agentName: string | null, agentPhone: string | null) {
  const db = await getDb();
  await db.update(schema.shipments).set({ pickupStatus: "scheduled", pickupRef: ref, pickupRequestId: prId, pickupAgentName: agentName, pickupAgentPhone: agentPhone, pickupDate: new Date(`${date}T12:00:00+05:30`), status: sh.status === "booked" ? "pickup_pending" : sh.status }).where(eq(schema.shipments.id, sh.id));
  await db.insert(schema.shipmentEvents).values({ id: newId("ev"), shipmentId: sh.id, dedupeKey: `pickup_req:${sh.id}:${date}`, status: "pickup_pending", rawStatus: `Pickup requested for ${date}${ref ? ` (PR ${ref})` : ""}`, occurredAt: new Date(), source: "manual" }).onConflictDoNothing();
}

/** Shipments that still need a courier pickup (booked, not picked up, not cancelled), optionally at one pickup address. */
export async function pickupEligible(orgId: string, warehouseId?: string) {
  const db = await getDb();
  return db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(eq(schema.shipments.orgId, orgId), eq(schema.shipments.bookingStatus, "confirmed"), inArray(schema.shipments.status, ["booked", "pickup_pending"]), ...(warehouseId ? [eq(schema.orders.warehouseId, warehouseId)] : [])));
}

/**
 * Generate pickup request(s) for selected shipments of one pickup address and date, grouped per courier account;
 * warehouse-level couriers get one PR carrying the total box count.
 */
export async function generatePickupRequest(a: { orgId: string; warehouseId: string; date: string; shipmentIds: string[]; actor: { userId?: string; kind: "customer" | "staff" } }) {
  const rows = (await pickupEligible(a.orgId, a.warehouseId)).filter((r) => a.shipmentIds.includes(r.s.id));
  const db = await getDb();
  const results: Array<{ shipmentId: string; orderNumber: string; ok: boolean; message: string; pickupRef?: string | null }> = [];
  const byAcct = new Map<string, typeof rows>();
  for (const r of rows) byAcct.set(r.s.providerAccountId, [...(byAcct.get(r.s.providerAccountId) ?? []), r]);
  for (const [acctId, list] of byAcct) {
    const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, acctId));
    const ad = acct && adapterFor(acct);
    const total = (await db.select().from(schema.packages).where(inArray(schema.packages.orderId, list.map((x) => x.o.id)))).reduce((t, x) => t + x.count, 0);
    for (const [i, r] of list.entries()) {
      if (!ad || !ad.implemented.includes("pickup")) { results.push({ shipmentId: r.s.id, orderNumber: r.o.orderNumber, ok: true, message: "Courier schedules this pickup automatically" }); continue; }
      const out = await requestPickup(r.s.id, a.date, a.actor, ad.pickupScope === "warehouse" && i === 0 ? { packageCount: total } : {});
      results.push(out.ok ? { shipmentId: r.s.id, orderNumber: r.o.orderNumber, ok: true, message: out.duplicate ? "Already in this pickup request" : "Pickup requested", pickupRef: out.pickupRef } : { shipmentId: r.s.id, orderNumber: r.o.orderNumber, ok: false, message: out.message });
    }
  }
  return results;
}
