import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/server/db/schema";

// Bug 2026-11-23: shipment statuses only moved after a manual Refresh. The poll must reach every active shipment,
// least recently checked first, and one hung job must not stop the queue.
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const runner = await import("./runner");
const { scheduleTrackingPolls } = await import("./handlers");

const now = new Date("2026-11-23T10:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
async function ship(id: string, status: string, o: Partial<typeof schema.shipments.$inferInsert> = {}) {
  await db.insert(schema.orders).values({ id: `o_${id}`, orgId: "org_j", orderNumber: `N${id}`, mode: "B2C", paymentType: "prepaid", declaredValuePaise: 1000, consignee: { name: "x" }, status: "booked" });
  await db.insert(schema.shipments).values({ id, orgId: "org_j", orderId: `o_${id}`, providerAccountId: "pa", provider: "delhivery_b2c", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "S",
    awb: `A${id}`, bookingStatus: "confirmed", status, quoteId: "q", sellPaise: 100, costPaise: 50, chargeableWeightGrams: 500, createdAt: ago(60), ...o });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: "org_j", name: "J", businessName: "J" });
  await ship("never", "pickup_pending");                                   // never checked → first
  await ship("stale", "in_transit", { lastSyncAt: ago(90) });              // checked 90 min ago
  await ship("recent", "in_transit", { lastSyncAt: ago(5) });              // just checked (webhook / Refresh) → skipped
  await ship("done", "delivered", { lastSyncAt: ago(500) });               // finished → never
  await ship("demo", "in_transit", { provider: "demo" });                  // demo network → never
  await ship("oldBooked", "booked", { createdAt: ago(60 * 24 * 60), lastSyncAt: ago(60) }); // 60-day-old booking checked 1 h ago → waits for 6 h
  await ship("oldBooked2", "booked", { createdAt: ago(60 * 24 * 60), lastSyncAt: ago(7 * 60) }); // … checked 7 h ago → due
});

describe("tracking polls", () => {
  it("queue every active shipment that is due, least recently checked first; skip finished, demo and just-checked ones", async () => {
    await scheduleTrackingPolls(now);
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.queue, "tracking.poll"));
    expect(jobs.map((j) => (j.payload as { shipmentId: string }).shipmentId)).toEqual(["never", "oldBooked2", "stale"]);
    // same 15-minute slot: nothing new
    await scheduleTrackingPolls(new Date(now.getTime() + 60_000));
    expect(await db.select().from(schema.jobs).where(eq(schema.jobs.queue, "tracking.poll"))).toHaveLength(3);
  });
});

describe("job runner", () => {
  it("a hung job times out and is retried later; the other jobs still run", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ran: string[] = [];
    runner.registerHandler("t.hang", () => new Promise(() => { /* never finishes */ }));
    runner.registerHandler("t.ok", async (p) => { ran.push(String(p.n)); return { done: true }; });
    await db.delete(schema.jobs);
    await runner.enqueue("t.hang", {}, { dedupeKey: "hang" });
    for (const n of [1, 2, 3]) await runner.enqueue("t.ok", { n }, { dedupeKey: `ok${n}` });
    const p = runner.runDueJobs(10, 2);
    await vi.advanceTimersByTimeAsync(runner.JOB_TIMEOUT_MS + 1000);
    expect(await p).toBe(4);
    vi.useRealTimers();
    expect(ran.sort()).toEqual(["1", "2", "3"]);
    const [h] = await db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, "hang"));
    expect(h.status).toBe("queued");
    expect(h.lastError).toMatch(/Timed out/);
  });
  it("jobs left 'running' by a restart go back in the queue after 10 minutes", async () => {
    await runner.enqueue("t.ok", { n: 9 }, { dedupeKey: "stuck" });
    await db.execute(sql`update jobs set status = 'running', run_at = now() - interval '11 minutes' where dedupe_key = 'stuck'`);
    await runner.enqueue("t.ok", { n: 10 }, { dedupeKey: "busy" });
    await db.execute(sql`update jobs set status = 'running', run_at = now() - interval '2 minutes' where dedupe_key = 'busy'`);
    expect(await runner.requeueStuckJobs()).toBe(1);
    const rows = await db.select().from(schema.jobs);
    expect(rows.find((r) => r.dedupeKey === "stuck")?.status).toBe("queued");
    expect(rows.find((r) => r.dedupeKey === "busy")?.status).toBe("running");
  });
});
