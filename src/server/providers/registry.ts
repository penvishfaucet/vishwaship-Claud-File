import "server-only";
import type { InferSelectModel } from "drizzle-orm";
import type { schema } from "@/server/db/client";
import { decryptJson } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";
import { demoAdapter } from "./demo";
import { shipmozoAdapter } from "./shipmozo";
import { delhiveryB2bAdapter } from "./delhivery-b2b";
import { delhiveryB2cAdapter } from "./delhivery-b2c";
import type { ProviderContext, ShippingAdapter } from "./types";

const ADAPTERS: Record<string, ShippingAdapter> = {
  demo: demoAdapter,
  shipmozo: shipmozoAdapter,
  delhivery_b2b: delhiveryB2bAdapter,
  delhivery_b2c: delhiveryB2cAdapter,
};

/** Catalog shown in Admin > Integrations > Add. "adapter_required" providers cannot be enabled yet. */
export const PROVIDER_CATALOG = [
  { adapter: "shipmozo", category: "shipping", name: "Shipmozo", status: "implemented" },
  { adapter: "delhivery_b2c", category: "shipping", name: "Delhivery Direct B2C", status: "implemented" },
  { adapter: "delhivery_b2b", category: "shipping", name: "Delhivery Direct B2B", status: "implemented" },
  { adapter: "shiprocket", category: "shipping", name: "Shiprocket", status: "adapter_required" },
  { adapter: "dtdc", category: "shipping", name: "DTDC", status: "adapter_required" },
  { adapter: "dhl", category: "shipping", name: "DHL", status: "adapter_required" },
  { adapter: "tci", category: "shipping", name: "TCI", status: "adapter_required" },
  { adapter: "fedex", category: "shipping", name: "FedEx", status: "adapter_required" },
  { adapter: "demo", category: "shipping", name: "Demo network (fixtures)", status: "demo" },
  { adapter: "razorpay", category: "payments", name: "Razorpay", status: "implemented" },
  { adapter: "wati", category: "messaging", name: "WATI (WhatsApp)", status: "implemented" },
  { adapter: "sms", category: "messaging", name: "SMS / OTP", status: "awaiting_provider" },
  { adapter: "resend", category: "email", name: "Resend", status: "implemented" },
  { adapter: "smtp", category: "email", name: "Custom SMTP", status: "implemented" },
] as const;

export function getAdapter(key: string): ShippingAdapter | null {
  return ADAPTERS[key] ?? null;
}

export async function providerContext(acct: InferSelectModel<typeof schema.providerAccounts>): Promise<ProviderContext> {
  const allowedHosts = ((acct.configPublic as Record<string, unknown>)?.allowedHosts as string[] | undefined) ?? [];
  return {
    accountId: acct.id,
    mode: acct.mode as "test" | "live",
    config: (acct.configPublic as Record<string, unknown>) ?? {},
    secrets: acct.secretsEnc ? decryptJson<Record<string, string>>(acct.secretsEnc) : {},
    fetch: (url, init) => safeFetch(url, { ...init, allowedHosts }),
  };
}
