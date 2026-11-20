import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
const { isNszError, isNszPin, nszMessage, rememberNsz, NSZ_DAYS } = await import("./nsz");
const { nszFlag } = await import("@/server/providers/delhivery-b2b");

beforeAll(async () => { await migrate(db, { migrationsFolder: "./migrations" }); });

describe("Delhivery B2B non-serviceable zone (NSZ)", () => {
  it("recognises the booking rejection seen in production", () => {
    expect(isNszError("Delhivery B2B rejected the request (HTTP 400): RemoteError<Pincode Error. <200>:Reason: Destination Center is NSZ>")).toBe(true);
    expect(isNszError("Pickup is in a non-serviceable zone")).toBe(true);
    expect(isNszError("Delhivery B2B rejected the request (HTTP 400): invalid weight")).toBe(false);
  });

  it("customer message names the PIN, says nothing was charged and what to do — no raw courier text", () => {
    const m = nszMessage("Delhivery B2B Surface (LTL)", "752001");
    expect(m).toContain("752001");
    expect(m).toMatch(/Nothing was charged/);
    expect(m).toMatch(/choose another courier/);
    expect(m).not.toMatch(/RemoteError|HTTP 400/);
  });

  it("reads an NSZ flag or an NSZ centre type in the pincode-serviceability response", () => {
    expect(nszFlag({ data: [{ pincode: 752001, is_nsz: true }] })).toBe(true);
    expect(nszFlag({ data: { center: { type: "NSZ" } } })).toBe(true);
    expect(nszFlag({ data: [{ pincode: 110001, is_nsz: false, oda: "N" }] })).toBe(false);
    expect(nszFlag({ serviceable: true })).toBe(false);
  });

  it("a PIN rejected as NSZ is remembered per integration and forgotten after NSZ_DAYS", async () => {
    const t0 = new Date("2026-11-20T10:00:00Z");
    await rememberNsz("delhivery_b2b", "752001", t0);
    expect(await isNszPin("delhivery_b2b", "752001", t0)).toBe(true);
    expect(await isNszPin("delhivery_b2b", "110001", t0)).toBe(false);
    expect(await isNszPin("shipmozo", "752001", t0)).toBe(false); // other couriers are still offered
    const later = new Date(t0.getTime() + (NSZ_DAYS + 1) * 86_400_000);
    expect(await isNszPin("delhivery_b2b", "752001", later)).toBe(false);
    // a second PIN keeps the first while it is fresh
    await rememberNsz("delhivery_b2b", "752002", new Date(t0.getTime() + 86_400_000));
    expect(await isNszPin("delhivery_b2b", "752001", new Date(t0.getTime() + 86_400_000))).toBe(true);
  });
});
