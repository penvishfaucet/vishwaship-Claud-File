import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

// Real SQL on an in-memory PGlite with the project's migrations, so the SQL tab mapping and the
// tracking ingest are tested against Postgres semantics (not mocks).
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/features", () => ({ eventIncluded: async () => true, hasFeature: async () => true }));

const { tabOf, codDisplay, fitScale, MIN_SCALE } = await import("@/lib/order-view");
const { labelSource, labelFormatsFor } = await import("@/server/labels/formats");
const { parseOrderFilters, tabCounts, listOrderRows } = await import("./view");
const { ingestEvents, isProgress } = await import("@/server/tracking/service");

const ORG = "org_test", OTHER = "org_other";
let n = 0;
async function order(o: { org?: string; status?: string; archived?: boolean; ship?: { status: string; booking?: string; pickup?: string } }) {
  const id = `ord_${++n}`;
  await db.insert(schema.orders).values({
    id, orgId: o.org ?? ORG, orderNumber: `VS-${n}`, mode: "B2C", paymentType: "cod", codAmountPaise: 50000, declaredValuePaise: 50000,
    consignee: { name: "Buyer", mobile: "9876543210", line1: "1 Road", city: "Mumbai", state: "MH", pincode: "400001" }, status: o.status ?? "draft",
    archivedAt: o.archived ? new Date() : null,
  });
  if (o.ship) {
    await db.insert(schema.shipments).values({
      id: `shp_${n}`, orgId: o.org ?? ORG, orderId: id, providerAccountId: "pa", provider: "demo", carrierCode: "demo", carrierName: "Demo", serviceName: "Surface",
      awb: `AWB${n}`, bookingStatus: o.ship.booking ?? "confirmed", pickupStatus: o.ship.pickup ?? "not_scheduled", status: o.ship.status, quoteId: "q", sellPaise: 10000, costPaise: 8000, chargeableWeightGrams: 500,
    });
  }
  return id;
}

const CASES: Array<Parameters<typeof order>[0]> = [
  {}, { status: "cod_hold" }, { status: "booking_failed", ship: { status: "cancelled", booking: "failed" } },
  { status: "booked", ship: { status: "booked" } }, { status: "booked", ship: { status: "booked", pickup: "scheduled" } }, { status: "booked", ship: { status: "pickup_pending", pickup: "scheduled" } },
  { status: "booked", ship: { status: "picked_up" } }, { status: "booked", ship: { status: "in_transit" } }, { status: "booked", ship: { status: "at_delivery_center" } },
  { status: "booked", ship: { status: "out_for_delivery" } }, { status: "booked", ship: { status: "delivered" } }, { status: "booked", ship: { status: "ndr" } },
  { status: "booked", ship: { status: "rto_initiated" } }, { status: "booked", ship: { status: "rto_in_transit" } }, { status: "booked", ship: { status: "rto_delivered" } },
  { status: "cancelled", ship: { status: "cancelled", booking: "cancelled" } }, { status: "booked", ship: { status: "lost" } }, { archived: true, status: "booked", ship: { status: "delivered" } },
];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: ORG, name: "Test", businessName: "Test Co" }, { id: OTHER, name: "Other", businessName: "Other Co" }]);
  for (const c of CASES) await order(c);
  await order({ org: OTHER, status: "booked", ship: { status: "in_transit" } });
});

const f = (sp: Record<string, string> = {}) => parseOrderFilters(sp);

describe("Orders tabs: SQL mapping matches tabOf()", () => {
  it("every seeded order lands in the same tab in SQL and in TypeScript", async () => {
    for (let i = 0; i < CASES.length; i++) {
      const c = CASES[i];
      const expected = tabOf({ archived: !!c.archived, orderStatus: c.status ?? "draft", shipment: c.ship ? { bookingStatus: c.ship.booking ?? "confirmed", status: c.ship.status, pickupStatus: c.ship.pickup ?? "not_scheduled" } : null });
      if (expected === "other") continue;
      const rows = await listOrderRows(ORG, { ...f(), tab: expected, pageSize: 100 });
      expect(rows.rows.map((r) => r.orderNumber), `case ${i} → ${expected}`).toContain(`VS-${i + 1}`);
    }
  });
  it("counts per tab, All excludes archive, cancelled/lost only under All", async () => {
    const c = await tabCounts(ORG, f());
    expect(c).toMatchObject({ drafts: 1, new: 2, courier_assigned: 1, pickups: 2, in_transit: 3, out_for_delivery: 1, delivered: 1, ndr: 1, rto_in_transit: 2, rto_delivered: 1, archive: 1 });
    expect(c.all).toBe(CASES.length - 1);
    const listed = await listOrderRows(ORG, { ...f(), tab: "all", pageSize: 100 });
    expect(listed.total).toBe(c.all);
  });
  it("never returns another account's orders", async () => {
    const all = await listOrderRows(ORG, { ...f(), tab: "all", pageSize: 100 });
    expect(all.rows.every((r) => !r.orderNumber.endsWith(`-${CASES.length + 1}`))).toBe(true);
    const other = await tabCounts(OTHER, f());
    expect(other.in_transit).toBe(1);
    expect(other.all).toBe(1);
  });
  it("AWB search and legacy dashboard links", async () => {
    const r = await listOrderRows(ORG, { ...f({ awb: "AWB10" }), tab: "all" });
    expect(r.rows.map((x) => x.shipment?.awb)).toEqual(["AWB10"]);
    expect(f({ bucket: "assigned" }).tab).toBe("courier_assigned");
    expect(f({ group: "transit" }).tab).toBe("in_transit");
    expect(f({ bucket: "returns" }).direction).toBe("reverse");
  });
});

