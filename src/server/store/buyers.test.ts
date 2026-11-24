import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));
const mails: Array<{ event: string; to: string; vars: Record<string, string> }> = [];
vi.mock("@/server/auth/firebase-phone", () => ({ firebasePhoneConfig: async () => ({ apiKey: "AIza-vs", authDomain: "vs.firebaseapp.com", projectId: "vishwaship-app" }) }));
vi.mock("@/server/email/service", () => ({
  getAuthSettings: async () => ({ googleEnabled: true, otpValidityMin: 10, otpCooldownSec: 0, otpMaxAttempts: 3 }),
  sendEmail: async (a: { event: string; to: string; vars: Record<string, string> }) => { mails.push(a); return { status: "sent" }; },
}));

const B = await import("./buyers");
const R = await import("./returns");
const O = await import("./orders");

const store = { id: "st_a", orgId: "org_a", name: "Asha Crafts", slug: "asha" };
const settings = { checkout: { returnDays: 7, exchangeEnabled: true } };
const buyerJson = (mobile: string, email = "") => ({ name: "Ravi", mobile, email, line1: "12 MG Road", line2: "", pincode: "411001", city: "Pune", state: "Maharashtra" });
let n = 0;
async function order(mobile: string, extra: Partial<typeof schema.storeOrders.$inferInsert> = {}) {
  const id = `so_${++n}`;
  await db.insert(schema.storeOrders).values({ id, storeId: store.id, orgId: store.orgId, number: `ASHA${1000 + n}`, checkoutKey: `k${n}`, buyerToken: `tok${n}`, status: "placed",
    paymentMethod: "cod", paymentStatus: "cod_pending", buyer: buyerJson(mobile), lines: [{ productId: "p1", variantId: null, title: "Kurta", variantTitle: "M", qty: 2, unitPaise: 50000 }],
    subtotalPaise: 100000, totalPaise: 100000, placedAt: new Date(), ...extra });
  return id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: store.orgId, name: "A", businessName: "Asha" });
  await db.insert(schema.stores).values({ id: store.id, orgId: store.orgId, name: store.name, slug: store.slug, status: "live", settings });
});

describe("store buyer accounts", () => {
  it("email code login: wrong code counts attempts, right code signs in once, session is per store and signed", async () => {
    await B.sendEmailCode(store, "Ravi@Example.com", "1.1.1.1");
    const code = mails.at(-1)!.vars.otp;
    expect(mails.at(-1)!.event).toBe("store_buyer_otp");
    await expect(B.loginWithEmailCode(store, "ravi@example.com", code === "000000" ? "111111" : "000000")).rejects.toThrow(/Incorrect code/);
    const me = await B.loginWithEmailCode(store, "ravi@example.com", code);
    expect(me.email).toBe("ravi@example.com");
    await expect(B.loginWithEmailCode(store, "ravi@example.com", code)).rejects.toThrow(/first|already/);
    expect((await B.currentBuyer(store.id))?.id).toBe(me.id);
    expect(await B.currentBuyer("st_other")).toBeNull();
    // a tampered cookie is refused
    const [k, v] = [...jar.entries()].find(([name]) => name.startsWith("sfb_"))!;
    jar.set(k, v.replace(/^[^.]+/, "sb_someone_else"));
    expect(await B.currentBuyer(store.id)).toBeNull();
    jar.set(k, v);
  });

  it("mobile login creates one account per number; orders: own account + own number only", async () => {
    const me = await B.loginWithPhoneToken(store, "9876543210");
    const again = await B.loginWithPhoneToken(store, "9876543210");
    expect(again.id).toBe(me.id);
    const mine = await order("9876543210");
    const linked = await order("9000000000", { buyerId: me.id }); // placed while logged in, other phone number
    await order("9111111111"); // someone else
    const list = await O.buyerOrders(me);
    expect(list.map((o) => o.id).sort()).toEqual([linked, mine].sort());
    expect(await O.buyerOwnOrder(me, "ASHA1003")).toBeNull();
  });

  it("addresses: max 10, exactly one default, checkout remembers a new address once", async () => {
    const me = (await B.loginWithPhoneToken(store, "9876543210"));
    const id1 = await B.upsertAddress(me, { name: "Ravi", mobile: "+91 98765 43210", line1: "12 MG Road", pincode: "411001", city: "Pune", state: "Maharashtra" });
    let cur = (await B.currentBuyer(store.id))!;
    expect(cur.addresses).toHaveLength(1);
    expect(cur.addresses[0]).toMatchObject({ id: id1, mobile: "9876543210", isDefault: true });
    await B.upsertAddress(cur, { name: "Ravi", mobile: "9876543210", line1: "Office 4", pincode: "411002", city: "Pune", state: "Maharashtra", isDefault: true });
    cur = (await B.currentBuyer(store.id))!;
    expect(cur.addresses.filter((a) => a.isDefault).map((a) => a.line1)).toEqual(["Office 4"]);
    await B.rememberAddress(cur.id, buyerJson("9876543210")); // same line1 + pincode as the first: not added again
    await B.rememberAddress(cur.id, { ...buyerJson("9876543210"), line1: "New flat 9", pincode: "411005" });
    cur = (await B.currentBuyer(store.id))!;
    expect(cur.addresses.map((a) => a.line1)).toEqual(["12 MG Road", "Office 4", "New flat 9"]);
    await B.deleteAddress(cur, cur.addresses.find((a) => a.isDefault)!.id);
    cur = (await B.currentBuyer(store.id))!;
    expect(cur.addresses.filter((a) => a.isDefault)).toHaveLength(1);
    await expect(B.upsertAddress(cur, { name: "R", mobile: "123", line1: "x", pincode: "1", city: "", state: "" })).rejects.toThrow();
  });
});

