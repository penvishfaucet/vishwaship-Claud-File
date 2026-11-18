import "server-only";
import type { InferSelectModel } from "drizzle-orm";
import { and, eq, ne } from "drizzle-orm";
import { audit } from "@/server/audit";
import { canTakeBookings, noteCapability } from "@/server/carriers/verification";
import { getDb, schema } from "@/server/db/client";
import { adapterFor, providerContext } from "@/server/providers/registry";
import type { Result } from "@/server/providers/types";
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
    reg = await adapter.registerWarehouse(await providerContext(acct), { code: courierCode(wh), label: wh.label, contactName: wh.contactName, mobile: wh.mobile, email: wh.email, line1: wh.line1, line2: wh.line2, pincode: wh.pincode, city: wh.city, state: wh.state });
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

export type PickupOutcome = { ok: true; pickupRef: string | null; date: string; duplicate?: boolean } | { ok: false; retry: boolean; message: string };

/**
 * Raise a courier pickup request (PR) for a booked shipment. Used by the automatic job right after booking
 * and by the customer's "Schedule pickup" button. One request per shipment + date.
 */
export async function requestPickup(shipmentId: string, date: string, actor: { userId?: string; kind: "customer" | "staff" | "system" }): Promise<PickupOutcome> {
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(eq(schema.shipments.id, shipmentId));
  if (!row) return { ok: false, retry: false, message: "Shipment not found" };
  const sh = row.s;
  if (sh.bookingStatus !== "confirmed") return { ok: false, retry: sh.bookingStatus === "pending", message: "The courier has not confirmed this booking yet" };
  if (!["booked", "pickup_pending"].includes(sh.status)) return { ok: false, retry: false, message: `Shipment is already ${sh.status.replace(/_/g, " ")}` };
  const { pickupBlockedByCod } = await import("@/server/whatsapp/service");
  const codHold = await pickupBlockedByCod(row.o.id);
  if (codHold) return { ok: false, retry: true, message: codHold };
  if (sh.pickupRef && sh.pickupDate && sh.pickupDate.toISOString().slice(0, 10) === date) return { ok: true, pickupRef: sh.pickupRef, date, duplicate: true };
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, sh.providerAccountId));
  const ad = acct && adapterFor(acct);
  if (!ad || !ad.implemented.includes("pickup")) return { ok: false, retry: false, message: "This courier schedules pickup itself — no pickup request is needed" };
  const [sync] = row.o.warehouseId ? await db.select().from(schema.warehouseProviderSync).where(and(eq(schema.warehouseProviderSync.warehouseId, row.o.warehouseId), eq(schema.warehouseProviderSync.providerAccountId, acct.id))) : [];
  const boxes = (await db.select().from(schema.packages).where(eq(schema.packages.orderId, row.o.id))).reduce((t, x) => t + x.count, 0);
  let r;
  try { r = await ad.schedulePickup(await providerContext(acct), { providerOrderRef: sh.providerOrderRef ?? sh.id, awb: sh.awb ?? "", pickupLocation: sync?.providerWarehouseRef ?? undefined, packageCount: boxes || 1 }, date); }
  catch (e) { r = { ok: false as const, error: { category: "upstream" as const, message: (e as Error).message, retryable: true } }; }
  await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId: sh.orgId, action: r.ok ? "pickup.requested" : "pickup.failed", targetType: "order", targetId: row.o.id, details: { date, auto: actor.kind === "system", error: r.ok ? undefined : r.error.message } });
  if (!r.ok) return { ok: false, retry: r.error.retryable, message: r.error.message };
  await noteCapability(acct.id, "pickup", true, { evidence: `pickup ${r.value.pickupRef ?? date}` });
  await db.update(schema.shipments).set({ pickupStatus: "scheduled", pickupRef: r.value.pickupRef ?? null, pickupDate: new Date(`${date}T12:00:00+05:30`), status: sh.status === "booked" ? "pickup_pending" : sh.status }).where(eq(schema.shipments.id, sh.id));
  await db.insert(schema.shipmentEvents).values({ id: newId("ev"), shipmentId: sh.id, dedupeKey: `pickup_req:${sh.id}:${date}`, status: "pickup_pending", rawStatus: `Pickup requested for ${date}${r.value.pickupRef ? ` (ref ${r.value.pickupRef})` : ""}`, occurredAt: new Date(), source: "manual" }).onConflictDoNothing();
  return { ok: true, pickupRef: r.value.pickupRef ?? null, date };
}
