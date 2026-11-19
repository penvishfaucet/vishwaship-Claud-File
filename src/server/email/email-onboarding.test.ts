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
delete process.env.RESEND_API_KEY; // tests use the development outbox, nothing leaves the machine

const { requestSignupOtp, consumeSignupOtp } = await import("@/server/auth/signup-otp");
const { createCustomerAccount } = await import("@/server/auth/accounts");
const { onboardingState } = await import("@/server/onboarding");
const { devOutbox } = await import("./transport");
const svc = await import("./service");
const { sendShipmentStatusEmails } = await import("./shipment-emails");
const { SAMPLE_VARS } = await import("@/lib/email-events");

const lastCode = (to: string) => { const m = devOutbox.find((x) => x.to === to); return /\b(\d{6})\b/.exec(m?.text ?? "")?.[1] ?? ""; };
const logs = () => db.select().from(schema.emailLogs);
const challenge = async (email: string) => (await db.select().from(schema.otpChallenges).where(eq(schema.otpChallenges.target, email)));
const ageChallenges = (email: string) => db.update(schema.otpChallenges).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(schema.otpChallenges.target, email));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
});

describe("email OTP signup", () => {
  it("sends a code; the log never stores it; account is created only after the code verifies, and only once", async () => {
    const email = "new.seller@example.com";
    const r = await requestSignupOtp("  New.Seller@Example.com ", "1.1.1.1");
    expect(r).toMatchObject({ ok: true, validityMin: 10, cooldownSec: 60 });
    const code = lastCode(email);
    expect(code).toMatch(/^\d{6}$/);
    const [log] = (await logs()).filter((l) => l.toEmail === email);
    expect(log).toMatchObject({ event: "signup_otp", status: "sent", retryable: false });
    expect(JSON.stringify(log)).not.toContain(code); // masked in Email Logs
    expect((await challenge(email))[0].codeHash).not.toContain(code);

    // no account yet
    expect(await db.select().from(schema.users).where(eq(schema.users.email, email))).toHaveLength(0);
    expect(await consumeSignupOtp(email, code === "000000" ? "111111" : "000000")).toMatchObject({ ok: false, message: expect.stringMatching(/4 attempts left/) });
    expect(await consumeSignupOtp(email, code)).toEqual({ ok: true });
    expect(await consumeSignupOtp(email, code)).toMatchObject({ ok: false }); // single use
    expect(await createCustomerAccount({ name: "Asha", email, via: "email_otp" })).toBeTruthy();
    expect(await createCustomerAccount({ name: "Asha", email, via: "email_otp" })).toBeNull(); // never a duplicate
    expect(await db.select().from(schema.users).where(eq(schema.users.email, email))).toHaveLength(1);
    expect(await requestSignupOtp(email, "1.1.1.1")).toMatchObject({ ok: false, code: "exists" });
  });

  it("enforces the resend cooldown, and a new code cancels the old one", async () => {
    const email = "cool@example.com";
    await requestSignupOtp(email, "1.1.1.2");
    const first = lastCode(email);
    expect(await requestSignupOtp(email, "1.1.1.2")).toMatchObject({ ok: false, code: "cooldown" });
    await ageChallenges(email);
    expect(await requestSignupOtp(email, "1.1.1.2")).toMatchObject({ ok: true });
    const second = lastCode(email);
    expect((await challenge(email)).filter((c) => !c.verifiedAt)).toHaveLength(1);
    if (first !== second) expect(await consumeSignupOtp(email, first)).toMatchObject({ ok: false });
    expect(await consumeSignupOtp(email, second)).toEqual({ ok: true });
  });

  it("locks the code after the allowed wrong attempts, and expired codes fail", async () => {
    const email = "tries@example.com";
    await requestSignupOtp(email, "1.1.1.3");
    const code = lastCode(email);
    const wrong = code === "999999" ? "888888" : "999999";
    for (let i = 0; i < 5; i++) await consumeSignupOtp(email, wrong);
    expect(await consumeSignupOtp(email, code)).toMatchObject({ ok: false, message: expect.stringMatching(/Too many wrong attempts/) });

    const e2 = "late@example.com";
    await requestSignupOtp(e2, "1.1.1.3");
    await db.update(schema.otpChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.otpChallenges.target, e2));
    expect(await consumeSignupOtp(e2, lastCode(e2))).toMatchObject({ ok: false, message: expect.stringMatching(/expired/) });
  });
});

