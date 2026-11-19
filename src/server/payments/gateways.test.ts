import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
// Razorpay API stand-in (no real network): orders and payments live here
const payments = new Map<string, { id: string; order_id: string; amount: number; currency: string; status: string }>();
let nextOrder = 0;
vi.mock("@/server/security/safe-fetch", () => ({
  safeFetch: async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.pathname === "/v1/orders" && init.method === "POST") return Response.json({ id: `order_${++nextOrder}` });
    const pay = u.pathname.match(/^\/v1\/payments\/(.+)$/);
    if (pay) return payments.has(pay[1]) ? Response.json(payments.get(pay[1])) : new Response("{}", { status: 404 });
    const op = u.pathname.match(/^\/v1\/orders\/(.+)\/payments$/);
    if (op) return Response.json({ items: [...payments.values()].filter((p) => p.order_id === op[1]) });
    return new Response("{}", { status: 404 });
  },
}));

const { encryptJson, hmacSha256Hex } = await import("@/server/security/crypto");
const S = await import("./settings");
const { createRazorpayOrder } = await import("./razorpay");
const webhook = await import("@/app/api/webhooks/razorpay/route");

const ORG = "org_pay";
const KEYS = { keyId: "rzp_live_ABCDEF123456", keySecret: "sec_live_1", webhookSecret: "whsec_1" };
const credits = async (rcId: string) => (await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.refType, "recharge"), eq(schema.ledgerEntries.refId, rcId)))).length;
const balance = async () => (await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, ORG)))[0].postedPaise;
const setPref = async (g: "razorpay" | "cashfree" | "none") => S.savePaymentSettings({ ...(await S.getPaymentSettings()), activeGateway: g });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: ORG, name: "P", businessName: "P Traders" });
  await db.insert(schema.wallets).values({ id: "wal_p", orgId: ORG });
});
beforeEach(async () => { await db.delete(schema.providerAccounts).where(eq(schema.providerAccounts.category, "payments")); });

describe("which recharge methods customers see", () => {
  it("Razorpay enabled + live keys is shown even when the old 'active gateway' setting says Cashfree or None (the bug)", async () => {
    await db.insert(schema.providerAccounts).values({ id: "pa_rz", adapter: "razorpay", category: "payments", label: "Razorpay", mode: "live", status: "enabled", secretsEnc: encryptJson(KEYS) });
    for (const pref of ["cashfree", "none", "razorpay"] as const) {
      await setPref(pref);
      expect((await S.usableGateways()).map((g) => g.gateway)).toEqual(["razorpay"]);
    }
    expect(await S.gatewayAvailability("razorpay")).toMatchObject({ usable: true, reason: expect.stringMatching(/shown to customers \(Live\)/) });
  });

  it("an empty placeholder Razorpay row (seed) never hides the configured one", async () => {
    await db.insert(schema.providerAccounts).values([
      { id: "pa_razorpay", adapter: "razorpay", category: "payments", label: "Razorpay", mode: "test", status: "enabled" },
      { id: "pa_rz2", adapter: "razorpay", category: "payments", label: "Razorpay", mode: "live", status: "enabled", secretsEnc: encryptJson(KEYS) },
    ]);
    const list = await S.usableGateways();
    expect(list.map((g) => g.acct.id)).toEqual(["pa_rz2"]);
    expect((await S.gatewayAccount("razorpay")).id).toBe("pa_rz2"); // Admin edits the same row customers use
    expect((await S.gatewayFor("razorpay"))?.acct.id).toBe("pa_rz2");
  });

  it("hidden when disabled, without keys, or with a key from the other mode — and Admin sees why", async () => {
    await db.insert(schema.providerAccounts).values({ id: "pa_rz3", adapter: "razorpay", category: "payments", label: "Razorpay", mode: "live", status: "disabled", secretsEnc: encryptJson(KEYS) });
    expect(await S.gatewayAvailability("razorpay")).toMatchObject({ usable: false, reason: expect.stringMatching(/disabled/) });
    await db.update(schema.providerAccounts).set({ status: "enabled", secretsEnc: encryptJson({ ...KEYS, keyId: "rzp_test_XYZ" }) }).where(eq(schema.providerAccounts.id, "pa_rz3"));
    expect(await S.gatewayAvailability("razorpay")).toMatchObject({ usable: false, reason: expect.stringMatching(/does not match Live/) });
    await db.update(schema.providerAccounts).set({ secretsEnc: null }).where(eq(schema.providerAccounts.id, "pa_rz3"));
    expect(await S.gatewayAvailability("razorpay")).toMatchObject({ usable: false, reason: expect.stringMatching(/keys are not saved/) });
    expect(await S.usableGateways()).toEqual([]);
  });

  it("both gateways on: both offered, the preferred one first; a chosen one is honoured", async () => {
    await db.insert(schema.providerAccounts).values([
      { id: "pa_rz4", adapter: "razorpay", category: "payments", label: "Razorpay", mode: "live", status: "enabled", secretsEnc: encryptJson(KEYS) },
      { id: "pa_cf", adapter: "cashfree", category: "payments", label: "Cashfree", mode: "live", status: "enabled", secretsEnc: encryptJson({ clientId: "cf", clientSecret: "cs" }) },
    ]);
    await setPref("cashfree");
    expect((await S.usableGateways()).map((g) => g.gateway)).toEqual(["cashfree", "razorpay"]);
    expect((await S.activeGateway("razorpay"))?.gateway).toBe("razorpay");
    expect((await S.activeGateway())?.gateway).toBe("cashfree");
  });
});

