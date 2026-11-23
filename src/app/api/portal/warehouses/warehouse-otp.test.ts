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
let session: { userId: string; orgId: string; name: string; impersonatorId: string | null } = { userId: "usr_w", orgId: "org_w", name: "W", impersonatorId: null };
vi.mock("@/server/auth/session", () => ({ apiCustomer: async () => session }));
vi.mock("@/server/features", () => ({ hasFeature: async () => true }));
vi.mock("@/server/jobs/runner", () => ({ enqueue: async () => undefined }));
let firebaseOn = true;
vi.mock("@/server/auth/firebase-phone", () => {
  class PhoneTokenError extends Error {}
  return {
    PhoneTokenError,
    firebasePhoneConfig: async () => (firebaseOn ? { apiKey: "AIza-test", authDomain: "x.firebaseapp.com", projectId: "p" } : null),
    // "ok:<mobile>" = a fresh Firebase phone sign-in for that mobile; anything else is refused
    verifyFirebasePhoneToken: async (t: string) => { const m = /^ok:(\d{10})/.exec(t); if (!m) throw new PhoneTokenError("bad"); return { mobile: m[1], uid: "u" }; },
  };
});

const create = await import("./route");
const one = await import("./[id]/route");
const otp = await import("./[id]/otp/route");
const req = (body: unknown, method = "POST") => new Request("http://localhost/api/portal/warehouses", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const addr = { label: "Main warehouse", contactName: "Asha Devi", email: "", mobile: "9876543210", line1: "House 5 Subhash Garh", line2: "", pincode: "110001", city: "New Delhi", state: "Delhi" };
const tok = (m: string) => `ok:${m}${"x".repeat(30)}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const wh = async (id: string) => (await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: "org_w", name: "W", businessName: "W Traders" });
});

describe("pickup mobile OTP when adding a warehouse (Firebase ON)", () => {
  it("is not saved without an OTP, or with an OTP for another number", async () => {
    const before = (await db.select().from(schema.warehouses)).length;
    const a = await create.POST(req(addr));
    expect(a.status).toBe(422);
    expect((await a.json()).error.message).toMatch(/Verify the pickup mobile/);
    expect((await create.POST(req({ ...addr, mobileToken: tok("9999999999") }))).status).toBe(422);
    expect((await create.POST(req({ ...addr, mobileToken: "forged-xxxxxxxxxxxxxxxxxxxxxxxxx" }))).status).toBe(422);
    expect((await db.select().from(schema.warehouses)).length).toBe(before);
  });

  it("is saved already verified with an OTP for the same number (+91 written either way)", async () => {
    const r = await create.POST(req({ ...addr, mobile: "+91 98765 43210", mobileToken: tok("9876543210") }));
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.verified).toBe(true);
    expect((await wh(j.id)).mobileVerifiedAt).not.toBeNull();
  });

  it("editing: same mobile needs no OTP; a new mobile needs an OTP for that new number", async () => {
    const id = (await (await create.POST(req({ ...addr, label: "Second", mobileToken: tok("9876543210") }))).json()).id;
    expect((await one.PUT(req({ ...addr, label: "Second renamed" }, "PUT"), ctx(id))).status).toBe(200);
    expect((await wh(id)).mobileVerifiedAt).not.toBeNull();
    expect((await one.PUT(req({ ...addr, mobile: "9000000001" }, "PUT"), ctx(id))).status).toBe(422);
    expect((await wh(id)).mobile).toBe("9876543210"); // unchanged
    const ok = await one.PUT(req({ ...addr, mobile: "9000000001", mobileToken: tok("9000000001") }, "PUT"), ctx(id));
    expect(await ok.json()).toMatchObject({ ok: true, mobileChanged: true, verified: true });
    expect(await wh(id)).toMatchObject({ mobile: "9000000001" });
    expect((await wh(id)).mobileVerifiedAt).not.toBeNull();
  });

  it("an older unverified address is verified with a Firebase token for its own number only", async () => {
    await db.insert(schema.warehouses).values({ id: "wh_old", orgId: "org_w", code: "W9999", label: "Old", contactName: "Old", mobile: "9000000002", line1: "Old street 1", pincode: "110001", city: "Delhi", state: "Delhi" });
    expect(await (await otp.POST(req({}), ctx("wh_old"))).json()).toEqual({ firebase: true, mobile: "9000000002" });
    expect((await otp.PUT(req({ idToken: tok("9876543210") }, "PUT"), ctx("wh_old"))).status).toBe(400);
    expect((await wh("wh_old")).mobileVerifiedAt).toBeNull();
    expect((await otp.PUT(req({ idToken: tok("9000000002") }, "PUT"), ctx("wh_old"))).status).toBe(200);
    expect((await wh("wh_old")).mobileVerifiedAt).not.toBeNull();
  });

  it("Vishwaship staff adding for a customer may save without an OTP (left unverified)", async () => {
    session = { ...session, impersonatorId: "usr_staff" };
    const r = await create.POST(req({ ...addr, label: "By staff" }));
    expect(r.status).toBe(201);
    expect((await wh((await r.json()).id)).mobileVerifiedAt).toBeNull();
    session = { ...session, impersonatorId: null };
  });

  it("with Firebase OFF the older flow is unchanged (saved, then verified separately)", async () => {
    firebaseOn = false;
    const r = await create.POST(req({ ...addr, label: "Firebase off" }));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ verified: false });
    firebaseOn = true;
  });
});
