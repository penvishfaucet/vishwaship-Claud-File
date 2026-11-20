import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { generateKeyPairSync } from "node:crypto";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

// next/headers stand-in: no browser cookie; headers() returns the request currently being handled
let current = new Headers();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => current,
}));
// FCM stand-in (no network)
const fcmSent: Array<{ token: string; data: Record<string, string> }> = [];
vi.mock("@/server/security/safe-fetch", () => ({
  safeFetch: async (url: string, init: RequestInit = {}) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at", expires_in: 3600 });
    if (url.includes("/messages:send")) {
      const m = JSON.parse(String(init.body)).message;
      if (m.token === "stale-token-xxxxxxxxxxxxxxxx") return new Response("{}", { status: 404 });
      fcmSent.push({ token: m.token, data: m.data });
      return Response.json({ name: "ok" });
    }
    return new Response("{}", { status: 404 });
  },
}));

const { hashPassword } = await import("@/server/security/crypto");
const login = await import("@/app/api/mobile/v1/auth/login/route");
const refresh = await import("@/app/api/mobile/v1/auth/refresh/route");
const logout = await import("@/app/api/mobile/v1/auth/logout/route");
const me = await import("@/app/api/mobile/v1/me/route");
const orderRoute = await import("@/app/api/mobile/v1/orders/[id]/route");
const alerts = await import("@/app/api/mobile/v1/alerts/route");
const devices = await import("@/app/api/mobile/v1/devices/route");
const { revokeAllSessions } = await import("@/server/auth/session");
const { dispatchPush, appLinkFor } = await import("./push");

const H = (token?: string, ip = "10.0.0.1") => new Headers({ "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) });
async function call<T = any>(fn: (req: Request, ctx?: any) => Promise<Response>, o: { method?: string; token?: string; body?: unknown; params?: Record<string, string>; ip?: string } = {}) {
  current = H(o.token, o.ip);
  const req = new Request("http://localhost/api/mobile/v1/x", { method: o.method ?? "GET", headers: current, body: o.body ? JSON.stringify(o.body) : undefined });
  const res = await fn(req, o.params ? { params: Promise.resolve(o.params) } : undefined);
  return { status: res.status, json: (await res.json()) as T };
}
const signIn = (identifier: string, installId: string, password = "correct-horse-1", ip?: string) =>
  call(login.POST, { method: "POST", body: { identifier, password, device: { installId, appVersion: "1.0.0" } }, ip });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const [org, user, email, mobile] of [["org_a", "usr_a", "a@example.test", "9876543210"], ["org_b", "usr_b", "b@example.test", "9876500000"]]) {
    await db.insert(schema.orgs).values({ id: org, name: org, businessName: `${org} Traders`, profileCompletedAt: new Date() });
    await db.insert(schema.users).values({ id: user, kind: "customer", orgId: org, name: user, email, mobile, passwordHash: await hashPassword("correct-horse-1") });
    await db.insert(schema.wallets).values({ id: `wal_${org}`, orgId: org, postedPaise: org === "org_a" ? 150_000 : 0 });
    await db.insert(schema.creditBalances).values({ orgId: org, credits: 0 });
  }
  await db.insert(schema.orders).values({ id: "ord_a1", orgId: "org_a", orderNumber: "A-1001", mode: "B2C", paymentType: "prepaid", declaredValuePaise: 50_000, status: "ready",
    consignee: { name: "R", mobile: "9000000000", line1: "1 Road", pincode: "110001", city: "Delhi", state: "Delhi" } });
  await db.insert(schema.packages).values({ id: "pkg_a1", orderId: "ord_a1", count: 2, lengthMm: 100, breadthMm: 100, heightMm: 100, actualWeightGrams: 500 });
});

describe("Android sign-in uses the website account", () => {
  it("rejects a wrong password and accepts email or mobile with the same password", async () => {
    expect((await signIn("a@example.test", "install-aaaaaaaaaaaa", "wrong-password", "10.0.0.2")).status).toBe(401);
    const byMobile = await signIn("+91 98765 43210", "install-aaaaaaaaaaaa");
    expect(byMobile.status).toBe(200);
    expect(byMobile.json.token).toMatch(/^vsm_/);
    expect(byMobile.json.me.org.id).toBe("org_a");
    expect(byMobile.json.me.wallet.availablePaise).toBe(150_000); // same live balance as the website
  });

  it("the token works on every customer API through the same session check", async () => {
    const { json } = await signIn("a@example.test", "install-aaaaaaaaaaaa");
    const r = await call(me.GET, { token: json.token });
    expect(r.status).toBe(200);
    expect(r.json.user.email).toBe("a@example.test");
    expect((await call(me.GET, { token: "vsm_not-a-real-token-1234567890" })).status).toBe(401);
    expect((await call(me.GET)).status).toBe(401);
  });

  it("refresh rotates the token; the old one stops working", async () => {
    const { json } = await signIn("a@example.test", "install-aaaaaaaaaaaa");
    const r = await call(refresh.POST, { method: "POST", token: json.token });
    expect(r.status).toBe(200);
    expect(r.json.token).not.toBe(json.token);
    expect((await call(me.GET, { token: json.token })).status).toBe(401);
    expect((await call(me.GET, { token: r.json.token })).status).toBe(200);
  });

  it("password reset / Log out of all devices also signs the app out", async () => {
    const { json } = await signIn("a@example.test", "install-aaaaaaaaaaaa");
    await revokeAllSessions("usr_a");
    expect((await call(me.GET, { token: json.token })).status).toBe(401);
  });
});

