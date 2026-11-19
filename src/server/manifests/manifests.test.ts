import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
const store = new Map<string, Buffer>();
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/storage", () => ({
  putPrivate: async (k: string, b: Buffer) => { store.set(k, Buffer.from(b)); },
  getPrivate: async (k: string) => store.get(k)!,
  newKey: (p: string, ext: string) => `${p}/k${store.size + 1}.${ext}`,
}));
vi.mock("@/server/quotes/service", () => ({ getSetting: async (_k: string, d: unknown) => ({ value: { ...(d as object), legalName: "Vishwaship Logistics Pvt Ltd", address: "Haridwar, Uttarakhand", gstin: "05ABCDE1234F1Z5" } }) }));
vi.mock("@/server/content", () => ({ t: async () => "+91 90000 00000" }));
const { generateManifest, istDayRange } = await import("./service");
const { findManifest, storeSigned } = await import("./files");

const ORG = "org_mf", OTHER = "org_mf2";
let n = 0;
async function ship(o: { carrier: "delhivery" | "ekart"; wh: string; at: Date; awb?: string | null; status?: string; boxes?: number }) {
  const id = `${++n}`;
  await db.insert(schema.orders).values({ id: `o${id}`, orgId: ORG, orderNumber: `VS-${id}`, mode: "B2C", paymentType: "prepaid", declaredValuePaise: 1000, warehouseId: o.wh, status: "booked",
    pickupSnapshot: { label: o.wh === "wh1" ? "Main Godown" : "City Store", line1: "Plot 1", city: "Haridwar", state: "UK", pincode: "249402" },
    consignee: { name: `Buyer ${id}`, mobile: "9876543210", line1: "x", city: "Delhi", state: "DL", pincode: "110001" } });
  await db.insert(schema.packages).values({ id: `p${id}`, orderId: `o${id}`, count: o.boxes ?? 1, lengthMm: 100, breadthMm: 100, heightMm: 100, actualWeightGrams: 500 });
  await db.insert(schema.shipments).values({ id: `s${id}`, orgId: ORG, orderId: `o${id}`, providerAccountId: "pa", provider: "demo", carrierCode: o.carrier, carrierName: o.carrier === "ekart" ? "Ekart" : "Delhivery",
    serviceName: "Surface", awb: o.awb === undefined ? `AWB${id}` : o.awb, bookingStatus: "confirmed", pickupStatus: "scheduled", status: o.status ?? "booked", quoteId: "q", sellPaise: 100, costPaise: 80, chargeableWeightGrams: 500, createdAt: o.at });
  return `s${id}`;
}

const DAY = "2026-11-19";
const at = (hIst: number) => new Date(istDayRange(DAY).start.getTime() + hIst * 3600_000);
let oneId = "";

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: ORG, name: "MF", businessName: "MF Traders" }, { id: OTHER, name: "X", businessName: "X" }]);
  await db.insert(schema.warehouses).values([
    { id: "wh1", orgId: ORG, label: "Main Godown", contactName: "R", mobile: "9876543210", line1: "Plot 1", pincode: "249402", city: "Haridwar", state: "UK", code: "W1" },
    { id: "wh2", orgId: ORG, label: "City Store", contactName: "R", mobile: "9876543210", line1: "Shop 2", pincode: "249401", city: "Haridwar", state: "UK", code: "W2" },
  ]);
  for (let i = 0; i < 6; i++) { const id = await ship({ carrier: "delhivery", wh: i < 4 ? "wh1" : "wh2", at: at(9 + i), boxes: i === 0 ? 3 : 1 }); if (i === 0) oneId = id; }
  for (let i = 0; i < 4; i++) await ship({ carrier: "ekart", wh: "wh1", at: at(12 + i) });
  await ship({ carrier: "ekart", wh: "wh1", at: at(16), status: "cancelled" }); // excluded
  await ship({ carrier: "delhivery", wh: "wh1", at: at(17), awb: null }); // no AWB yet: excluded
  await ship({ carrier: "delhivery", wh: "wh1", at: at(-2) }); // 10 pm the previous day (IST): excluded
});

