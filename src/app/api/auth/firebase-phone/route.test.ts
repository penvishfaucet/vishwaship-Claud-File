import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
// a browser cookie jar
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (o: string | { name: string }) => { jar.delete(typeof o === "string" ? o : o.name); },
  }),
  headers: async () => new Headers(),
}));
let configOn = true;
vi.mock("@/server/auth/firebase-phone", async () => {
  class PhoneTokenError extends Error {}
  return {
    PhoneTokenError,
    firebasePhoneConfig: async () => (configOn ? { apiKey: "AIza-test", authDomain: "x.firebaseapp.com", projectId: "vishwaship-app" } : null),
    // test tokens: "ok:<mobile>" is a verified phone token; anything else is refused
    verifyFirebasePhoneToken: async (t: string, projectId: string) => {
      const m = /^ok:(\d{10})/.exec(t);
      if (!m || projectId !== "vishwaship-app") throw new PhoneTokenError("bad");
      return { mobile: m[1], uid: "fb" };
    },
    // "g:<googleId>:<email>" is a verified Google sign-in
    verifyFirebaseGoogleToken: async (t: string, projectId: string) => {
      const m = /^g:(\w+):([^:\s]+)/.exec(t);
      if (!m || projectId !== "vishwaship-app") throw new PhoneTokenError("bad");
      return { sub: m[1], email: m[2].toLowerCase(), name: "G User", uid: "fb" };
    },
  };
});
const sessions: Array<{ userId: string; kind: string }> = [];
vi.mock("@/server/auth/session", () => ({ createSession: async (userId: string, kind: string) => { sessions.push({ userId, kind }); } }));
vi.mock("@/server/franchise/referral", () => ({ referralFromCookie: async () => null, attributeReferral: async () => undefined }));

