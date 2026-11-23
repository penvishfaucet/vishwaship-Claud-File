import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
const calls: Array<{ url: string; init: RequestInit & { allowedHosts?: string[] } }> = [];
let reply: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/security/safe-fetch", () => ({
  safeFetch: async (url: string, init: RequestInit & { allowedHosts?: string[] } = {}) => {
    calls.push({ url, init });
    if (init.allowedHosts && !init.allowedHosts.includes(new URL(url).hostname)) throw new Error("host not allowed");
    const r = reply(url);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  },
}));
delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;

const svc = await import("./services");
const { resendKey } = await import("@/server/email/transport");
const { parseMetaWebhook, metaSendTemplate, templateVars } = await import("@/server/whatsapp/meta");

beforeAll(async () => { await migrate(db, { migrationsFolder: "./migrations" }); });

describe("API Keys & Services", () => {
  it("Resend: validates, stores encrypted, needs a passing test before ON, then email uses the admin key", async () => {
    expect(await svc.saveService("resend", { apiKey: "abc" }, "usr_a")).toMatchObject({ ok: false });
    expect(await svc.saveService("resend", { apiKey: "re_test_1234567890" }, "usr_a")).toMatchObject({ ok: true });
    const row = await svc.serviceRow("resend");
    expect(row.secretsEnc).toBeTruthy();
    expect(row.secretsEnc).not.toContain("re_test_1234567890");
    expect(JSON.stringify(row.secretsHint)).not.toContain("re_test_1234567890");
    expect(await svc.setServiceOn("resend", true, "usr_a")).toMatchObject({ ok: false }); // not tested yet
    reply = () => ({ status: 200, body: { data: [{ name: "vishwaship.in", status: "verified" }] } });
    expect(await svc.testService("resend", "usr_a")).toMatchObject({ ok: true, message: expect.stringContaining("vishwaship.in (verified)") });
    expect(calls.at(-1)!.init.headers).toMatchObject({ authorization: "Bearer re_test_1234567890" });
    expect(await resendKey()).toBe(""); // still OFF
    expect(await svc.setServiceOn("resend", true, "usr_a")).toMatchObject({ ok: true });
    expect(await resendKey()).toBe("re_test_1234567890");
    // blank secret keeps the saved key; a new key resets the test
    expect(await svc.saveService("resend", { apiKey: "" }, "usr_a")).toMatchObject({ ok: true, message: expect.stringMatching(/nothing changed/) });
    expect((await svc.serviceRow("resend")).lastTestOk).toBe(true);
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "service.keys_saved"));
    expect(JSON.stringify(audits)).not.toContain("re_test_1234567890");
  });

  it("a Sending-only Resend key passes; a wrong key fails", async () => {
    reply = () => ({ status: 401, body: { name: "restricted_api_key", message: "This API key is restricted to only send emails" } });
    expect(await svc.testService("resend", "usr_a")).toMatchObject({ ok: true });
    reply = () => ({ status: 401, body: { name: "validation_error", message: "API key is invalid" } });
    expect(await svc.testService("resend", "usr_a")).toMatchObject({ ok: false, message: expect.stringMatching(/rejected/) });
  });

  it("Google: invalid_grant means the client ID + secret are right; the public client ID stays visible, the secret does not", async () => {
    expect(await svc.saveService("google_oauth", { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-secret-value" }, "usr_a")).toMatchObject({ ok: true });
    reply = () => ({ status: 400, body: { error: "invalid_client" } });
    expect(await svc.testService("google_oauth", "usr_a")).toMatchObject({ ok: false });
    reply = () => ({ status: 400, body: { error: "invalid_grant" } });
    expect(await svc.testService("google_oauth", "usr_a")).toMatchObject({ ok: true });
    await svc.setServiceOn("google_oauth", true, "usr_a");
    expect(await svc.activeService("google_oauth")).toMatchObject({ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-secret-value" });
    const view = (await svc.servicesOverview()).find((s) => s.adapter === "google_oauth")!;
    expect(view.fields.find((f) => f.key === "clientId")!.value).toBe("123-abc.apps.googleusercontent.com");
    expect(JSON.stringify(view)).not.toContain("GOCSPX-secret-value");
    expect(view.info.map((i) => i.value)).toContain("http://localhost:3000/api/auth/google/callback");
  });

  it("Firebase mobile OTP: key format, project match and the site as an authorized domain are all checked before ON", async () => {
    expect(await svc.saveService("firebase_phone", { apiKey: "not-a-key", authDomain: "vs.firebaseapp.com", projectId: "vishwaship-app" }, "usr_a")).toMatchObject({ ok: false });
    const key = "AIzaSyD-abcdefghijklmnopqrstuvwxyz0123";
    expect(await svc.saveService("firebase_phone", { apiKey: key, authDomain: "vishwaship-app.firebaseapp.com", projectId: "vishwaship-app" }, "usr_a")).toMatchObject({ ok: true });
    reply = () => ({ status: 400, body: { error: { message: "API key not valid" } } });
    expect(await svc.testService("firebase_phone", "usr_a")).toMatchObject({ ok: false, message: expect.stringMatching(/rejected/) });
    // Google answers with the project NUMBER; the key belongs to another project when its default domain differs
    reply = () => ({ status: 200, body: { projectId: "111111111111", authorizedDomains: ["localhost", "someone-else.firebaseapp.com"] } });
    expect(await svc.testService("firebase_phone", "usr_a")).toMatchObject({ ok: false, message: expect.stringMatching(/different Firebase project/) });
    reply = () => ({ status: 200, body: { projectId: "981211259035", authorizedDomains: ["vishwaship-app.firebaseapp.com", "www.vishwaship.in"] } });
    expect(await svc.testService("firebase_phone", "usr_a")).toMatchObject({ ok: false, message: expect.stringMatching(/Authorized domains/) });
    expect(await svc.setServiceOn("firebase_phone", true, "usr_a")).toMatchObject({ ok: false });
    reply = () => ({ status: 200, body: { projectId: "981211259035", authorizedDomains: ["localhost", "vishwaship-app.firebaseapp.com"] } });
    expect(await svc.testService("firebase_phone", "usr_a")).toMatchObject({ ok: true });
    expect(calls.at(-1)!.init.allowedHosts).toEqual(["www.googleapis.com"]);
    await svc.setServiceOn("firebase_phone", true, "usr_a");
    expect(await svc.activeService("firebase_phone")).toMatchObject({ apiKey: key, projectId: "vishwaship-app" });
  });

  it("WhatsApp: WATI endpoint must be a wati.io host; only one WhatsApp provider is ON at a time", async () => {
    expect(await svc.saveService("wati", { apiEndpoint: "https://evil.example.com/1", accessToken: "t", webhookToken: "x".repeat(20) }, "usr_a")).toMatchObject({ ok: false });
    expect(await svc.saveService("wati", { apiEndpoint: "https://live-mt-server.wati.io/12345", accessToken: "Bearer tok-123", webhookToken: "w".repeat(24) }, "usr_a")).toMatchObject({ ok: true });
    reply = () => ({ status: 200, body: { result: true } });
    expect(await svc.testService("wati", "usr_a")).toMatchObject({ ok: true });
    expect(calls.at(-1)!.init.headers).toMatchObject({ authorization: "Bearer tok-123" }); // "Bearer " prefix stripped on save
    await svc.setServiceOn("wati", true, "usr_a");
    expect((await svc.serviceRow("wati")).configPublic).toMatchObject({ allowedHosts: ["live-mt-server.wati.io"] });

    expect(await svc.saveService("meta_whatsapp", { phoneNumberId: "109876543210", accessToken: "EAAtoken", appSecret: "appsecret", verifyToken: "v".repeat(20) }, "usr_a")).toMatchObject({ ok: true });
    reply = () => ({ status: 200, body: { display_phone_number: "+91 90000 00000", verified_name: "Vishwaship" } });
    expect(await svc.testService("meta_whatsapp", "usr_a")).toMatchObject({ ok: true, message: expect.stringContaining("Vishwaship") });
    await svc.setServiceOn("meta_whatsapp", true, "usr_a");
    expect((await svc.serviceRow("wati")).status).toBe("disabled");
    expect((await svc.serviceRow("meta_whatsapp")).status).toBe("enabled");
  });
});

describe("Meta WhatsApp Cloud API", () => {
  it("sends an approved template with named variables", async () => {
    const sent: Array<{ url: string; body: string }> = [];
    const ctx = { secrets: { phoneNumberId: "109876543210", accessToken: "EAAtoken" }, fetch: async (url: string, init: RequestInit) => { sent.push({ url, body: String(init.body) }); return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }); } } as never;
    const r = await metaSendTemplate(ctx, { toE164: "+919876543210", templateName: "out_for_delivery", language: "en", body: "Hi {{buyer_name}}, order {{order_id}} is out for delivery", params: { buyer_name: "Asha", order_id: "VS-1", awb: "x" } });
    expect(r).toEqual({ ok: true, providerMessageId: "wamid.1" });
    expect(sent[0].url).toBe("https://graph.facebook.com/v21.0/109876543210/messages");
    expect(JSON.parse(sent[0].body)).toMatchObject({ to: "919876543210", type: "template", template: { name: "out_for_delivery", components: [{ type: "body", parameters: [{ parameter_name: "buyer_name", text: "Asha" }, { parameter_name: "order_id", text: "VS-1" }] }] } });
    expect(templateVars("{{a}} {{ b }} {{a}}")).toEqual(["a", "b"]);
  });

  it("reads button replies (with reply context) and delivery statuses from the webhook", () => {
    const ev = parseMetaWebhook({ entry: [{ changes: [{ value: {
      messages: [{ from: "919876543210", id: "wamid.in1", type: "button", button: { text: "Confirm Order", payload: "Confirm Order" }, context: { id: "wamid.out1" } }],
      statuses: [{ id: "wamid.out1", status: "read", recipient_id: "919876543210" }],
    } }] }] });
    expect(ev[0]).toMatchObject({ isReply: true, replyText: "Confirm Order", replyContextId: "wamid.out1", waId: "919876543210" });
    expect(ev[1]).toMatchObject({ isReply: false, deliveryStatus: "read", msgId: "wamid.out1" });
  });
});
