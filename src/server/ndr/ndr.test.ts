import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

// Real SQL on in-memory PGlite: NDR case opening, the AI-call answer, credits and the manual push queue.
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const { openNdrCase, requestNdrAction, markPushed } = await import("./service");
const { handleBolnaWebhook, decisionOf } = await import("./ai-call");

const ORG = "org_ndr";
let n = 0;
async function shipment(provider: "demo" | "delhivery_b2b") {
  const i = ++n;
  await db.insert(schema.orders).values({ id: `o${i}`, orgId: ORG, orderNumber: `VS-N${i}`, mode: "B2C", paymentType: "cod", codAmountPaise: 50000, declaredValuePaise: 50000,
    consignee: { name: "Ravi Kumar", mobile: "9876543210", line1: "1 MG Road", city: "Bengaluru", state: "KA", pincode: "560001" }, status: "booked" });
  await db.insert(schema.shipments).values({ id: `s${i}`, orgId: ORG, orderId: `o${i}`, providerAccountId: provider === "demo" ? "pa_demo" : "pa_dl", provider, carrierCode: provider, carrierName: provider === "demo" ? "Demo" : "Delhivery", serviceName: "Surface",
    awb: `AWBN${i}`, bookingStatus: "confirmed", pickupStatus: "picked_up", status: "ndr", quoteId: "q", sellPaise: 10000, costPaise: 8000, chargeableWeightGrams: 500 });
  return `s${i}`;
}
const caseOf = async (id: string) => (await db.select().from(schema.ndrCases).where(eq(schema.ndrCases.id, id)))[0];
const credits = async () => (await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.orgId, ORG)))[0].credits;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: ORG, name: "NDR Test", businessName: "NDR Test Store" });
  await db.insert(schema.providerAccounts).values([
    { id: "pa_demo", adapter: "demo", category: "shipping", label: "Demo", status: "enabled" },
    { id: "pa_dl", adapter: "delhivery_b2b", category: "shipping", label: "Delhivery B2B", status: "enabled" },
  ]);
  await db.insert(schema.creditBalances).values({ orgId: ORG, credits: 100 });
});

describe("NDR cases", () => {
  it("open automatically, one per failed attempt, and start the AI call only when switched on", async () => {
    const sid = await shipment("demo");
    const id1 = (await openNdrCase(sid))!;
    expect(await openNdrCase(sid)).toBe(id1); // same attempt reported twice
    expect((await caseOf(id1)).attempt).toBe(1);
    expect(await db.select().from(schema.jobs).where(eq(schema.jobs.queue, "ndr.ai_call"))).toHaveLength(0);

    await db.insert(schema.notificationSettings).values({ id: "ns_v", orgId: ORG, channel: "voice", event: "ndr_ai_call", enabled: true });
    const sid2 = await shipment("demo");
    const id2 = (await openNdrCase(sid2))!;
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.queue, "ndr.ai_call"));
    expect(jobs.map((j) => (j.payload as { caseId: string }).caseId)).toContain(id2);
  });

  it("a courier without an NDR API goes to the Vishwaship push queue; marking it pushed closes it", async () => {
    const id = (await openNdrCase(await shipment("delhivery_b2b")))!;
    const r = await requestNdrAction({ caseId: id, orgId: ORG, kind: "reattempt", source: "client" });
    expect(r).toMatchObject({ ok: true, status: "queued" });
    const c = await caseOf(id);
    expect(c.status).toBe("action_requested");
    expect((c.requestPayload as { manual?: boolean }).manual).toBe(true);
    expect((await db.select().from(schema.staffAlerts).where(eq(schema.staffAlerts.kind, "ndr_push"))).length).toBeGreaterThan(0);
    // a second click (or a late AI answer) cannot act again
    expect((await requestNdrAction({ caseId: id, orgId: ORG, kind: "rto", source: "ai_call" })).ok).toBe(false);
    expect(await markPushed(id, "staff_1")).toBe(true);
    expect((await caseOf(id)).status).toBe("acknowledged");
  });
});

describe("AI call result (Bolna webhook)", () => {
  async function calling(exec: string, provider: "demo" | "delhivery_b2b" = "demo") {
    const id = (await openNdrCase(await shipment(provider)))!;
    await db.update(schema.creditBalances).set({ credits: 68 }).where(eq(schema.creditBalances.orgId, ORG)); // 100 − 32 held
    await db.insert(schema.creditEntries).values({ id: `ce_${exec}`, orgId: ORG, kind: "settle", credits: -32, idempotencyKey: `ndr:charge:${id}:1`, refType: "ndr_ai_call", refId: `${id}:1` });
    await db.update(schema.ndrCases).set({ requestPayload: { aiCall: { state: "calling", attempts: 1, executionId: exec, credits: 32, chargedKey: `${id}:1`, updatedAt: "" } } }).where(eq(schema.ndrCases.id, id));
    return id;
  }

  it("buyer says yes → re-attempt sent to the courier, credits kept", async () => {
    const id = await calling("ex_yes");
    const r = await handleBolnaWebhook({ id: "ex_yes", status: "completed", conversation_duration: 48, extracted_data: { ndr_decision: "reattempt", preferred_date: "tomorrow evening" } });
    expect(r.result).toBe("ok:reattempt:acknowledged");
    const c = await caseOf(id);
    expect(c).toMatchObject({ status: "acknowledged", requestedAction: "reattempt" });
    expect((c.requestPayload as { aiCall: { preferredDate: string } }).aiCall.preferredDate).toBe("tomorrow evening");
    expect(await credits()).toBe(68);
    expect((await handleBolnaWebhook({ id: "ex_yes", status: "completed" })).result).toBe("duplicate");
  });

  it("buyer says no → return requested (queued for the team when the courier has no API)", async () => {
    const id = await calling("ex_no", "delhivery_b2b");
    const r = await handleBolnaWebhook({ execution_id: "ex_no", status: "completed", conversation_duration: 30, extracted_data: { ndr_decision: "rto" } });
    expect(r.result).toBe("ok:rto:queued");
    expect(await caseOf(id)).toMatchObject({ status: "action_requested", requestedAction: "rto" });
  });

  it("no answer → credits given back and one more call scheduled", async () => {
    const id = await calling("ex_na");
    const r = await handleBolnaWebhook({ id: "ex_na", status: "no-answer", conversation_duration: 0 });
    expect(r.result).toBe("ok:no_answer");
    expect(await credits()).toBe(100);
    const retry = await db.select().from(schema.jobs).where(and(eq(schema.jobs.queue, "ndr.ai_call"), eq(schema.jobs.dedupeKey, `ndr.ai_call:${id}:2`)));
    expect(retry).toHaveLength(1);
    expect((await caseOf(id)).status).toBe("open");
  });
});

describe("reading the buyer's answer", () => {
  it("from extracted fields, in English or Hindi", () => {
    expect(decisionOf({ extracted_data: { ndr_decision: "reattempt" } }).outcome).toBe("reattempt");
    expect(decisionOf({ extracted_data: { wants_delivery: "Yes" } }).outcome).toBe("reattempt");
    expect(decisionOf({ extracted_data: { customer_decision: "haan, kal bhej do" } }).outcome).toBe("reattempt");
    expect(decisionOf({ extracted_data: { wants_delivery: "No" } }).outcome).toBe("rto");
    expect(decisionOf({ extracted_data: { decision: "nahi chahiye, cancel" } }).outcome).toBe("rto");
    expect(decisionOf({ extracted_data: {} }).outcome).toBe("unclear");
  });
});