const route = await import("./route");
const { linkPendingGoogle } = await import("@/server/auth/google");
let ipN = 0;
async function call(body: unknown) {
  const req = new Request("http://localhost/api/auth/firebase-phone/", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ipN}` }, body: JSON.stringify(body) });
  const res = await route.POST(req);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}
const tok = (m: string) => `ok:${m}${"x".repeat(30)}`;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: "org_a", name: "A", businessName: "A Traders" });
  await db.insert(schema.users).values({ id: "usr_a", kind: "customer", orgId: "org_a", name: "Asha", email: "a@example.test", mobile: "9876543210" });
  await db.insert(schema.orgs).values({ id: "org_off", name: "Off", businessName: "Off" });
  await db.insert(schema.users).values({ id: "usr_off", kind: "customer", orgId: "org_off", name: "Off", email: "off@example.test", mobile: "9000000001", active: false });
  // a staff member with a mobile must never be signed in to the customer portal by OTP
  await db.insert(schema.users).values({ id: "usr_staff", kind: "staff", name: "Staff", email: "s@example.test", mobile: "9000000002" });
});

describe("Login with Mobile OTP", () => {
  it("signs in the customer who owns the verified number and marks the number verified", async () => {
    const r = await call({ op: "verify", idToken: tok("9876543210"), next: "/portal/orders/" });
    expect(r).toMatchObject({ status: 200, json: { ok: true, redirect: "/portal/orders/" } });
    expect(sessions.at(-1)).toEqual({ userId: "usr_a", kind: "customer" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, "usr_a"));
    expect(u.mobileVerifiedAt).not.toBeNull();
  });

  it("refuses bad tokens, inactive accounts, outside redirects, and does nothing when switched off", async () => {
    expect((await call({ op: "verify", idToken: "forged-token-xxxxxxxxxxxxxxxxxxxx" })).status).toBe(401);
    expect((await call({ op: "verify", idToken: tok("9000000001") })).status).toBe(403);
    expect((await call({ op: "verify", idToken: tok("9876543210"), next: "//evil.example/x" })).json.redirect).toBe("/portal/");
    configOn = false;
    expect((await call({ op: "verify", idToken: tok("9876543210") })).status).toBe(503);
    configOn = true;
  });

  it("a new number gets a signup ticket; the account is created with the verified mobile", async () => {
    const n = sessions.length;
    const v = await call({ op: "verify", idToken: tok("9000000002") }); // only a staff user has this number
    expect(v.json).toMatchObject({ ok: true, signup: true });
    expect(sessions.length).toBe(n);
    expect((await call({ op: "signup", name: "Ravi", email: "a@example.test", terms: true })).status).toBe(409); // email taken
    expect((await call({ op: "signup", name: "Ravi", email: "ravi@example.test", terms: false })).status).toBe(422);
    const s = await call({ op: "signup", name: "Ravi Kumar", email: "Ravi@Example.test", terms: true });
    expect(s).toMatchObject({ status: 200, json: { ok: true, redirect: "/portal/" } });
    const [u] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.mobile, "9000000002")));
    expect(u).toMatchObject({ name: "Ravi Kumar", email: "ravi@example.test", emailVerifiedAt: null });
    expect(u.mobileVerifiedAt).not.toBeNull();
    expect(sessions.at(-1)).toEqual({ userId: u.id, kind: "customer" });
    expect(jar.has("vs_phone")).toBe(false); // ticket used up
  });

  it("signup without a valid ticket, or with a forged one, is refused", async () => {
    jar.clear();
    expect((await call({ op: "signup", name: "Mallory", email: "m@example.test", terms: true })).status).toBe(401);
    jar.set("vs_phone", `9111111111.${Date.now() + 600_000}.deadbeef`);
    expect((await call({ op: "signup", name: "Mallory", email: "m@example.test", terms: true })).status).toBe(401);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.mobile, "9111111111"));
    expect(u).toBeUndefined();
  });
});

describe("Continue with Google through Firebase", () => {
  const g = (sub: string, email: string) => `g:${sub}:${email}:${"x".repeat(20)}`;

  it("a new Google email gets a new customer account with the Google id and a verified email", async () => {
    const r = await call({ op: "google", idToken: g("g100", "Neha@Example.test") });
    expect(r).toMatchObject({ status: 200, json: { ok: true, redirect: "/portal/" } });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "neha@example.test"));
    expect(u).toMatchObject({ kind: "customer", googleSub: "g100", name: "G User" });
    expect(u.emailVerifiedAt).not.toBeNull();
    expect(sessions.at(-1)).toEqual({ userId: u.id, kind: "customer" });
    // next time the same Google account signs straight in, keeping the return path
    const again = await call({ op: "google", idToken: g("g100", "neha@example.test"), next: "/portal/book/" });
    expect(again.json).toMatchObject({ ok: true, redirect: "/portal/book/" });
    expect(sessions.at(-1)).toEqual({ userId: u.id, kind: "customer" });
    const all = await db.select().from(schema.users).where(eq(schema.users.email, "neha@example.test"));
    expect(all).toHaveLength(1);
  });

  it("the email of an existing account is never signed in by Google alone — it is linked after a password login", async () => {
    jar.clear();
    const n = sessions.length;
    const r = await call({ op: "google", idToken: g("g200", "a@example.test"), next: "/portal/x/" });
    expect(r.json).toMatchObject({ ok: true, link: true });
    expect(r.json.redirect).toBe("/login/?link=google&email=a%40example.test&next=%2Fportal%2Fx%2F");
    expect(sessions.length).toBe(n);
    let [u] = await db.select().from(schema.users).where(eq(schema.users.id, "usr_a"));
    expect(u.googleSub).toBeNull();
    expect(jar.has("vs_glink")).toBe(true);
    // the customer logs in with their password → the pending Google id is linked
    expect(await linkPendingGoogle("usr_a", "a@example.test")).toBe(true);
    [u] = await db.select().from(schema.users).where(eq(schema.users.id, "usr_a"));
    expect(u.googleSub).toBe("g200");
    const s = await call({ op: "google", idToken: g("g200", "a@example.test") });
    expect(s.json).toMatchObject({ ok: true, redirect: "/portal/" });
    expect(sessions.at(-1)).toEqual({ userId: "usr_a", kind: "customer" });
  });

  it("refuses bad tokens, inactive accounts, outside redirects; a staff email never gets a customer login", async () => {
    expect((await call({ op: "google", idToken: "forged-token-xxxxxxxxxxxxxxxxxxxx" })).status).toBe(401);
    expect((await call({ op: "google", idToken: "ok:9876543210xxxxxxxxxxxxxxxxxxxxxx" })).status).toBe(401); // a phone token
    await db.update(schema.users).set({ googleSub: "g300" }).where(eq(schema.users.id, "usr_off"));
    expect((await call({ op: "google", idToken: g("g300", "off@example.test") })).status).toBe(403);
    expect((await call({ op: "google", idToken: g("g100", "neha@example.test"), next: "//evil.example/x" })).json.redirect).toBe("/portal/");
    // the staff member's email: only a separate customer account, never a staff session or a change to the staff user
    await call({ op: "google", idToken: g("g400", "s@example.test") });
    expect(sessions.at(-1)?.kind).toBe("customer");
    expect(sessions.at(-1)?.userId).not.toBe("usr_staff");
    const [staff] = await db.select().from(schema.users).where(eq(schema.users.id, "usr_staff"));
    expect(staff.googleSub).toBeNull();
  });

  it("is switched off with the Firebase card, with the Admin Google switch, and when the site's own Google sign-in has keys", async () => {
    configOn = false;
    expect((await call({ op: "google", idToken: g("g100", "neha@example.test") })).status).toBe(503);
    configOn = true;
    process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    try { expect((await call({ op: "google", idToken: g("g100", "neha@example.test") })).status).toBe(503); }
    finally { delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; }
    await db.insert(schema.pricingSettings).values({ key: "auth_settings", value: { googleEnabled: false } });
    expect((await call({ op: "google", idToken: g("g100", "neha@example.test") })).status).toBe(503);
    await db.delete(schema.pricingSettings).where(eq(schema.pricingSettings.key, "auth_settings"));
    expect((await call({ op: "google", idToken: g("g100", "neha@example.test") })).status).toBe(200);
  });
});