describe("daily manifest", () => {
  it("one PDF with every eligible shipment of the IST day, a section per courier and pickup location", async () => {
    const r = await generateManifest({ orgId: ORG, userId: "u", scope: "daily", date: DAY });
    expect(r.awbCount).toBe(10);
    expect(r.boxCount).toBe(12); // one Delhivery order has 3 boxes
    expect(r.couriers).toEqual(["Delhivery", "Ekart"]);
    const [m] = await db.select().from(schema.manifests).where(eq(schema.manifests.id, r.id));
    const groups = m.groups as Array<{ carrier: string; pickup: { label: string }; rows: Array<{ awb: string }> }>;
    expect(groups.map((g) => `${g.carrier}/${g.pickup.label}/${g.rows.length}`)).toEqual(["Delhivery/City Store/2", "Delhivery/Main Godown/4", "Ekart/Main Godown/4"]);
    const pdf = await PDFDocument.load(store.get(m.pdfKey)!);
    expect(pdf.getPageCount()).toBe(3); // each courier / pickup group starts on its own page
    expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.28, 1); // A4
  });
  it("filters by courier partner and pickup location", async () => {
    expect((await generateManifest({ orgId: ORG, userId: "u", scope: "daily", date: DAY, carrierCode: "ekart" })).awbCount).toBe(4);
    expect((await generateManifest({ orgId: ORG, userId: "u", scope: "daily", date: DAY, warehouseId: "wh2" })).awbCount).toBe(2);
  });
  it("a long list continues on more pages of the same section (header repeated)", async () => {
    for (let i = 0; i < 40; i++) await ship({ carrier: "delhivery", wh: "wh1", at: new Date(istDayRange("2026-11-18").start.getTime() + 3600_000 + i * 60_000) });
    const r = await generateManifest({ orgId: ORG, userId: "u", scope: "daily", date: "2026-11-18" });
    const [m] = await db.select().from(schema.manifests).where(eq(schema.manifests.id, r.id));
    expect(r.awbCount).toBe(41); // 40 + the 10 pm shipment from the setup
    expect((await PDFDocument.load(store.get(m.pdfKey)!)).getPageCount()).toBeGreaterThan(1);
  });
  it("an empty day says so instead of printing a blank manifest", async () => {
    await expect(generateManifest({ orgId: ORG, userId: "u", scope: "daily", date: "2026-01-01" })).rejects.toThrow(/No booked shipments/);
  });
});

describe("single shipment, history and signed copy", () => {
  it("the shipment manifest lists exactly that AWB; every generation gets a new ID and the old record stays", async () => {
    const a = await generateManifest({ orgId: ORG, userId: "u", scope: "shipment", shipmentId: oneId });
    const b = await generateManifest({ orgId: ORG, userId: "u", scope: "shipment", shipmentId: oneId });
    expect(a.awbCount).toBe(1);
    expect(a.boxCount).toBe(3);
    expect(a.manifestNo).not.toBe(b.manifestNo);
    expect(await findManifest(a.id, ORG)).not.toBeNull();
  });
  it("re-download returns the original even after the shipment status changes; other accounts cannot see it", async () => {
    const r = await generateManifest({ orgId: ORG, userId: "u", scope: "shipment", shipmentId: oneId });
    const m = (await findManifest(r.id, ORG))!;
    const before = Buffer.from(store.get(m.pdfKey)!);
    await db.update(schema.shipments).set({ status: "delivered" }).where(eq(schema.shipments.id, oneId));
    const again = (await findManifest(r.id, ORG))!;
    expect(Buffer.from(store.get(again.pdfKey)!).equals(before)).toBe(true);
    expect((again.groups as Array<{ rows: Array<{ awb: string }> }>)[0].rows[0].awb).toBe("AWB1");
    expect(await findManifest(r.id, OTHER)).toBeNull();
    const [s] = await db.select({ p: schema.shipments.pickupStatus }).from(schema.shipments).where(eq(schema.shipments.id, oneId));
    expect(s.p).toBe("scheduled"); // generating never touches pickup status
  });
  it("stores a signed photo or PDF scan, refuses other files", async () => {
    const r = await generateManifest({ orgId: ORG, userId: "u", scope: "shipment", shipmentId: oneId });
    const m = (await findManifest(r.id, ORG))!;
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])], "signed.png");
    expect((await storeSigned(m, png)).ok).toBe(true);
    expect(((await findManifest(r.id, ORG))!.signedCopy as { mime: string }).mime).toBe("image/png");
    expect((await storeSigned(m, new File([new TextEncoder().encode("hello")], "x.txt"))).ok).toBe(false);
  });
});