describe("tracking ingest", () => {
  it("stale and duplicate scans never roll the state back; history keeps every event", async () => {
    const id = await order({ status: "booked", ship: { status: "booked" } });
    const sid = id.replace("ord", "shp");
    const t = (h: number) => new Date(Date.UTC(2026, 10, 10, h)).toISOString();
    await ingestEvents(sid, [{ status: "picked_up", rawStatus: "PICKED", location: "Haridwar Hub", occurredAt: t(1) }], "webhook");
    await ingestEvents(sid, [{ status: "out_for_delivery", rawStatus: "OFD", location: "Mumbai DC", occurredAt: t(5) }], "webhook");
    // older in-transit scan arrives late, plus a duplicate OFD
    const late = await ingestEvents(sid, [{ status: "in_transit", rawStatus: "TRANSIT", location: "Delhi Hub", occurredAt: t(3) }, { status: "out_for_delivery", rawStatus: "OFD", location: "Mumbai DC", occurredAt: t(5) }], "poll");
    expect(late.inserted).toBe(1);
    let [s] = await db.select().from(schema.shipments).where((await import("drizzle-orm")).eq(schema.shipments.id, sid));
    expect(s.status).toBe("out_for_delivery");
    expect(s.lastLocation).toBe("Mumbai DC");
    expect(s.pickupStatus).toBe("picked_up");
    await ingestEvents(sid, [{ status: "delivered", rawStatus: "DLVD", location: "Mumbai DC", occurredAt: t(8) }], "webhook");
    [s] = await db.select().from(schema.shipments).where((await import("drizzle-orm")).eq(schema.shipments.id, sid));
    expect(s.status).toBe("delivered");
    expect(s.deliveredAt?.toISOString()).toBe(t(8));
    const ev = await db.select().from(schema.shipmentEvents).where((await import("drizzle-orm")).eq(schema.shipmentEvents.shipmentId, sid));
    expect(ev).toHaveLength(4);
  });
  it("destination changes only on a carrier-confirmed amendment, with history", async () => {
    const id = await order({ status: "booked", ship: { status: "in_transit" } });
    const sid = id.replace("ord", "shp");
    const { eq } = await import("drizzle-orm");
    await ingestEvents(sid, [{ status: "in_transit", rawStatus: "SCAN", location: "Pune Hub", occurredAt: new Date(Date.UTC(2026, 10, 11, 1)).toISOString() }], "poll");
    let [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    expect((o.consignee as { city: string }).city).toBe("Mumbai"); // scan location never changes the address
    await ingestEvents(sid, [{ status: "in_transit", rawStatus: "ADDRESS UPDATED", occurredAt: new Date(Date.UTC(2026, 10, 11, 2)).toISOString(), destinationAmendment: { line1: "22 New Lane", pincode: "400002" } }], "webhook");
    [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    expect((o.consignee as { line1: string; pincode: string }).pincode).toBe("400002");
    const hist = await db.select().from(schema.destinationAmendments).where(eq(schema.destinationAmendments.orderId, id));
    expect(hist).toHaveLength(1);
    expect((hist[0].previous as { pincode: string }).pincode).toBe("400001");
  });
  it("isProgress: forward only, NDR ↔ re-attempt, terminal states final", () => {
    expect(isProgress("in_transit", "picked_up")).toBe(false);
    expect(isProgress("out_for_delivery", "ndr")).toBe(true);
    expect(isProgress("ndr", "out_for_delivery")).toBe(true);
    expect(isProgress("ndr", "rto_initiated")).toBe(true);
    expect(isProgress("delivered", "in_transit")).toBe(false);
    expect(isProgress("rto_delivered", "delivered")).toBe(false);
  });
});

describe("WhatsApp COD confirmation → pickup hold and automatic cancellation", () => {
  async function setup(shipStatus: string | null) {
    const d = await import("drizzle-orm");
    const id = await order(shipStatus ? { status: "booked", ship: { status: shipStatus } } : { status: "cod_hold" });
    const cid = `cc_${id}`;
    await db.insert(schema.codConfirmations).values({ id: cid, orgId: ORG, orderId: id, status: "pending", sentAt: new Date() });
    return { id, cid, sid: id.replace("ord", "shp"), d };
  }
  beforeAll(async () => {
    await db.insert(schema.providerAccounts).values({ id: "pa", adapter: "demo", category: "shipping", label: "Demo", status: "enabled" }).onConflictDoNothing();
    await db.insert(schema.wallets).values({ id: "w_test", orgId: ORG, postedPaise: 100000 }).onConflictDoNothing();
  });
  it("Yes / Confirm keeps the order active and releases the hold", async () => {
    const { applyDecision, pickupBlockedByCod } = await import("@/server/whatsapp/service");
    const { id, cid, d } = await setup(null);
    expect(await pickupBlockedByCod(id)).toMatch(/Waiting for the buyer/);
    const r = await applyDecision({ confirmationId: cid, decision: "confirm", source: "buyer" });
    expect(r.status).toBe("confirmed");
    const [o] = await db.select().from(schema.orders).where(d.eq(schema.orders.id, id));
    expect(o.status).toBe("ready");
    expect(await pickupBlockedByCod(id)).toBeNull();
    // duplicate / late callback is ignored
    expect((await applyDecision({ confirmationId: cid, decision: "cancel", source: "buyer" })).ok).toBe(false);
  });
  it("No / Cancel before pickup: pickup blocked, courier cancels, refund once", async () => {
    const { applyDecision, pickupBlockedByCod, runCarrierCancellation } = await import("@/server/whatsapp/service");
    const { cid, sid, id, d } = await setup("booked");
    const r = await applyDecision({ confirmationId: cid, decision: "cancel", source: "buyer" });
    expect(r).toMatchObject({ status: "rejected", cancellation: "requested" });
    expect(await pickupBlockedByCod(id)).toMatch(/cancellation with the courier is in progress/);
    expect(await runCarrierCancellation(cid, sid, 1)).toEqual({ done: true });
    expect(await runCarrierCancellation(cid, sid, 1)).toEqual({ done: true }); // retry is a no-op
    const [s] = await db.select().from(schema.shipments).where(d.eq(schema.shipments.id, sid));
    const [c] = await db.select().from(schema.codConfirmations).where(d.eq(schema.codConfirmations.id, cid));
    expect(s.status).toBe("cancelled");
    expect(c.cancellationStatus).toBe("cancelled");
    const refunds = await db.select().from(schema.ledgerEntries).where(d.eq(schema.ledgerEntries.idempotencyKey, `refund:cancel:${sid}`));
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amountPaise).toBe(10000);
  });
  it("No after pickup: no cancellation is sent, Action Required is raised", async () => {
    const { applyDecision } = await import("@/server/whatsapp/service");
    const { cid, d } = await setup("picked_up");
    const r = await applyDecision({ confirmationId: cid, decision: "cancel", source: "buyer" });
    expect(r.cancellation).toBe("action_required");
    const [c] = await db.select().from(schema.codConfirmations).where(d.eq(schema.codConfirmations.id, cid));
    expect(c.cancellationReason).toMatch(/no longer accepts cancellation/);
  });
});

describe("label PDFs (generated demo labels)", { timeout: 20_000 }, () => {
  async function pdfInfo(bytes: Uint8Array) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      const text = (await p.getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" ");
      pages.push({ wMm: Math.round((vp.width * 25.4) / 72), hMm: Math.round((vp.height * 25.4) / 72), rotate: p.rotate, text });
    }
    return pages;
  }
  it("multi-box: one page per box with piece identification, sizes as chosen", async () => {
    const { renderLabels } = await import("@/server/labels/render");
    const id = await order({ status: "booked", ship: { status: "booked" } });
    await db.insert(schema.packages).values({ id: `pk_${id}`, orderId: id, count: 3, lengthMm: 300, breadthMm: 250, heightMm: 200, actualWeightGrams: 2500 });
    const sid = id.replace("ord", "shp");
    const r = await renderLabels(ORG, [sid], "thermal_4x4");
    expect(r.skipped).toEqual([]);
    const pages = await pdfInfo(r.pdf!);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => [p.wMm, p.hMm])).toEqual([[102, 102], [102, 102], [102, 102]]);
    expect(pages[0].text).toContain(`AWB AWB${n}`);
    expect(pages[1].text).toContain("CARTON 2 OF 3");
    expect(pages[2].text).toContain("PIN 400001");
    expect(pages[0].text).toContain("COD"); // payment mode is shown …
    expect(pages[0].text).not.toMatch(/Rs.?s?500/); // … the COD amount never is
  });
  it("38 × 100 mm: barcode runs along the long side (page rotated), still readable", async () => {
    const { renderLabels } = await import("@/server/labels/render");
    const id = await order({ status: "booked", ship: { status: "booked" } });
    const r = await renderLabels(ORG, [id.replace("ord", "shp")], "thermal_38x100");
    expect(r.skipped).toEqual([]);
    const [p] = await pdfInfo(r.pdf!);
    expect(p.rotate).toBe(90);
    expect([p.wMm, p.hMm]).toEqual([38, 100]); // viewport after rotation = printed size
    expect(p.text).toContain("AWB AWB");
  });
  it("bulk: other accounts' and cancelled shipments are skipped with a reason", async () => {
    const { renderLabels } = await import("@/server/labels/render");
    const mine = (await order({ status: "booked", ship: { status: "booked" } })).replace("ord", "shp");
    const cancelled = (await order({ status: "cancelled", ship: { status: "cancelled", booking: "cancelled" } })).replace("ord", "shp");
    const theirs = (await order({ org: OTHER, status: "booked", ship: { status: "booked" } })).replace("ord", "shp");
    const r = await renderLabels(ORG, [mine, cancelled, theirs], "thermal_3x4");
    expect(r.pages).toBe(1);
    expect(r.skipped.map((s) => s.reason)).toEqual(expect.arrayContaining(["Not found", "Shipment cancelled"]));
  });
});

