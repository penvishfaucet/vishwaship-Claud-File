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
const CFG = { phoneNumberId: "555000111", wabaId: "999000", accessToken: "EAAtest", appSecret: "s", verifyToken: "v".repeat(16) };
vi.mock("@/server/integrations/services", () => ({ activeService: async (a: string) => (a === "crm_whatsapp" ? CFG : null) }));

const sent: Array<{ url: string; body: Record<string, unknown> | null }> = [];
const TEMPLATES = { data: [
  { name: "vs_intro_seller", status: "APPROVED", language: "hi", category: "MARKETING", components: [
    { type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Namaste {{1}} ji 🙏 Vishwaship me swagat hai!" }, { type: "BUTTONS", buttons: [{ text: "Haan, batao" }] }] },
  { name: "draft_one", status: "PENDING", language: "en", category: "MARKETING", components: [{ type: "BODY", text: "x" }] },
] };
vi.mock("@/server/security/safe-fetch", () => ({
  safeFetch: async (url: string, init: { method?: string; body?: string }) => {
    sent.push({ url, body: init.body ? JSON.parse(init.body) : null });
    const j = url.includes("/message_templates") ? TEMPLATES : { messages: [{ id: `wamid.${sent.length}` }] };
    return { ok: true, status: 200, json: async () => j };
  },
}));

const W = await import("./whatsapp");
const { createLead, getLead } = await import("./leads");

beforeAll(async () => { await migrate(db, { migrationsFolder: "./migrations" }); });

const hook = (from: string, msg: Record<string, unknown>, name = "Ramesh") => ({
  entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: CFG.phoneNumberId }, contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, ...msg }] } }] }],
});

describe("CRM WhatsApp (Cloud API)", () => {
  it("template payload: header photo link + body variables (positional and named)", () => {
    const t = W.parseTemplate(TEMPLATES.data[0]);
    expect(t).toMatchObject({ header: "IMAGE", vars: ["1"], buttons: ["Haan, batao"] });
    const p = W.templatePayload("919876500001", t, W.fillVars(t, { name: "Ramesh Kumar" }), "https://vishwaship.in/wa/intro-seller.png");
    expect(p.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://vishwaship.in/wa/intro-seller.png" } }] },
      { type: "body", parameters: [{ type: "text", text: "Ramesh" }] },
    ]);
    const named = W.parseTemplate({ name: "n", status: "APPROVED", language: "en", category: "MARKETING", components: [{ type: "BODY", text: "Hi {{first_name}} from {{city}}" }] });
    expect(W.templatePayload("91", named, W.fillVars(named, { name: "Asha", city: "Jaipur" })).template.components[0])
      .toEqual({ type: "body", parameters: [{ type: "text", text: "Asha", parameter_name: "first_name" }, { type: "text", text: "Jaipur", parameter_name: "city" }] });
  });

  it("sends the approved intro with the saved photo, logs it on the lead and moves New → Contacted; free text needs a reply within 24 h", async () => {
    const { id } = await createLead({ name: "Ramesh Kumar", mobile: "9876500001", source: "meta_form" }, null);
    await db.insert(schema.pricingSettings).values({ key: W.MEDIA_SETTING, value: { vs_intro_seller: { url: "https://vishwaship.in/wa/intro-seller.png" } } });
    expect(await W.sendTemplate(id, "draft_one", "usr_s")).toMatchObject({ ok: false });
    const r = await W.sendTemplate(id, "vs_intro_seller", "usr_s");
    expect(r).toMatchObject({ ok: true });
    const msg = sent.at(-1)!;
    expect(msg.url).toContain(`/${CFG.phoneNumberId}/messages`);
    expect(msg.body).toMatchObject({ to: "919876500001", type: "template" });
    const lead = await getLead(id);
    expect(lead).toMatchObject({ status: "contacted", waUnread: 0 });
    const [a] = await db.select().from(schema.crmActivities).where(eq(schema.crmActivities.kind, "wa_out"));
    expect(a.body).toContain("Namaste Ramesh ji");
    expect(a.meta).toMatchObject({ status: "sent", template: "vs_intro_seller", mediaType: "image" });
    expect(await W.sendSession(id, "Kitne orders?", "usr_s")).toMatchObject({ ok: false });
  });

  it("webhook: a reply lands on the lead (unread, 24 h window opens), ticks move forward only, duplicates are ignored", async () => {
    const lead0 = (await db.select().from(schema.crmLeads).where(eq(schema.crmLeads.mobile, "9876500001")))[0];
    const [out] = await db.select().from(schema.crmActivities).where(eq(schema.crmActivities.kind, "wa_out"));
    const wamid = (out.meta as { waMsgId: string }).waMsgId;
    expect(await W.handleCrmWebhook(hook("919876500001", { id: "in1", type: "text", text: { body: "Haan, 200 orders/month" } }), CFG.phoneNumberId)).toEqual({ messages: 1, statuses: 0 });
    expect(await W.handleCrmWebhook(hook("919876500001", { id: "in1", type: "text", text: { body: "dup" } }), CFG.phoneNumberId)).toEqual({ messages: 0, statuses: 0 });
    const lead = await getLead(lead0.id);
    expect(lead?.waUnread).toBe(1);
    expect(W.windowOpen(lead?.lastWaInAt)).toBe(true);
    const st = (s: string) => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: CFG.phoneNumberId }, statuses: [{ id: wamid, status: s }] } }] }] });
    await W.handleCrmWebhook(st("read"), CFG.phoneNumberId);
    await W.handleCrmWebhook(st("delivered"), CFG.phoneNumberId); // late "delivered" never downgrades "read"
    const [after] = await db.select().from(schema.crmActivities).where(eq(schema.crmActivities.id, out.id));
    expect((after.meta as { status: string }).status).toBe("read");
    expect(await W.sendSession(lead0.id, "Great — kal call karta hoon", "usr_s")).toMatchObject({ ok: true });
    expect(sent.at(-1)!.body).toMatchObject({ type: "text", text: { body: "Great — kal call karta hoon" } });
    await W.markSeen(lead0.id);
    expect((await getLead(lead0.id))?.waUnread).toBe(0);
  });

  it("a message from an unknown number becomes a new WhatsApp lead; events for another number are ignored", async () => {
    await W.handleCrmWebhook(hook("919811122233", { id: "in9", type: "image", image: { caption: "rate card bhejo" } }, "Sunita"), CFG.phoneNumberId);
    const [l] = await db.select().from(schema.crmLeads).where(eq(schema.crmLeads.mobile, "9811122233"));
    expect(l).toMatchObject({ name: "Sunita", source: "whatsapp", waUnread: 1, lastNote: "💬 🖼️ Photo: rate card bhejo" });
    expect(await W.handleCrmWebhook(hook("919800000000", { id: "inX", type: "text", text: { body: "hi" } }), "other-number")).toEqual({ messages: 0, statuses: 0 });
  });
});
