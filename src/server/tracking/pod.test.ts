import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { PodResult, Result, ShippingAdapter } from "@/server/providers/types";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

// in-memory private storage
const store = new Map<string, Buffer>();
vi.mock("@/server/storage", () => ({
  putPrivate: async (k: string, b: Buffer) => { store.set(k, b); },
  getPrivate: async (k: string) => { const b = store.get(k); if (!b) throw new Error("missing"); return b; },
}));

// a courier whose POD reply each test controls
let podReply: () => Promise<Result<PodResult>> = async () => ({ ok: true, value: { ready: false, files: [] } });
const podAdapter = { key: "podco", implemented: ["track", "pod"], pod: () => podReply() } as unknown as ShippingAdapter;
const noPodAdapter = { key: "plain", implemented: ["track"] } as unknown as ShippingAdapter;
vi.mock("@/server/providers/registry", () => ({
  adapterFor: (a: { adapter: string }) => (a.adapter === "podco" ? podAdapter : noPodAdapter),
  getAdapter: (k: string) => (k === "podco" ? podAdapter : noPodAdapter),
  providerContext: async () => ({}),
}));
let customer: { orgId: string } | null = null;
vi.mock("@/server/auth/session", () => ({ apiCustomer: async () => customer, apiStaff: async () => null }));

const { fetchPod, podView, podFile, podFilesForOrg, sweepPods, sniffPod, storePodFiles, POD_BACKOFF_MIN } = await import("./pod");
const { GET: portalGet } = await import("@/app/api/portal/shipments/[id]/pod/route");
const { GET: bulkGet } = await import("@/app/api/portal/pods/route");

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML = new TextEncoder().encode("<html>not a pod</html>");

async function ship(id: string, org: string, acct: string, status = "delivered") {
  await db.insert(schema.orders).values({ id: `o_${id}`, orgId: org, orderNumber: `N${id}`, mode: "B2C", paymentType: "prepaid", declaredValuePaise: 1000, consignee: { name: "x" }, status: "booked" });
  await db.insert(schema.shipments).values({ id, orgId: org, orderId: `o_${id}`, providerAccountId: acct, provider: acct === "pa_pod" ? "podco" : "plain", carrierCode: "dl", carrierName: "Delhivery", serviceName: "S",
    awb: `AWB${id}`, providerOrderRef: `R${id}`, bookingStatus: "confirmed", status, quoteId: "q", sellPaise: 100, costPaise: 50, chargeableWeightGrams: 500, deliveredAt: status === "delivered" ? new Date() : null });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: "orgA", name: "A", businessName: "A" }, { id: "orgB", name: "B", businessName: "B" }]);
  await db.insert(schema.providerAccounts).values([
    { id: "pa_pod", adapter: "podco", category: "shipping", label: "Pod courier", status: "enabled" },
    { id: "pa_plain", adapter: "plain", category: "shipping", label: "Plain courier", status: "enabled" },
  ]);
  await ship("s1", "orgA", "pa_pod");
  await ship("s2", "orgA", "pa_plain");
  await ship("s3", "orgB", "pa_pod");
  await ship("s4", "orgA", "pa_pod", "in_transit");
  await ship("s5", "orgA", "pa_pod");
  await ship("s6", "orgA", "pa_pod");
  await db.insert(schema.shipmentEvents).values({ id: "e6a", shipmentId: "s6", dedupeKey: "e6a", status: "delivered", rawStatus: "Delivered", remark: "OTP verified delivery", occurredAt: new Date("2026-11-20T05:00:00Z"), source: "poll" });
});
beforeEach(() => { customer = null; });

describe("POD file checks", () => {
  it("accepts PDF / images by content only", () => {
    expect(sniffPod(PDF)?.mime).toBe("application/pdf");
    expect(sniffPod(PNG)?.ext).toBe("png");
    expect(sniffPod(HTML)).toBeNull();
    expect(sniffPod(new Uint8Array(9 * 1024 * 1024).fill(0x25))).toBeNull(); // too large
  });
  it("a signature alone becomes the POD document", async () => {
    const r = await storePodFiles("orgA", "sx", { ready: true, files: [{ kind: "signature", data: PNG }] }, async () => PNG);
    expect(r.fileKey).toBe("pods/orga/sx-signature.png");
    expect(r.signatureKey).toBeUndefined();
  });
});

