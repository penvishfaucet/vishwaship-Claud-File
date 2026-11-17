import type { InferSelectModel } from "drizzle-orm";
import type { schema } from "@/server/db/client";
import { type Bps, pctOf } from "@/lib/money";
import type { PricedQuote } from "@/server/pricing/engine";
import type { PaymentMode, ShippingAdapter } from "@/server/providers/types";

/**
 * Payment modes per carrier account (Admin → Carrier Integrations). Stored in provider_accounts.config_public.payments.
 *  prepaid — sender pays freight from the Vishwaship wallet
 *  cod     — receiver pays the goods value; freight is still billed to the sender
 *  fod     — receiver pays the freight at delivery. Enabled for customers only when Admin sets fodStatus "active"
 *            after Delhivery has activated FOD on the account and the collection basis is confirmed.
 */
export type FodStatus = "pending_activation" | "active" | "not_supported";
export type FodBasis = "carrier_freight" | "vishwaship_rate";
export interface PaymentConfig { prepaid: boolean; cod: boolean; fod: boolean; fodStatus: FodStatus; fodBasis: FodBasis }

export function paymentConfig(acct: InferSelectModel<typeof schema.providerAccounts>, adapter: ShippingAdapter | null): PaymentConfig {
  const supported = adapter?.paymentModes ?? ["prepaid", "cod"];
  const p = ((acct.configPublic as Record<string, unknown>)?.payments ?? {}) as Partial<PaymentConfig>;
  return {
    prepaid: supported.includes("prepaid") && p.prepaid !== false,
    cod: supported.includes("cod") && p.cod !== false,
    fod: supported.includes("fod") && p.fod === true,
    fodStatus: supported.includes("fod") ? p.fodStatus ?? "pending_activation" : "not_supported",
    fodBasis: p.fodBasis ?? "carrier_freight",
  };
}

export function modeAllowed(cfg: PaymentConfig, mode: PaymentMode): { ok: true } | { ok: false; reason: string } {
  if (mode === "fod") {
    if (cfg.fodStatus === "not_supported") return { ok: false, reason: "FOD is not available on this service" };
    if (cfg.fodStatus !== "active") return { ok: false, reason: "FOD is pending Delhivery activation" };
    if (!cfg.fod) return { ok: false, reason: "FOD is switched off by Vishwaship" };
    return { ok: true };
  }
  return cfg[mode] ? { ok: true } : { ok: false, reason: `${mode === "cod" ? "COD" : "Prepaid"} is switched off for this service` };
}

export interface PayerSplit { sender: number; receiver: number; basis: "sender_pays" | FodBasis }

/**
 * Who pays what. FOD with carrier_freight: the courier collects its own freight (+GST) from the receiver and
 * the sender's wallet is charged only Vishwaship's margin (+GST on it). FOD with vishwaship_rate: the receiver
 * pays the full Vishwaship rate (only once Delhivery confirms it can collect that amount).
 */
export function payerSplit(priced: PricedQuote, mode: PaymentMode, basis: FodBasis, gstBps: Bps): PayerSplit {
  if (mode !== "fod") return { sender: priced.total, receiver: 0, basis: "sender_pays" };
  if (basis === "vishwaship_rate") return { sender: 0, receiver: priced.total, basis };
  const receiver = Math.min(priced.total, priced.costPreTax + pctOf(priced.costPreTax, gstBps));
  return { sender: priced.total - receiver, receiver, basis };
}
