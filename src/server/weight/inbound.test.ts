import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/integrations/services", () => ({ activeService: async () => ({ apiKey: "re_test_key_123", inboundSecret: SECRET }) }));
let mail: Record<string, unknown> = {};
vi.mock("@/server/security/safe-fetch", () => ({
  safeFetch: async (url: string) => {
    if (!url.startsWith("https://api.resend.com/emails/receiving/")) throw new Error(`unexpected ${url}`);
    return new Response(JSON.stringify(mail), { status: 200, headers: { "content-type": "application/json" } });
  },
}));

const SECRET = `whsec_${Buffer.from("test-signing-secret-32-bytes!!!!").toString("base64")}`;
const im = await import("./inbound-mail");
const ORG = "org_im";

const HTML = `<p>Dear Client,</p><p>LR 323198958 (FoD order) was manifested on 20-11-2026 with an initial charged weight of 30 kg. However, based on a verified and accurate source of weight &amp; dimension capture at our facility, we found that the charged weight of this LR is 41 kg.</p>
<p>As a result, the freight charge of this LR has been increased from INR 739.19 to INR 885.74. Please find the detailed breakup below:</p>
<table><tr><td>Base Charge</td><td>&#8377;9.3/Kg</td><td>385.16</td></tr><tr><td><b>Pre-tax Freight Charges</b></td><td></td><td>750.63</td></tr><tr><td>Total</td><td></td><td>Rs.885.74</td></tr></table>`;

function sign(body: string, id = "msg_1", ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return { id, timestamp: String(ts), signature: `v1,${sig}` };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: ORG, name: ORG, businessName: "Ravi Exports" });
  await db.insert(schema.wallets).values({ id: "w_im", orgId: ORG });
  await db.insert(schema.quotes).values({ id: "q_im", orgId: ORG, provider: "delhivery_b2b", carrierCode: "delhivery", serviceName: "B2B Surface", mode: "B2B", request: {},
    priced: { lines: [{ code: "freight", costPreTax: 27_900, markupEligible: true }, { code: "fuel", costPreTax: 4_185, markupEligible: false }, { code: "other", costPreTax: 30_558, markupEligible: false }], markup: { bps: 2500 }, gstBps: 1800 },
    totalPaise: 1, expiresAt: new Date() });
  await db.insert(schema.orders).values({ id: "o_im", orgId: ORG, orderNumber: "VSM1", mode: "B2B", paymentType: "prepaid", declaredValuePaise: 1, consignee: {} });
  await db.insert(schema.shipments).values({ id: "sh_im", orgId: ORG, orderId: "o_im", providerAccountId: "pa", provider: "delhivery_b2b", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "B2B Surface", bookingStatus: "confirmed", status: "in_transit", quoteId: "q_im", sellPaise: 1, costPaise: 62_643, chargeableWeightGrams: 30_000, awb: "323198958", lrNumber: "323198958" });
});

describe("webhook signature", () => {
  it("accepts a valid Svix signature and rejects tampering / stale / wrong secret", () => {
    const body = JSON.stringify({ type: "email.received" });
    const h = sign(body);
    expect(im.verifyWebhookSignature(body, h, SECRET)).toBe(true);
    expect(im.verifyWebhookSignature(`${body} `, h, SECRET)).toBe(false);
    expect(im.verifyWebhookSignature(body, { ...h, signature: "v1,AAAA v1,bad" }, SECRET)).toBe(false);
    expect(im.verifyWebhookSignature(body, h, `whsec_${Buffer.from("other").toString("base64")}`)).toBe(false);
    expect(im.verifyWebhookSignature(body, sign(body, "msg_1", Math.floor(Date.now() / 1000) - 3600), SECRET)).toBe(false);
    expect(im.verifyWebhookSignature(body, { ...h, signature: `v1,zzz ${h.signature}` }, SECRET)).toBe(true); // several signatures
  });
});

describe("courier mail → discrepancy", () => {
  it("html mail reads like the pasted text", () => {
    const t = im.htmlToText(HTML);
    expect(t).toMatch(/charged weight of this LR is 41 kg/);
    expect(t).toMatch(/Pre-tax Freight Charges\s+750\.63/);
  });

  it("only mails from the courier are acted on; body text claiming a forward is not trusted", async () => {
    const text = im.htmlToText(HTML);
    expect((await im.processCourierMail({ from: "someone@gmail.com", subject: "x", text: `---------- Forwarded message ---------\nFrom: <noreply@delhivery.com>\n${text}` })).status).toBe("ignored");
    expect((await im.processCourierMail({ from: "Delhivery <noreply@delhivery.com>", subject: "x", text, dkimFailed: true })).status).toBe("ignored");
    expect((await im.processCourierMail({ from: "noreply@delhivery.com", subject: "Weekly offers", text: "Hello" })).status).toBe("ignored");
    expect((await db.select().from(schema.weightDisputes)).length).toBe(0);
  });

  it("signed webhook: fetches the mail from Resend, raises the discrepancy once, logs it", async () => {
    mail = { from: "Delhivery <noreply@delhivery.com>", subject: "Weight discrepancy LR 323198958", text: null, html: HTML, authentication: { dkim: "pass" } };
    const body = JSON.stringify({ type: "email.received", data: { email_id: "em_1", to: ["owner@gmail.example"], received_for: ["noreply@vishwaship.com"], from: "noreply@delhivery.com", subject: "Weight discrepancy LR 323198958" } });
    const r = await im.handleReceivedWebhook(body);
    expect(r.ok).toBe(true);
    const [d] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.shipmentId, "sh_im"));
    expect(d).toMatchObject({ source: "csv", carrierGrams: 41_000, courierExtraPaise: 12_420, status: "open" });
    expect(d.chargePaise).toBeGreaterThan(14_655); // client pays at least the courier's extra (₹146.55 incl. GST)
    expect((await im.handleReceivedWebhook(body)).message).toBe("Duplicate");
    const log = await im.recentCourierMails();
    expect(log).toHaveLength(1);
    expect(log[0].payloadRedacted).toMatchObject({ status: "raised" });
    expect((await db.select().from(schema.inAppAlerts).where(eq(schema.inAppAlerts.orgId, ORG))).length).toBe(1);
  });

  it("mail to other addresses (support@) is not read or logged", async () => {
    expect((await im.handleReceivedWebhook(JSON.stringify({ type: "email.received", data: { email_id: "em_3", to: ["support@vishwaship.com"], from: "a@b.com" } }))).message).toBe("Not for the courier inbox");
    expect(await im.recentCourierMails()).toHaveLength(1);
  });

  it("other mails (e.g. Gmail forwarding confirmation) are logged with their text for Admin", async () => {
    mail = { from: "forwarding-noreply@google.com", subject: "Gmail Forwarding Confirmation", text: "Confirmation code: 123456789", html: null };
    await im.handleReceivedWebhook(JSON.stringify({ type: "email.received", data: { email_id: "em_2", to: ["noreply@vishwaship.com"], from: "forwarding-noreply@google.com", subject: "Gmail Forwarding Confirmation" } }));
    const [last] = await im.recentCourierMails(1);
    expect(last.payloadRedacted).toMatchObject({ status: "ignored", preview: "Confirmation code: 123456789" });
  });
});