describe("fetching the POD", () => {
  it("courier without a POD API → unsupported, never a made-up POD", async () => {
    expect((await podView("s2", "orgA"))?.state).toBe("unsupported"); // before any attempt
    expect(await fetchPod("s2")).toBe("unsupported");
    const [row] = await db.select().from(schema.shipmentPods).where(eq(schema.shipmentPods.shipmentId, "s2"));
    expect(row.fileKey).toBeNull();
  });
  it("not delivered yet → nothing is fetched", async () => {
    expect(await fetchPod("s4")).toBe("not_delivered");
    expect((await podView("s4", "orgA"))?.state).toBe("not_delivered");
  });
  it("POD not published yet → pending with back-off; then stored privately with receiver details", async () => {
    const now = new Date("2026-11-20T06:00:00Z");
    podReply = async () => ({ ok: true, value: { ready: false, files: [] } });
    expect(await fetchPod("s1", { now })).toBe("pending");
    let [row] = await db.select().from(schema.shipmentPods).where(eq(schema.shipmentPods.shipmentId, "s1"));
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt!.getTime()).toBe(now.getTime() + POD_BACKOFF_MIN[0] * 60_000);
    expect((await podView("s1", "orgA"))?.state).toBe("pending");

    const urls: string[] = [];
    podReply = async () => ({ ok: true, value: { ready: true, receiverName: "Ravi", deliveredAt: "2026-11-20T05:42:00.000Z", files: [{ kind: "pod", url: "https://s3.example.com/pod/1.pdf" }, { kind: "signature", url: "https://s3.example.com/sig/1.png" }] } });
    expect(await fetchPod("s1", { now, download: async (u) => { urls.push(u); return u.endsWith(".pdf") ? PDF : PNG; } })).toBe("available");
    [row] = await db.select().from(schema.shipmentPods).where(eq(schema.shipmentPods.shipmentId, "s1"));
    expect(row).toMatchObject({ state: "available", fileMime: "application/pdf", signatureMime: "image/png", receiverName: "Ravi", attempts: 2 });
    expect(urls).toHaveLength(2);
    expect(store.get(row.fileKey!)).toEqual(Buffer.from(PDF)); // our copy, not the courier link
    const v = await podView("s1", "orgA");
    expect(v).toMatchObject({ state: "available", receiverName: "Ravi", hasSignature: true, deliveredAt: "2026-11-20T05:42:00.000Z" });
    expect(JSON.stringify(v)).not.toContain("s3.example.com");
    // already available → the courier is not asked again
    podReply = async () => { throw new Error("must not be called"); };
    expect(await fetchPod("s1")).toBe("available");
  });
  it("a courier reply that is not a PDF / image is refused and retried", async () => {
    podReply = async () => ({ ok: true, value: { ready: true, files: [{ kind: "pod", url: "https://x.example.com/login" }] } });
    expect(await fetchPod("s3", { download: async () => HTML })).toBe("pending");
    const [row] = await db.select().from(schema.shipmentPods).where(eq(schema.shipmentPods.shipmentId, "s3"));
    expect(row.lastError).toMatch(/not a PDF or image/);
  });
  it("gives up as failed after the retry window", async () => {
    podReply = async () => ({ ok: false, error: { category: "upstream", message: "HTTP 503", retryable: true } });
    let state = "";
    for (let i = 0; i <= POD_BACKOFF_MIN.length; i++) state = await fetchPod("s5");
    expect(state).toBe("failed");
    expect((await podView("s5", "orgA"))?.state).toBe("failed");
  });
  it("sweep opens rows for delivered shipments and queues due retries", async () => {
    await db.delete(schema.shipmentPods).where(eq(schema.shipmentPods.shipmentId, "s3"));
    const r = await sweepPods(new Date(Date.now() + 86400_000));
    expect(r.opened).toBe(2); // s3 and s6 (no row yet)
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.queue, "pod.fetch"));
    expect(jobs.some((j) => (j.payload as { shipmentId: string }).shipmentId === "s3")).toBe(true);
  });
});

describe("OTP or POD delivery", () => {
  it("an OTP delivery without a POD document is shown as OTP based, and still retried in case the courier uploads one", async () => {
    podReply = async () => ({ ok: true, value: { ready: false, files: [] } });
    expect(await fetchPod("s6")).toBe("pending");
    expect(await podView("s6", "orgA")).toMatchObject({ state: "pending", deliveryMode: "otp" });
    const [row] = await db.select().from(schema.shipmentPods).where(eq(schema.shipmentPods.shipmentId, "s6"));
    expect(row.lastError).toMatch(/OTP-based delivery/);
  });
  it("a stored courier POD is shown as POD based", async () => {
    expect((await podView("s1", "orgA"))?.deliveryMode).toBe("pod");
  });
  it("a new POD-uploaded scan on a delivered shipment queues an immediate POD fetch", async () => {
    const { ingestEvents } = await import("./service");
    await ingestEvents("s5", [{ status: "delivered", rawStatus: "POD uploaded", occurredAt: "2026-11-21T10:00:00.000Z" }], "webhook");
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, "pod:s5:scan:2026-11-21T10:00:00.000Z"));
    expect(jobs).toHaveLength(1);
  });
});

describe("access rules", () => {
  it("a customer only gets PODs of their own account", async () => {
    expect(await podView("s1", "orgB")).toBeNull();
    expect(await podFile("s1", "orgB", "pod")).toBeNull();
    expect((await podFile("s1", "orgA", "pod"))?.mime).toBe("application/pdf");
    expect((await podFile("s1", null, "signature"))?.mime).toBe("image/png"); // admin
    expect(await podFilesForOrg("orgB", ["s1"])).toHaveLength(0);
    expect(await podFilesForOrg("orgA", ["s1", "s3"])).toHaveLength(1);
  });
  it("portal routes: login required, other accounts get 404, own POD downloads", async () => {
    const req = (u: string) => new Request(`http://x${u}`);
    const p = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await portalGet(req("/api/portal/shipments/s1/pod"), p("s1"))).status).toBe(401);
    customer = { orgId: "orgB" };
    expect((await portalGet(req("/api/portal/shipments/s1/pod"), p("s1"))).status).toBe(404);
    expect((await bulkGet(req("/api/portal/pods?ids=s1"))).status).toBe(404);
    customer = { orgId: "orgA" };
    const r = await portalGet(req("/api/portal/shipments/s1/pod?download=1"), p("s1"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="POD-AWBs1\.pdf"/);
    expect(r.headers.get("cache-control")).toContain("no-store");
    const z = await bulkGet(req("/api/portal/pods?ids=s1,s2"));
    expect(z.headers.get("content-type")).toBe("application/zip");
  });
});