describe("Razorpay webhook replay", () => {
  it("a captured payment delivered twice (and with a new event id) credits the wallet exactly once", async () => {
    await db.insert(schema.providerAccounts).values({ id: "pa_rz5", adapter: "razorpay", category: "payments", label: "Razorpay", mode: "live", status: "enabled", secretsEnc: encryptJson(KEYS) });
    const rcId = "rch_hook";
    const order = await createRazorpayOrder(rcId, 1000_00);
    await db.insert(schema.recharges).values({ id: rcId, orgId: ORG, amountPaise: 1000_00, method: "razorpay", status: "payment_pending", payablePaise: 1000_00, razorpayOrderId: order.orderId, providerOrderId: order.orderId });
    payments.set("pay_1", { id: "pay_1", order_id: order.orderId, amount: 1000_00, currency: "INR", status: "captured" });
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } });
    const send = (eventId: string, sig = hmacSha256Hex(KEYS.webhookSecret, body)) => webhook.POST(new Request("https://vishwaship.in/api/webhooks/razorpay", { method: "POST", body, headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": eventId } }));
    const before = await balance();
    expect((await send("evt_1")).status).toBe(200);
    expect(await (await send("evt_1")).json()).toMatchObject({ duplicate: true });
    expect((await send("evt_2")).status).toBe(200); // Razorpay retry with another event id
    expect((await send("evt_3", "bad")).status).toBe(400); // forged signature
    expect(await credits(rcId)).toBe(1);
    expect((await balance()) - before).toBe(1000_00);
    const [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, rcId));
    expect(rc).toMatchObject({ status: "credited", razorpayPaymentId: "pay_1" });
  });

  it("a payment for a different amount or currency never credits", async () => {
    await db.insert(schema.providerAccounts).values({ id: "pa_rz6", adapter: "razorpay", category: "payments", label: "Razorpay", mode: "live", status: "enabled", secretsEnc: encryptJson(KEYS) });
    const rcId = "rch_mis";
    const order = await createRazorpayOrder(rcId, 500_00);
    await db.insert(schema.recharges).values({ id: rcId, orgId: ORG, amountPaise: 500_00, method: "razorpay", status: "payment_pending", payablePaise: 500_00, razorpayOrderId: order.orderId });
    payments.set("pay_2", { id: "pay_2", order_id: order.orderId, amount: 1_00, currency: "INR", status: "captured" });
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_2" } } } });
    await webhook.POST(new Request("https://x/api", { method: "POST", body, headers: { "x-razorpay-signature": hmacSha256Hex(KEYS.webhookSecret, body), "x-razorpay-event-id": "evt_m" } }));
    expect(await credits(rcId)).toBe(0);
    expect((await db.select().from(schema.recharges).where(eq(schema.recharges.id, rcId)))[0].status).toBe("mismatch");
  });
});