describe("WhatsApp COD display status", () => {
  const base = { paymentType: "cod", included: true, enabled: true, confirmation: null, messageStatus: null };
  it("not applicable for prepaid and FOD", () => {
    expect(codDisplay({ ...base, paymentType: "prepaid" }).buyer).toBe("not_applicable");
    expect(codDisplay({ ...base, paymentType: "fod" }).buyer).toBe("not_applicable");
  });
  it("setup required / disabled", () => {
    expect(codDisplay({ ...base, included: false }).buyer).toBe("setup_required");
    expect(codDisplay({ ...base, enabled: null }).buyer).toBe("setup_required");
    expect(codDisplay({ ...base, enabled: false }).buyer).toBe("disabled");
  });
  it("message progress and buyer decisions; cancellation shown separately", () => {
    const c = (status: string, cancellationStatus: string | null = null, messageStatus: string | null = null) => codDisplay({ ...base, confirmation: { status, cancellationStatus }, messageStatus });
    expect(c("pending").buyer).toBe("pending");
    expect(c("pending", null, "sent").buyer).toBe("sent");
    expect(c("pending", null, "read").buyer).toBe("delivered");
    expect(c("pending", null, "failed").buyer).toBe("message_failed");
    expect(c("send_failed").buyer).toBe("message_failed");
    expect(c("confirmed").buyer).toBe("confirmed");
    expect(c("no_response").buyer).toBe("no_response");
    expect(c("rejected", "requested")).toMatchObject({ buyer: "rejected", cancellation: "cancellation_pending" });
    expect(c("rejected", "cancelled").cancellation).toBe("cancelled");
    expect(c("rejected", "action_required").cancellation).toBe("cancellation_failed");
  });
});

