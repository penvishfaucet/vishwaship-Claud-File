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

/** The provider account row for a gateway (created on first use so Admin can configure it). */
export async function gatewayAccount(g: "razorpay" | "cashfree") {
  const db = await getDb();
  const rows = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, g), inArray(schema.providerAccounts.status, ["enabled", "disabled"])));
  if (rows.length) return rows.find((r) => r.status === "enabled") ?? rows[0];
  const id = newId("pa");
  await db.insert(schema.providerAccounts).values({ id, adapter: g, category: "payments", label: g === "razorpay" ? "Razorpay" : "Cashfree", mode: "test", status: "disabled" });
  const [a] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, id));
  return a;
}

/** Usable gateway = selected in settings + account enabled + credentials saved. */
export async function activeGateway(): Promise<null | { gateway: "razorpay" | "cashfree"; acct: typeof schema.providerAccounts.$inferSelect; secrets: Record<string, string>; ctx: Awaited<ReturnType<typeof providerContext>> }> {
  const s = await getPaymentSettings();
  if (s.activeGateway === "none") return null;
  const g = s.activeGateway;
  const db = await getDb();
  const [acct] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, g), eq(schema.providerAccounts.status, "enabled")));
  if (!acct?.secretsEnc) return null;
  const ctx = await providerContext({ ...acct, configPublic: { ...(acct.configPublic as object), allowedHosts: GATEWAY_HOSTS[g] } });
  const need = GATEWAY_SECRETS[g].filter((f) => g !== "razorpay" || f.key !== "webhookSecret").map((f) => f.key);
  if (need.some((k) => !ctx.secrets[k])) return null;
  return { gateway: g, acct, secrets: ctx.secrets, ctx };
}

/** Same as activeGateway() but for a named gateway (webhooks/verification of older orders after a switch). */
export async function gatewayFor(g: "razorpay" | "cashfree") {
  const db = await getDb();
  const [acct] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, g), inArray(schema.providerAccounts.status, ["enabled", "disabled"])));
  if (!acct?.secretsEnc) return null;
  const ctx = await providerContext({ ...acct, configPublic: { ...(acct.configPublic as object), allowedHosts: GATEWAY_HOSTS[g] } });
  return { gateway: g, acct, secrets: ctx.secrets, ctx };
}

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const webhookUrl = (g: Gateway) => `${appUrl()}/api/webhooks/${g}`;