describe("tenant isolation", () => {
  it("customer B cannot open customer A's order or mark A's alerts read", async () => {
    const a = (await signIn("a@example.test", "install-aaaaaaaaaaaa")).json.token;
    const b = (await signIn("b@example.test", "install-bbbbbbbbbbbb")).json.token;
    const mine = await call(orderRoute.GET, { token: a, params: { id: "ord_a1" } });
    expect(mine.status).toBe(200);
    expect(mine.json.order.orderNumber).toBe("A-1001");
    expect(mine.json.order.boxes).toBe(2);
    expect((await call(orderRoute.GET, { token: b, params: { id: "ord_a1" } })).status).toBe(404);

    await db.insert(schema.inAppAlerts).values({ id: "al_a1", orgId: "org_a", kind: "wallet", title: "Wallet credited ₹500", href: "/portal/billing/passbook/", pushedAt: new Date() });
    await call(alerts.POST, { method: "POST", token: b, body: { ids: ["al_a1"] } });
    expect((await db.select().from(schema.inAppAlerts).where(eq(schema.inAppAlerts.id, "al_a1")))[0].readAt).toBeNull();
    const list = await call(alerts.GET, { token: b });
    expect(list.json.alerts.find((x: { id: string }) => x.id === "al_a1")).toBeUndefined();
    await call(alerts.POST, { method: "POST", token: a, body: { ids: ["al_a1"] } });
    expect((await db.select().from(schema.inAppAlerts).where(eq(schema.inAppAlerts.id, "al_a1")))[0].readAt).not.toBeNull();
  });
});

describe("devices and push", () => {
  it("signing another account into the same install clears the old push token; logout detaches the device", async () => {
    const a = (await signIn("a@example.test", "install-shared-000001")).json.token;
    expect((await call(devices.PUT, { method: "PUT", token: a, body: { pushToken: "fcm-token-of-phone-1-xxxxxxxx" } })).status).toBe(200);
    let [d] = await db.select().from(schema.mobileDevices).where(eq(schema.mobileDevices.installId, "install-shared-000001"));
    expect(d.pushToken).toBe("fcm-token-of-phone-1-xxxxxxxx");
    await signIn("b@example.test", "install-shared-000001"); // phone handed to someone else
    [d] = await db.select().from(schema.mobileDevices).where(eq(schema.mobileDevices.installId, "install-shared-000001"));
    expect(d.userId).toBe("usr_b");
    expect(d.pushToken).toBeNull();

    const a2 = (await signIn("a@example.test", "install-aaaa-logout-01")).json.token;
    await call(devices.PUT, { method: "PUT", token: a2, body: { pushToken: "fcm-token-logout-test-xxxxxxx" } });
    expect((await call(logout.POST, { method: "POST", token: a2 })).status).toBe(200);
    expect((await call(me.GET, { token: a2 })).status).toBe(401);
    [d] = await db.select().from(schema.mobileDevices).where(eq(schema.mobileDevices.installId, "install-aaaa-logout-01"));
    expect(d.pushToken).toBeNull();
    expect(d.revokedAt).not.toBeNull();
  });

  it("pushes each new alert once, only to valid devices of that org, with no private text on the lock screen", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.FCM_SERVICE_ACCOUNT_B64 = Buffer.from(JSON.stringify({ project_id: "p", client_email: "svc@p.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) })).toString("base64");
    await db.update(schema.inAppAlerts).set({ pushedAt: new Date() }); // earlier alerts already handled
    const a = (await signIn("a@example.test", "install-push-a-000001")).json.token;
    await call(devices.PUT, { method: "PUT", token: a, body: { pushToken: "fcm-token-org-a-xxxxxxxxxxxx" } });
    const b = (await signIn("b@example.test", "install-push-b-000001")).json.token;
    await call(devices.PUT, { method: "PUT", token: b, body: { pushToken: "fcm-token-org-b-xxxxxxxxxxxx" } });

    await db.insert(schema.inAppAlerts).values({ id: "al_push1", orgId: "org_a", kind: "wallet", title: "Wallet credited ₹5,000 (UTR 1234)", href: "/portal/billing/passbook/" });
    fcmSent.length = 0;
    await dispatchPush();
    await dispatchPush(); // second sweep must not resend
    expect(fcmSent).toHaveLength(1);
    expect(fcmSent[0].token).toBe("fcm-token-org-a-xxxxxxxxxxxx");
    expect(fcmSent[0].data.title).toBe("Wallet update");
    expect(JSON.stringify(fcmSent[0].data)).not.toMatch(/5,000|UTR|1234/);
    expect(fcmSent[0].data.link).toBe("/wallet");
    delete process.env.FCM_SERVICE_ACCOUNT_B64;
  });

  it("maps portal links to safe in-app routes", () => {
    expect(appLinkFor("/portal/orders/ord_1/")).toBe("/orders/ord_1");
    expect(appLinkFor("/portal/support/tk_9/")).toBe("/support/tk_9");
    expect(appLinkFor("https://evil.example/x")).toBe("/alerts");
  });
});