describe("label formats", () => {
  it("demo courier: every layout generated", () => {
    expect(labelFormatsFor("demo").every((x) => x.ok)).toBe(true);
  });
  it("every size is the Vishwaship label; Carrier label = the courier's own default size", () => {
    for (const f of ["a4_2up", "a4_4up", "thermal_4x6", "thermal_3x4", "thermal_4x4", "thermal_2x4", "thermal_38x100"] as const) expect(labelSource("delhivery_b2b", f).kind).toBe("branded");
    expect(labelSource("delhivery_b2c", "original")).toEqual({ kind: "carrier", carrierFormat: "thermal_4x6" });
    expect(labelSource("delhivery_b2b", "original")).toEqual({ kind: "carrier", carrierFormat: "thermal_3x4" });
  });
  it("a courier without a label integration: Vishwaship label yes, carrier label not faked", () => {
    expect(labelFormatsFor("bluedart").find((x) => x.key === "original")?.ok).toBe(false);
    expect(labelFormatsFor("bluedart").filter((x) => x.key !== "original").every((x) => x.ok)).toBe(true);
    expect(labelFormatsFor("shipmozo").find((x) => x.key === "original")?.ok).toBe(true); // Shipmozo get-order-label (PNG)
  });
  it("fitScale", () => {
    expect(fitScale([101.6, 152.4], [101.6, 101.6])).toBeCloseTo(0.667, 2);
    expect(fitScale([101.6, 152.4], [50.8, 101.6])).toBeLessThan(MIN_SCALE);
  });
});