describe("Google account and onboarding", () => {
  it("a Google identity maps to exactly one account", async () => {
    const id = await createCustomerAccount({ name: "Ravi G", email: "ravi.g@gmail.com", googleSub: "g-123", via: "google" });
    expect(id).toBeTruthy();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.googleSub, "g-123"));
    expect(u).toMatchObject({ id, email: "ravi.g@gmail.com" });
    expect(u.emailVerifiedAt).toBeTruthy();
    expect(await createCustomerAccount({ name: "Ravi G", email: "other@gmail.com", googleSub: "g-123", via: "google" })).toBeNull();
  });

  it("steps: Complete Your Profile → Complete KYC → Under Review → Resubmit → Active", async () => {
    const uid = await createCustomerAccount({ name: "Step Co", email: "steps@example.com", via: "email_otp" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid!));
    const org = u.orgId!;
    expect((await onboardingState(org)).step).toBe("profile");
    await db.update(schema.orgs).set({ profileCompletedAt: new Date() }).where(eq(schema.orgs.id, org));
    expect((await onboardingState(org)).step).toBe("kyc");
    await db.update(schema.orgs).set({ kycStatus: "pending" }).where(eq(schema.orgs.id, org));
    expect((await onboardingState(org)).step).toBe("review");
    await db.update(schema.orgs).set({ kycStatus: "changes_requested" }).where(eq(schema.orgs.id, org));
    expect((await onboardingState(org)).step).toBe("resubmit");
    await db.update(schema.orgs).set({ kycStatus: "approved" }).where(eq(schema.orgs.id, org));
    expect((await onboardingState(org)).step).toBe("active");
  });
});

