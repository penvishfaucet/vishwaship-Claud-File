import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

// Real Postgres semantics (PGlite + project migrations): idempotent create, ownership of references, file rules.
const client = new PGlite();
const db = drizzle(client, { schema });
const stored = new Map<string, Buffer>();
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/storage", () => ({
  putPrivate: async (k: string, b: Buffer) => { stored.set(k, b); },
  newKey: (p: string, ext: string) => `${p}/k${stored.size + 1}.${ext}`,
}));
const { createTicket, addMessage, resolveRef, sniffTicketFile, TicketError } = await import("./tickets");

const ORG = "org_a", OTHER = "org_b";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const file = (buf: Buffer, name: string) => new File([new Uint8Array(buf)], name);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "migrations" });
  await db.insert(schema.orgs).values([{ id: ORG, name: "A", businessName: "A Co" }, { id: OTHER, name: "B", businessName: "B Co" }]);
  for (const [org, n] of [[ORG, "A1"], [OTHER, "B1"]] as const) {
    await db.insert(schema.orders).values({
      id: `ord_${n}`, orgId: org, orderNumber: `VS-${n}`, mode: "B2C", paymentType: "prepaid", codAmountPaise: 0, declaredValuePaise: 50000,
      consignee: { name: "Buyer", mobile: "9876543210", line1: "1 Road", city: "Mumbai", state: "MH", pincode: "400001" }, status: "booked",
    });
    await db.insert(schema.shipments).values({
      id: `shp_${n}`, orgId: org, orderId: `ord_${n}`, providerAccountId: "pa", provider: "demo", carrierCode: "demo", carrierName: "Demo", serviceName: "Surface",
      awb: `AWB${n}`, bookingStatus: "confirmed", pickupStatus: "not_scheduled", status: "booked", quoteId: "q", sellPaise: 10000, costPaise: 8000, chargeableWeightGrams: 500,
    });
  }
});

describe("ticket attachments", () => {
  it("decides the type from content, not the name, and knows the kinds", () => {
    expect(sniffTicketFile(PNG, "x.png")).toMatchObject({ kind: "image", mime: "image/png" });
    expect(sniffTicketFile(PNG, "renamed.pdf")).toMatchObject({ kind: "image" });
    expect(sniffTicketFile(Buffer.from("%PDF-1.7 ..."), "a.pdf")).toMatchObject({ kind: "document", mime: "application/pdf" });
    expect(sniffTicketFile(Buffer.from("ID3\x03\x00"), "v.mp3")).toMatchObject({ kind: "audio" });
    expect(sniffTicketFile(Buffer.from("\x00\x00\x00\x18ftypmp42"), "v.mp4")).toMatchObject({ kind: "video" });
    expect(sniffTicketFile(Buffer.from("awb,order\n1,2"), "list.csv")).toMatchObject({ kind: "document", mime: "text/csv" });
    expect(sniffTicketFile(Buffer.from("MZ\x90\x00binary"), "setup.exe")).toBeNull();
    expect(sniffTicketFile(Buffer.from("<html><script>"), "page.html")).toBeNull();
  });
});

describe("raise ticket", () => {
  it("creates one Open ticket with the first message; a retry with the same key returns the same ticket", async () => {
    const a = await createTicket({ orgId: ORG, userId: "u1", category: "pickup", ref: "awba1", comment: "Not picked up yet", file: file(PNG, "p.png"), idemKey: "idem-key-0001" });
    const b = await createTicket({ orgId: ORG, userId: "u1", category: "pickup", ref: "awba1", comment: "Not picked up yet", idemKey: "idem-key-0001" });
    expect(b).toEqual({ id: a.id, replay: true });
    const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, a.id));
    expect(t).toMatchObject({ status: "open", orderNumber: "VS-A1", awb: "AWBA1", shipmentId: "shp_A1", category: "pickup" });
    const msgs = await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, a.id));
    expect(msgs).toHaveLength(1);
    expect((msgs[0].attachments as Array<{ kind: string }>)[0].kind).toBe("image");
  });
  it("allows account-level tickets without a reference, but shipment categories need one", async () => {
    const r = await createTicket({ orgId: ORG, userId: "u1", category: "account", comment: "Change my GST", idemKey: "idem-key-0002" });
    const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, r.id));
    expect(t.orderNumber).toBeNull();
    await expect(createTicket({ orgId: ORG, userId: "u1", category: "shipment", comment: "Where is it", idemKey: "idem-key-0003" })).rejects.toBeInstanceOf(TicketError);
  });
  it("never links another customer's order or AWB", async () => {
    expect(await resolveRef(ORG, "AWBB1")).toBeNull();
    expect(await resolveRef(ORG, "VS-B1")).toBeNull();
    expect(await resolveRef(ORG, "vs-a1")).toMatchObject({ orderId: "ord_A1", awb: "AWBA1" });
    await expect(createTicket({ orgId: ORG, userId: "u1", category: "pod", ref: "AWBB1", comment: "POD please", idemKey: "idem-key-0004" })).rejects.toThrow(/could not find/);
  });
  it("validates category, comment length and file type", async () => {
    await expect(createTicket({ orgId: ORG, userId: "u1", category: "nope", comment: "x", idemKey: "idem-key-0005" })).rejects.toThrow(/category/);
    await expect(createTicket({ orgId: ORG, userId: "u1", category: "tech", comment: "x".repeat(501), idemKey: "idem-key-0006" })).rejects.toThrow(/500/);
    await expect(createTicket({ orgId: ORG, userId: "u1", category: "tech", comment: "hi", file: file(Buffer.from("MZ..."), "a.exe"), idemKey: "idem-key-0007" })).rejects.toThrow(/not allowed/);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(createTicket({ orgId: ORG, userId: "u1", category: "tech", comment: "hi", file: file(big, "big.png"), idemKey: "idem-key-0008" })).rejects.toThrow(/2 MB/);
  });
});

describe("conversation", () => {
  it("adds replies once per message key, staff sets status, customer cannot write to a closed ticket", async () => {
    const { id } = await createTicket({ orgId: ORG, userId: "u1", category: "tech", comment: "Panel slow", idemKey: "idem-key-0009" });
    const m1 = await addMessage({ ticketId: id, userId: "u1", authorKind: "customer", body: "Any update?", clientId: "msg-key-0001" });
    const m2 = await addMessage({ ticketId: id, userId: "u1", authorKind: "customer", body: "Any update?", clientId: "msg-key-0001" });
    expect(m2).toMatchObject({ id: m1.id, replay: true });
    await addMessage({ ticketId: id, userId: "s1", authorKind: "staff", body: "Fixed", clientId: "msg-key-0002", status: "resolved" });
    let [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, id));
    expect(t.status).toBe("resolved");
    await addMessage({ ticketId: id, userId: "u1", authorKind: "customer", body: "Still slow", clientId: "msg-key-0003" });
    [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, id));
    expect(t.status).toBe("open"); // customer reply re-opens a resolved ticket
    await addMessage({ ticketId: id, userId: "s1", authorKind: "staff", body: "", clientId: "msg-key-0004", status: "closed" });
    await expect(addMessage({ ticketId: id, userId: "u1", authorKind: "customer", body: "hello", clientId: "msg-key-0005" })).rejects.toThrow(/closed/);
    const msgs = await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, id));
    expect(msgs).toHaveLength(4); // first comment, one customer reply (not two), staff reply, customer re-open (status-only change adds none)
  });
});
