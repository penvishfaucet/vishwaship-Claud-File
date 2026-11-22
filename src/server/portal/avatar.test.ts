import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
const files = new Map<string, Buffer>();
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/storage", async (orig) => ({ ...(await orig<typeof import("@/server/storage")>()), putPrivate: async (k: string, b: Buffer) => { files.set(k, b); }, getPrivate: async (k: string) => files.get(k)! }));

const av = await import("./avatar");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: "org_av", name: "A", businessName: "A" });
  await db.insert(schema.users).values([{ id: "u_av", kind: "customer", orgId: "org_av", name: "Asha", email: "a@av.test", prefs: { ordersPageSize: 50 } },
    { id: "u_av2", kind: "customer", orgId: "org_av", name: "B", email: "b@av.test" }]);
});

describe("profile avatar", () => {
  it("accepts exactly one emoji, including skin tones, families and flags", () => {
    for (const e of ["😀", "👍🏽", "👩‍💻", "👨‍👩‍👧", "🇮🇳", "❤️", "1️⃣"]) expect(av.isOneEmoji(e)).toBe(true);
    for (const e of ["", "ab", "😀😀", "A", "😀 x", "<script>"]) expect(av.isOneEmoji(e)).toBe(false);
  });

  it("emoji, photo and remove are saved on the user's own account and keep other preferences", async () => {
    expect(await av.readAvatar("u_av")).toBeNull();
    await expect(av.setEmoji("u_av", "hi")).rejects.toThrow(/one emoji/);
    expect(await av.setEmoji("u_av", "👩‍💻")).toEqual({ type: "emoji", value: "👩‍💻" });
    await expect(av.setPhoto("u_av", Buffer.from("not an image"))).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(av.setPhoto("u_av", Buffer.alloc(6 * 1024 * 1024, 1))).rejects.toThrow(/under 5 MB/);
    const p = await av.setPhoto("u_av", PNG);
    expect(p).toMatchObject({ type: "photo", v: expect.any(Number) });
    expect(JSON.stringify(p)).not.toContain("avatars/"); // the storage key never reaches pages
    const jpg = await av.avatarPhoto("u_av");
    expect(jpg?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])); // re-encoded as JPEG (metadata stripped)
    expect(await av.avatarPhoto("u_av2")).toBeNull();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, "u_av"));
    expect((u.prefs as { ordersPageSize: number }).ordersPageSize).toBe(50);
    expect(await av.clearAvatar("u_av")).toBeNull();
    expect(await av.readAvatar("u_av")).toBeNull();
    expect(await av.avatarPhoto("u_av")).toBeNull();
  });
});
