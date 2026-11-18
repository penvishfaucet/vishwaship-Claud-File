import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

// Real Postgres semantics (PGlite + the project's migrations): conditional claims, unique UTR index, ledger idempotency.
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const { manualQuote } = await import("@/lib/recharge");
const R = await import("./recharge");

const ORG = "org_a", OTHER = "org_b", STAFF = "usr_staff", STAFF2 = "usr_staff2", CUST = "usr_cust";
const proof = { key: "recharge-proofs/x.png", name: "x.png", mime: "image/png" };
const submit = (utr: string, org = ORG, rupees = 1000) => R.submitManual({ orgId: org, userId: CUST, rechargePaise: rupees * 100, discountBps: 50, reportedPaidPaise: manualQuote(rupees * 100, 50).payablePaise, utr, paidAt: new Date(), remarks: "", proof });
const balance = async (org = ORG) => (await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, org)))[0].postedPaise;
const credits = async (rcId: string) => (await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.refType, "recharge"), eq(schema.ledgerEntries.refId, rcId)))).length;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: ORG, name: "A", businessName: "A Traders" }, { id: OTHER, name: "B", businessName: "B Traders" }]);
  await db.insert(schema.wallets).values([{ id: "wal_a", orgId: ORG }, { id: "wal_b", orgId: OTHER }]);
});

describe("manual UPI discount", () => {
  it("₹1,000 at 0.5 % → discount ₹5, pay ₹995, credit ₹1,000", () => {
    expect(manualQuote(1000_00, 50)).toEqual({ rechargePaise: 100000, discountBps: 50, discountPaise: 500, payablePaise: 99500, creditPaise: 100000 });
  });
  it("rounds the discount half-up to the paisa", () => {
    expect(manualQuote(1234_00, 50).discountPaise).toBe(617); // 6.17
    expect(manualQuote(1001_00, 50).discountPaise).toBe(501); // 5.005 → 5.01
    expect(manualQuote(500_00, 0).payablePaise).toBe(50000);
  });
});

describe("manual recharge request", () => {
  it("submission creates a Pending Verification request, a linked ticket and an Admin alert — and no credit", async () => {
    const r = await submit("UTR111111111");
    const [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, r.id));
    expect(rc.status).toBe("pending_verification");
    expect(rc.amountPaise).toBe(100000); expect(rc.payablePaise).toBe(99500); expect(rc.discountPaise).toBe(500); expect(rc.discountBps).toBe(50);
    expect(rc.requestNumber).toMatch(/^RR\d+$/);
    const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, rc.ticketId!));
    expect(t.orgId).toBe(ORG); expect(t.category).toBe("wallet_recharge");
    expect((await db.select().from(schema.staffAlerts)).some((a) => a.href?.includes(r.id))).toBe(true);
    expect(await credits(r.id)).toBe(0);
    expect(await balance()).toBe(0);
  });

  it("approval credits the full amount exactly once (double click and two admins at once)", async () => {
    const r = await submit("UTR222222222");
    const before = await balance();
    const [a, b] = await Promise.all([R.approveManual(r.id, STAFF), R.approveManual(r.id, STAFF2)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const again = await R.approveManual(r.id, STAFF);
    expect(again.ok).toBe(false);
    expect(await credits(r.id)).toBe(1);
    expect((await balance()) - before).toBe(100000);
    const [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, r.id));
    expect(rc.status).toBe("credited"); expect(rc.decidedBy).toMatch(/usr_staff/); expect(rc.decidedAt).toBeTruthy();
  });

  it("flags a reused UTR and blocks approving a second request with it", async () => {
    const first = await submit("UTR333333333");
    const second = await submit("utr 333333333"); // normalised to the same UTR
    expect(second.utrDuplicate).toBe(true);
    expect((await R.approveManual(first.id, STAFF)).ok).toBe(true);
    const blocked = await R.approveManual(second.id, STAFF);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/already used/i);
    expect(await credits(second.id)).toBe(0);
  });

  it("request info → customer replies → reject with reason", async () => {
    const r = await submit("UTR444444444");
    expect((await R.requestInfo(r.id, STAFF, "Please upload the full receipt")).ok).toBe(true);
    let [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, r.id));
    expect(rc.status).toBe("info_required");
    expect((await R.provideInfo({ id: r.id, orgId: OTHER, userId: "x", message: "hi" })).ok).toBe(false); // other customer
    expect((await R.provideInfo({ id: r.id, orgId: ORG, userId: CUST, message: "Uploaded again" })).ok).toBe(true);
    [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, r.id));
    expect(rc.status).toBe("pending_verification");
    expect((await R.rejectManual(r.id, STAFF, "No matching payment received")).ok).toBe(true);
    [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, r.id));
    expect(rc.status).toBe("rejected"); expect(rc.decisionNote).toBe("No matching payment received");
    expect((await R.approveManual(r.id, STAFF)).ok).toBe(false);
    const msgs = await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, rc.ticketId!));
    expect(msgs.some((m) => m.authorKind === "staff" && m.body.includes("No matching payment received"))).toBe(true);
  });
});

describe("online gateway settlement", () => {
  it("duplicate success callbacks (checkout + webhook + reconcile) credit once", async () => {
    await db.insert(schema.recharges).values({ id: "rch_online1", orgId: OTHER, amountPaise: 50000, method: "cashfree", status: "payment_pending", providerOrderId: "rch_online1" });
    const ev = { paymentId: "cf_1", amountPaise: 50000, currency: "INR", outcome: "success" as const };
    const res = await Promise.all([R.settleOnline("rch_online1", { ...ev, source: "checkout" }), R.settleOnline("rch_online1", { ...ev, source: "webhook" }), R.settleOnline("rch_online1", { ...ev, source: "reconcile" })]);
    expect(res.every((x) => x.ok)).toBe(true);
    expect(await credits("rch_online1")).toBe(1);
    expect(await balance(OTHER)).toBe(50000);
  });
  it("an amount mismatch never credits", async () => {
    await db.insert(schema.recharges).values({ id: "rch_online2", orgId: OTHER, amountPaise: 50000, method: "razorpay", status: "payment_pending" });
    const r = await R.settleOnline("rch_online2", { paymentId: "pay_x", amountPaise: 100, currency: "INR", outcome: "success", source: "webhook" });
    expect(r.ok).toBe(false);
    expect(await credits("rch_online2")).toBe(0);
  });
  it("a failed payment marks the recharge failed; a later success still credits once", async () => {
    await db.insert(schema.recharges).values({ id: "rch_online3", orgId: OTHER, amountPaise: 20000, method: "razorpay", status: "payment_pending" });
    await R.settleOnline("rch_online3", { paymentId: "pay_f", amountPaise: 20000, currency: "INR", outcome: "failed", source: "webhook" });
    expect((await db.select().from(schema.recharges).where(eq(schema.recharges.id, "rch_online3")))[0].status).toBe("failed");
    expect((await R.settleOnline("rch_online3", { paymentId: "pay_ok", amountPaise: 20000, currency: "INR", outcome: "success", source: "webhook" })).ok).toBe(true);
    expect(await credits("rch_online3")).toBe(1);
  });
});
