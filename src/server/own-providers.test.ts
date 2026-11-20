import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

// Real SQL on in-memory PGlite; outbound HTTP is faked (no network in tests).
const client = new PGlite();
const db = drizzle(client, { schema });
const calls: Array<{ url: string; body: string }> = [];
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/security/safe-fetch", () => ({
  safeFetch: async (url: string, init: { body?: string } = {}) => {
    calls.push({ url, body: String(init.body ?? "") });
    if (url.includes("api.bolna.ai/call")) return new Response(JSON.stringify({ execution_id: "exec_own_1" }), { status: 200 });
    return new Response(JSON.stringify({ agent_name: "NDR agent" }), { status: 200 });
  },
}));

const own = await import("./own-providers");
const { pinInsights, buyerInsights } = await import("./insights");

const ORG = "org_own";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: ORG, name: "Own", businessName: "Own Store" });
  await db.insert(schema.creditBalances).values({ orgId: ORG, credits: 0 });
});

describe("client's own WhatsApp / AI calling", () => {
  it("keys are stored encrypted, shown only as hints, and need a passing test before switching on", async () => {
    expect((await own.saveOwn(ORG, "u1", "bolna", { apiKey: "bn-secret-key-123456", agentId: "agent-1" })).ok).toBe(true);
    const [row] = await db.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ORG));
    expect(JSON.stringify(row.value)).not.toContain("bn-secret-key-123456");
    const v = await own.ownOverview(ORG);
    expect(v.calling?.hints.apiKey).not.toContain("secret-key");
    expect(v.calling?.webhookUrl).toMatch(/\/api\/webhooks\/own\/c_/);
    expect((await own.setOwn(ORG, "u1", "calling", true)).ok).toBe(false); // not tested yet
    expect((await own.testOwn(ORG, "u1", "calling")).ok).toBe(true);
    expect((await own.setOwn(ORG, "u1", "calling", true)).ok).toBe(true);
    expect(await own.ownCalling(ORG)).not.toBeNull();
    // the webhook key leads back to this account
    const key = v.calling!.webhookUrl.split("/").pop()!;
    expect(await own.ownByWebhookKey(key)).toMatchObject({ orgId: ORG, kind: "calling", adapter: "bolna" });
    expect(await own.ownByWebhookKey("c_not-a-real-key-000000000")).toBeNull();
  });

  it("an AI NDR call on the client's own Bolna uses no Vishwaship credits", async () => {
    await db.insert(schema.orders).values({ id: "oo1", orgId: ORG, orderNumber: "VS-OWN1", mode: "B2C", paymentType: "cod", codAmountPaise: 50000, declaredValuePaise: 50000,
      consignee: { name: "Ravi", mobile: "9876543210", line1: "1 MG Road", city: "Pune", state: "MH", pincode: "411001" }, status: "booked" });
    await db.insert(schema.providerAccounts).values({ id: "pa_d", adapter: "demo", category: "shipping", label: "Demo", status: "enabled" });
    await db.insert(schema.shipments).values({ id: "so1", orgId: ORG, orderId: "oo1", providerAccountId: "pa_d", provider: "demo", carrierCode: "demo", carrierName: "Demo", serviceName: "Surface",
      awb: "AWBOWN1", bookingStatus: "confirmed", pickupStatus: "picked_up", status: "ndr", quoteId: "q", sellPaise: 10000, costPaise: 8000, chargeableWeightGrams: 500 });
    await db.insert(schema.ndrCases).values({ id: "ndr_own", orgId: ORG, shipmentId: "so1", kind: "ndr", reason: "Customer not available", attempt: 1 });
    const { placeNdrCall } = await import("./ndr/ai-call");
    expect(await placeNdrCall("ndr_own")).toEqual({ done: true });
    const [c] = await db.select().from(schema.ndrCases).where(eq(schema.ndrCases.id, "ndr_own"));
    expect((c.requestPayload as { aiCall: { state: string; credits: number } }).aiCall).toMatchObject({ state: "calling", credits: 0 });
    expect(calls.some((x) => x.url.includes("api.bolna.ai/call") && x.body.includes("agent-1"))).toBe(true);
  });

  it("own WhatsApp is used only for events that have a template", async () => {
    expect((await own.saveOwn(ORG, "u1", "aisensy", { apiKey: "eyJ-aisensy-key-1234567890", codTemplate: "cod_confirm_v1" })).ok).toBe(true);
    await own.testOwn(ORG, "u1", "whatsapp");
    await own.setOwn(ORG, "u1", "whatsapp", true);
    expect((await own.ownWhatsapp(ORG, "cod_confirmation"))?.templateName).toBe("cod_confirm_v1");
    expect(await own.ownWhatsapp(ORG, "out_for_delivery")).toBeNull();
  });
});

describe("delivery insights", () => {
  it("courier delivery % per PIN, and the buyer's record", async () => {
    await db.insert(schema.providerAccounts).values({ id: "pa_i", adapter: "demo", category: "shipping", label: "Demo", status: "enabled" }).onConflictDoNothing();
    for (let i = 0; i < 8; i++) {
      await db.insert(schema.orders).values({ id: `oi${i}`, orgId: ORG, orderNumber: `VS-I${i}`, mode: "B2C", paymentType: "cod", codAmountPaise: 30000, declaredValuePaise: 30000,
        consignee: { name: "Asha", mobile: "+91 98111 22233", line1: "x", city: "Delhi", state: "DL", pincode: "110001" }, status: "booked" });
      await db.insert(schema.shipments).values({ id: `si${i}`, orgId: ORG, orderId: `oi${i}`, providerAccountId: "pa_i", provider: "demo", carrierCode: i < 6 ? "fastco" : "slowco", carrierName: i < 6 ? "FastCo" : "SlowCo", serviceName: "Surface",
        awb: `AWBI${i}`, bookingStatus: "confirmed", pickupStatus: "picked_up", status: i === 5 ? "rto_delivered" : i < 6 ? "delivered" : "delivered", quoteId: "q", sellPaise: 1, costPaise: 1, chargeableWeightGrams: 500 });
    }
    const pin = await pinInsights("110001");
    expect(pin.fastco).toMatchObject({ delivered: 5, rto: 1, finished: 6, scope: "pin" });
    expect(pin.fastco.deliveredPct).toBeCloseTo(83.3, 1);
    expect(pin.slowco).toBeUndefined(); // only 2 shipments: not enough to judge
    const b = await buyerInsights("9811122233");
    expect(b).toMatchObject({ delivered: 7, returned: 1, label: "trusted" });
    expect((await buyerInsights("9000011111"))?.label).toBe("new");
  });
});