describe("shipment Picked Up emails", () => {
  let n = 0;
  async function shipment(recipientEmail?: string) {
    const id = `em${++n}`;
    await db.insert(schema.orders).values({ id: `o${id}`, orgId: "org_ship", orderNumber: `VS-${id}`, mode: "B2C", paymentType: "prepaid", declaredValuePaise: 1000, status: "booked",
      consignee: { name: "Meera", mobile: "9876543210", line1: "x", city: "Delhi", state: "DL", pincode: "110001", ...(recipientEmail ? { email: recipientEmail } : {}) } });
    await db.insert(schema.shipments).values({ id: `s${id}`, orgId: "org_ship", orderId: `o${id}`, providerAccountId: "pa", provider: "demo", carrierCode: "delhivery", carrierName: "Delhivery",
      serviceName: "Surface", awb: `AWB${id}`, bookingStatus: "confirmed", pickupStatus: "picked_up", status: "picked_up", quoteId: "q", sellPaise: 12345, costPaise: 80, chargeableWeightGrams: 500 });
    return `s${id}`;
  }
  const logsFor = async (sid: string) => db.select().from(schema.emailLogs).where(eq(schema.emailLogs.shipmentId, sid));

  beforeAll(async () => {
    await db.insert(schema.orgs).values({ id: "org_ship", name: "Ship Co", businessName: "Ship Co Traders", kycStatus: "approved", profileCompletedAt: new Date() });
    await db.insert(schema.users).values({ id: "usr_ship", kind: "customer", orgId: "org_ship", name: "Owner", email: "owner@shipco.test", emailVerifiedAt: new Date() });
  });

  it("not on pickup requested/scheduled; with Recipient Email empty only the Vishwaship Client gets it", async () => {
    const sid = await shipment();
    expect(await sendShipmentStatusEmails(sid, "pickup_scheduled")).toEqual([]);
    const out = await sendShipmentStatusEmails(sid, "picked_up");
    expect(out).toEqual([{ event: "shipment_picked_up", to: "owner@shipco.test", status: "sent" }]);
    const mail = devOutbox.find((m) => m.to === "owner@shipco.test")!;
    expect(mail.text).toContain("VS-em1");
    expect(mail.text).toContain("AWBem1");
    expect(mail.html).toContain("Track Shipment");
  });

  it("with Recipient Email and the rule on, both get it; a repeated courier update sends nothing; recipient sees no price", async () => {
    await svc.saveAuthSettings({ googleEnabled: true, otpValidityMin: 10, otpCooldownSec: 60, otpMaxAttempts: 5 });
    await db.insert(schema.emailRules).values({ event: "shipment_picked_up", enabled: true, toClient: true, toRecipient: true })
      .onConflictDoUpdate({ target: schema.emailRules.event, set: { toRecipient: true } });
    const sid = await shipment("meera@buyer.test");
    const out = await sendShipmentStatusEmails(sid, "picked_up");
    expect(out.map((o) => [o.to, o.status])).toEqual([["owner@shipco.test", "sent"], ["meera@buyer.test", "sent"]]);
    const again = await sendShipmentStatusEmails(sid, "in_transit"); // first scan past pickup re-triggers Picked Up → deduped
    expect(again.every((o) => o.status === "duplicate")).toBe(true);
    expect(await logsFor(sid)).toHaveLength(2);
    const r = devOutbox.find((m) => m.to === "meera@buyer.test")!;
    expect(r.text).not.toMatch(/₹|123\.45|wallet/i);
  });

  it("a different verified sender per event applies from the next email; failures are logged and Retry sends them", async () => {
    const list = await svc.senders();
    expect(list.find((s) => s.isDefault)?.email).toBe("contact@vishwaship.in");
    await db.insert(schema.emailSenders).values({ id: "snd_ops", email: "pickups@vishwaship.in", displayName: "Vishwaship Pickups", status: "pending" });
    expect((await svc.refreshSenderStatus("snd_ops"))?.status).toBe("verified"); // simulated in development
    await db.update(schema.emailRules).set({ senderId: "snd_ops" }).where(eq(schema.emailRules.event, "shipment_picked_up"));
    const sid = await shipment("fails+fail@buyer.test");
    await sendShipmentStatusEmails(sid, "picked_up");
    const rows = await logsFor(sid);
    expect(rows.every((l) => l.senderEmail === "pickups@vishwaship.in")).toBe(true);
    const failed = rows.find((l) => l.toEmail === "fails+fail@buyer.test")!;
    expect(failed).toMatchObject({ status: "failed", retryable: true, error: expect.stringMatching(/simulated provider failure/) });
    expect((await svc.senderUsage())["snd_ops"]).toEqual(["shipment_picked_up"]);
    expect(await svc.retryEmail(failed.id)).toEqual({ ok: true });
    const [after] = await db.select().from(schema.emailLogs).where(eq(schema.emailLogs.id, failed.id));
    expect(after).toMatchObject({ status: "sent", attempts: 2 });
    // the OTP still uses the default sender
    await requestSignupOtp("otp.sender@example.com", "2.2.2.2");
    const [otp] = await db.select().from(schema.emailLogs).where(and(eq(schema.emailLogs.event, "signup_otp"), eq(schema.emailLogs.toEmail, "otp.sender@example.com")));
    expect(otp.senderEmail).toBe("contact@vishwaship.in");
  });

  it("OTP emails are never retried; template preview uses sample values with the logo", async () => {
    const [otp] = await db.select().from(schema.emailLogs).where(eq(schema.emailLogs.event, "signup_otp")).limit(1);
    await db.update(schema.emailLogs).set({ status: "failed" }).where(eq(schema.emailLogs.id, otp.id));
    expect(await svc.retryEmail(otp.id)).toMatchObject({ ok: false, message: expect.stringMatching(/one-time code/) });
    const m = svc.renderEmail("shipment_picked_up", await svc.template("shipment_picked_up"), SAMPLE_VARS);
    expect(m.html).toContain("vishwaship-logo-transparent.png");
    expect(m.subject).toContain(SAMPLE_VARS.order_id);
    const o = svc.renderEmail("signup_otp", { subject: "Code {{otp}}", body: "<b>{{customer_name}}</b> {{otp}}" }, { ...SAMPLE_VARS, customer_name: "<script>x</script>" });
    expect(o.html).toContain("123456");
    expect(o.html).not.toContain("<script>x</script>"); // values are escaped
  });
});