describe("buyer OTP source and charges (Connect apps)", () => {
  it("Vishwaship OTP by default, own Firebase when filled in, none for email-only", async () => {
    expect((await B.buyerOtpConfig({}))?.source).toBe("vishwaship");
    expect(await B.buyerOtpConfig({ buyerLogin: { otp: "email_only" } })).toBeNull();
    expect(await B.buyerOtpConfig({ buyerLogin: { otp: "own_firebase", firebase: { apiKey: "", authDomain: "", projectId: "" } } })).toBeNull();
    const own = await B.buyerOtpConfig({ buyerLogin: { otp: "own_firebase", firebase: { apiKey: "AIza-own", authDomain: "brand.firebaseapp.com", projectId: "brand-1", appId: "" } } });
    expect(own).toEqual({ source: "own", config: { apiKey: "AIza-own", authDomain: "brand.firebaseapp.com", projectId: "brand-1" } });
  });
  it("Vishwaship OTP logins take credits once per number per 10 minutes, and stop at zero", async () => {
    await db.insert(schema.creditBalances).values({ orgId: store.orgId, credits: 6 }).onConflictDoNothing();
    expect(await B.chargeOtpCredits(store.orgId, store.id, "9333333333")).toBe(true);
    expect(await B.chargeOtpCredits(store.orgId, store.id, "9333333333")).toBe(true); // same number again: free
    const [bal] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.orgId, store.orgId));
    expect(bal.credits).toBe(2);
    expect(await B.chargeOtpCredits(store.orgId, store.id, "9444444444")).toBe(false); // 2 left, needs 4
  });
});

describe("return / exchange requests", () => {
  it("only after delivery, within the window, once per order; merchant approves / rejects with a reason", async () => {
    const id = await order("9222222222", { buyer: buyerJson("9222222222", "buyer@example.com") });
    const [row] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, id));
    const view = (await O.storeOrderForOrg(store.orgId, id))!;
    // not delivered yet
    expect(R.returnWindow(view, settings).allowed).toBe(false);
    const delivered = { ...view, fulfilment: "delivered" as const, deliveredAt: new Date(Date.now() - 2 * 86400_000) };
    expect(R.returnWindow(delivered, settings).allowed).toBe(true);
    expect(R.returnWindow({ ...delivered, deliveredAt: new Date(Date.now() - 9 * 86400_000) }, settings).allowed).toBe(false);
    expect(R.returnWindow(delivered, { checkout: { returnDays: 0 } }).allowed).toBe(false);
    // asking for more than was bought, or "Other" without details, is refused
    await expect(R.requestReturn({ id: store.id, settings }, delivered, { type: "return", reason: "Size or fit issue", lines: [{ index: 0, qty: 3 }] })).rejects.toThrow(/Choose items/);
    await expect(R.requestReturn({ id: store.id, settings }, delivered, { type: "return", reason: "Other", lines: [{ index: 0, qty: 1 }] })).rejects.toThrow();
    const req = await R.requestReturn({ id: store.id, settings }, delivered, { type: "exchange", reason: "Size or fit issue", note: "Need L", lines: [{ index: 0, qty: 1 }] });
    expect(req.status).toBe("requested");
    await expect(R.requestReturn({ id: store.id, settings }, delivered, { type: "return", reason: "Size or fit issue", lines: [{ index: 0, qty: 1 }] })).rejects.toThrow(/already/);
    // merchant: another org cannot decide; reject needs a reason; approve → complete
    await expect(R.decideReturn("org_b", id, "approve", "")).rejects.toThrow(/No return request/);
    await expect(R.decideReturn(store.orgId, id, "reject", "")).rejects.toThrow(/reason/);
    await expect(R.decideReturn(store.orgId, id, "complete", "")).rejects.toThrow(/already/);
    const ok = await R.decideReturn(store.orgId, id, "approve", "Courier picks up on Friday");
    expect(ok.status).toBe("approved");
    expect(mails.at(-1)).toMatchObject({ event: "store_return_update", to: "buyer@example.com" });
    expect((await R.decideReturn(store.orgId, id, "complete", "Exchanged")).status).toBe("completed");
    expect(row.returnRequest).toBeNull();
  });
});
