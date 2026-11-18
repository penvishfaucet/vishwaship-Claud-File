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
import { CARRIER_SPECS } from "@/server/carriers/specs";

const ADAPTERS: Record<string, ShippingAdapter> = {
  demo: demoAdapter,
  shipmozo: shipmozoAdapter,
  delhivery_b2b: delhiveryB2bAdapter,
  delhivery_b2c: delhiveryB2cAdapter,
};

/** Catalog shown in Admin > Integrations > Add. "adapter_required" providers cannot be enabled yet. */
export const PROVIDER_CATALOG = [
  { adapter: "shipmozo", category: "shipping", name: "Shipmozo (B2C / B2B)", status: "implemented" },
  { adapter: "delhivery_b2c", category: "shipping", name: "Delhivery Direct B2C", status: "implemented" },
  { adapter: "delhivery_b2b", category: "shipping", name: "Delhivery Direct B2B", status: "implemented" },
  { adapter: "shiporax", category: "shipping", name: "Shipora X", status: "adapter_required" },
  { adapter: "ekart", category: "shipping", name: "Ekart", status: "adapter_required" },
  { adapter: "tci", category: "shipping", name: "TCI Express", status: "adapter_required" },
  { adapter: "bluedart", category: "shipping", name: "Blue Dart", status: "adapter_required" },
  { adapter: "demo", category: "shipping", name: "Demo network (fixtures)", status: "demo" },
  { adapter: "razorpay", category: "payments", name: "Razorpay", status: "implemented" },
  { adapter: "cashfree", category: "payments", name: "Cashfree", status: "implemented" },
  { adapter: "wati", category: "messaging", name: "WATI (WhatsApp)", status: "implemented" },
  { adapter: "sms", category: "messaging", name: "SMS / OTP", status: "awaiting_provider" },
  { adapter: "resend", category: "email", name: "Resend", status: "implemented" },
  { adapter: "smtp", category: "email", name: "Custom SMTP", status: "implemented" },
] as const;

export function getAdapter(key: string): ShippingAdapter | null {
  return ADAPTERS[key] ?? null;
}

/** Adapter that runs an account: its own key, or the protocol a custom (Admin-added) provider reuses. */
export function adapterFor(acct: InferSelectModel<typeof schema.providerAccounts>): ShippingAdapter | null {
  const proto = (acct.configPublic as Record<string, unknown> | null)?.protocol;
  return getAdapter(typeof proto === "string" && proto ? proto : acct.adapter);
}

export async function providerContext(acct: InferSelectModel<typeof schema.providerAccounts>): Promise<ProviderContext> {
  const cfg = (acct.configPublic as Record<string, unknown>) ?? {};
  const mode = acct.mode as "test" | "live";
  // Shipping hosts come from code (carriers/specs.ts), never from Admin-editable config.
  const spec = CARRIER_SPECS[typeof cfg.protocol === "string" && cfg.protocol ? cfg.protocol : acct.adapter];
  const allowedHosts = spec ? spec.hosts[mode] : ((cfg.allowedHosts as string[] | undefined) ?? []);
  if (spec && !allowedHosts.length) throw new Error(`${spec.name} has no approved ${mode === "live" ? "production" : "sandbox"} API host yet`);
  return {
    accountId: acct.id,
    mode,
    config: cfg,
    secrets: secretsFor(acct.secretsEnc, mode),
    fetch: (url, init) => safeFetch(url, { ...init, allowedHosts }),
  };
}

/**
 * Courier accounts keep separate sandbox and production credentials: { test: {...}, live: {...} }.
 * Older accounts (Delhivery settings page) store one flat set for the selected environment.
 */
export function secretsFor(enc: string | null, mode: "test" | "live"): Record<string, string> {
  if (!enc) return {};
  const all = decryptJson<Record<string, unknown>>(enc);
  if (all && typeof all === "object" && ("test" in all || "live" in all) && (typeof all.test === "object" || typeof all.live === "object")) {
    return ((all[mode] as Record<string, string> | undefined) ?? {});
  }
  return all as Record<string, string>;
}
