import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { providerContext } from "@/server/providers/registry";
import { getSetting } from "@/server/quotes/service";
import { newId } from "@/server/util/ids";
import { type Gateway, type PaymentSettings, PAYMENT_DEFAULTS } from "@/lib/recharge";

const KEY = "payment_settings";

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const v = (await getSetting<Partial<PaymentSettings>>(KEY, PAYMENT_DEFAULTS)).value;
  return { ...PAYMENT_DEFAULTS, ...v, manual: { ...PAYMENT_DEFAULTS.manual, ...(v.manual ?? {}) } };
}

export async function savePaymentSettings(next: PaymentSettings) {
  const db = await getDb();
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, KEY));
  if (row) await db.update(schema.pricingSettings).set({ value: next, version: row.version + 1, updatedAt: new Date() }).where(eq(schema.pricingSettings.key, KEY));
  else await db.insert(schema.pricingSettings).values({ key: KEY, value: next });
}

export const GATEWAY_HOSTS: Record<"razorpay" | "cashfree", string[]> = {
  razorpay: ["api.razorpay.com"],
  cashfree: ["api.cashfree.com", "sandbox.cashfree.com"],
};
export const GATEWAY_SECRETS: Record<"razorpay" | "cashfree", Array<{ key: string; label: string; secret: boolean }>> = {
  razorpay: [{ key: "keyId", label: "Key ID", secret: false }, { key: "keySecret", label: "Key Secret", secret: true }, { key: "webhookSecret", label: "Webhook Secret", secret: true }],
  cashfree: [{ key: "clientId", label: "App ID / Client ID", secret: false }, { key: "clientSecret", label: "Secret Key", secret: true }],
};

type Acct = typeof schema.providerAccounts.$inferSelect;
type Online = "razorpay" | "cashfree";
export const ONLINE_GATEWAYS: Online[] = ["razorpay", "cashfree"];

/**
 * The account row a gateway uses. There can be more than one row (e.g. a seeded placeholder plus the one Admin
 * configured): the row with saved keys wins, an enabled one first — never an empty placeholder.
 */
function pickRow(rows: Acct[]): Acct | undefined {
  const rank = (r: Acct) => (r.secretsEnc ? 2 : 0) + (r.status === "enabled" ? 1 : 0);
  return [...rows].sort((x, y) => rank(y) - rank(x) || +y.createdAt - +x.createdAt)[0];
}
async function rowsFor(g: Online) {
  const db = await getDb();
  return db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, g), inArray(schema.providerAccounts.status, ["enabled", "disabled"])));
}

/** The provider account row for a gateway (created on first use so Admin can configure it). */
export async function gatewayAccount(g: Online) {
  const row = pickRow(await rowsFor(g));
  if (row) return row;
  const db = await getDb();
  const id = newId("pa");
  await db.insert(schema.providerAccounts).values({ id, adapter: g, category: "payments", label: g === "razorpay" ? "Razorpay" : "Cashfree", mode: "test", status: "disabled" });
  const [a] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, id));
  return a;
}

/** Why a gateway is or is not offered to customers (Admin → Payment Settings shows this). */
export async function gatewayAvailability(g: Online): Promise<{ usable: boolean; reason: string; acct: Acct | null; secrets: Record<string, string>; ctx: Awaited<ReturnType<typeof providerContext>> | null }> {
  const acct = pickRow(await rowsFor(g)) ?? null;
  const name = g === "razorpay" ? "Razorpay" : "Cashfree";
  if (!acct) return { usable: false, reason: `${name} is not set up`, acct, secrets: {}, ctx: null };
  if (acct.status !== "enabled") return { usable: false, reason: `${name} is disabled — click Enable ${name}`, acct, secrets: {}, ctx: null };
  if (!acct.secretsEnc) return { usable: false, reason: `${name} keys are not saved`, acct, secrets: {}, ctx: null };
  let ctx: Awaited<ReturnType<typeof providerContext>>;
  try { ctx = await providerContext({ ...acct, configPublic: { ...(acct.configPublic as object), allowedHosts: GATEWAY_HOSTS[g] } }); }
  catch { return { usable: false, reason: `${name} keys cannot be read — save them again`, acct, secrets: {}, ctx: null }; }
  const need = GATEWAY_SECRETS[g].filter((f) => g !== "razorpay" || f.key !== "webhookSecret");
  const missing = need.filter((f) => !ctx.secrets[f.key]).map((f) => f.label);
  if (missing.length) return { usable: false, reason: `${name} is missing: ${missing.join(", ")}`, acct, secrets: ctx.secrets, ctx };
  if (g === "razorpay" && !ctx.secrets.keyId.startsWith(acct.mode === "live" ? "rzp_live_" : "rzp_test_")) return { usable: false, reason: `The Razorpay Key ID does not match ${acct.mode === "live" ? "Live" : "Test"} mode`, acct, secrets: ctx.secrets, ctx };
  return { usable: true, reason: `${name} is shown to customers (${acct.mode === "live" ? "Live" : "Test"})`, acct, secrets: ctx.secrets, ctx };
}

/**
 * Online gateways customers can pay with = every gateway Admin has Enabled with its keys saved.
 * The Preferred gateway (Payment Settings) is listed first and pre-selected; it no longer hides an enabled one.
 */
export async function usableGateways() {
  const pref = (await getPaymentSettings()).activeGateway;
  const out: Array<{ gateway: Online; acct: Acct; secrets: Record<string, string>; ctx: Awaited<ReturnType<typeof providerContext>> }> = [];
  for (const g of ONLINE_GATEWAYS) {
    const a = await gatewayAvailability(g);
    if (a.usable && a.acct && a.ctx) out.push({ gateway: g, acct: a.acct, secrets: a.secrets, ctx: a.ctx });
  }
  return out.sort((x, y) => (y.gateway === pref ? 1 : 0) - (x.gateway === pref ? 1 : 0));
}

/** The gateway for a new online recharge: the one the customer chose if usable, else the preferred / first usable one. */
export async function activeGateway(choice?: Online | null) {
  const list = await usableGateways();
  return (choice ? list.find((x) => x.gateway === choice) : undefined) ?? list[0] ?? null;
}

/** A named gateway with its keys (webhooks / verification of older orders, also after it was switched off). */
export async function gatewayFor(g: Online) {
  const acct = pickRow((await rowsFor(g)).filter((r) => r.secretsEnc));
  if (!acct?.secretsEnc) return null;
  const ctx = await providerContext({ ...acct, configPublic: { ...(acct.configPublic as object), allowedHosts: GATEWAY_HOSTS[g] } });
  return { gateway: g, acct, secrets: ctx.secrets, ctx };
}

export const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");
export const webhookUrl = (g: Gateway) => `${appUrl()}/api/webhooks/${g}`;
