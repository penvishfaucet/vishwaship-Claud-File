/**
 * Pure mapping from store order payloads to Vishwaship OrderInput. No I/O here (unit-tested).
 * Shopify: Admin REST API Order resource. WooCommerce: REST API v3 Order resource.
 */
import type { z } from "zod";
import type { OrderInput } from "@/server/orders/create";

type Input = z.input<typeof OrderInput>;
export interface DefaultPackage { lengthCm: number; breadthCm: number; heightCm: number; weightKg: number }
export type MapResult = { ok: true; externalId: string; name: string; input: Input } | { ok: false; externalId: string; name: string; reason: string; skip?: boolean };

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const mobile10 = (s: unknown) => { const d = digits(s); return d.length > 10 ? d.slice(-10) : d; };
const money = (s: unknown) => Math.round(Number(s ?? 0) * 100) / 100;
const totalGrams = (items: Array<{ grams: number; qty: number }>) => items.reduce((t, i) => t + i.grams * i.qty, 0);

function pkg(def: DefaultPackage, grams: number) {
  return [{ count: 1, lengthCm: def.lengthCm, breadthCm: def.breadthCm, heightCm: def.heightCm, weightKg: Math.max(def.weightKg, grams / 1000) }];
}

// ---------------- Shopify ----------------
export interface ShopifyOrder {
  id: number | string; name: string; currency: string; total_price: string; financial_status: string;
  gateway?: string; payment_gateway_names?: string[]; cancelled_at?: string | null; fulfillment_status?: string | null;
  shipping_address?: { name?: string; first_name?: string; last_name?: string; address1?: string; address2?: string; city?: string; province?: string; zip?: string; phone?: string; country_code?: string } | null;
  phone?: string | null; customer?: { phone?: string | null } | null;
  line_items: Array<{ title: string; quantity: number; price: string; sku?: string | null; grams?: number; requires_shipping?: boolean }>;
}

export function mapShopifyOrder(o: ShopifyOrder, warehouseId: string, def: DefaultPackage): MapResult {
  const externalId = String(o.id), name = o.name;
  if (o.cancelled_at) return { ok: false, externalId, name, reason: "Cancelled in Shopify", skip: true };
  if (o.fulfillment_status === "fulfilled") return { ok: false, externalId, name, reason: "Already fulfilled", skip: true };
  const a = o.shipping_address;
  if (!a) return { ok: false, externalId, name, reason: "No shipping address (digital or pickup order)", skip: true };
  if (a.country_code && a.country_code !== "IN") return { ok: false, externalId, name, reason: "International order (not enabled)", skip: true };
  if (o.currency !== "INR") return { ok: false, externalId, name, reason: `Currency ${o.currency} is not supported` };
  const items = o.line_items.filter((l) => l.requires_shipping !== false);
  if (!items.length) return { ok: false, externalId, name, reason: "No shippable items", skip: true };
  const gateways = [o.gateway ?? "", ...(o.payment_gateway_names ?? [])].join(" ").toLowerCase();
  const cod = /cash on delivery|\bcod\b/.test(gateways) || o.financial_status === "pending";
  const total = money(o.total_price);
  return {
    ok: true, externalId, name,
    input: {
      orderNumber: `SH-${name.replace(/[^\w-]/g, "")}`.slice(0, 40), mode: "B2C", direction: "forward",
      paymentType: cod ? "cod" : "prepaid", codAmountRupees: cod ? total : 0, declaredValueRupees: Math.max(total, 1), warehouseId,
      consignee: {
        name: (a.name || `${a.first_name ?? ""} ${a.last_name ?? ""}`).trim(), mobile: mobile10(a.phone || o.phone || o.customer?.phone),
        line1: a.address1 ?? "", line2: a.address2 || undefined, pincode: digits(a.zip), city: a.city ?? "", state: a.province ?? "",
      },
      products: items.map((l) => ({ name: l.title.slice(0, 120), sku: l.sku ?? undefined, qty: l.quantity, unitPriceRupees: money(l.price) })),
      packages: pkg(def, totalGrams(items.map((l) => ({ grams: l.grams ?? 0, qty: l.quantity })))),
    },
  };
}

// ---------------- WooCommerce ----------------
export interface WooOrder {
  id: number; number: string; status: string; currency: string; total: string; payment_method: string;
  shipping: { first_name?: string; last_name?: string; address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string; country?: string; phone?: string };
  billing: { phone?: string; first_name?: string; last_name?: string; address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string; country?: string };
  line_items: Array<{ name: string; quantity: number; price: number | string; sku?: string }>;
}

/** WooCommerce returns Indian state codes (e.g. "MH"); map to names for the label. */
const IN_STATES: Record<string, string> = { AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam", BR: "Bihar", CH: "Chandigarh", CT: "Chhattisgarh", DN: "Dadra and Nagar Haveli and Daman and Diu", DD: "Daman and Diu", DL: "Delhi", GA: "Goa", GJ: "Gujarat", HR: "Haryana", HP: "Himachal Pradesh", JK: "Jammu and Kashmir", JH: "Jharkhand", KA: "Karnataka", KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep", MP: "Madhya Pradesh", MH: "Maharashtra", MN: "Manipur", ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland", OR: "Odisha", PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu", TS: "Telangana", TR: "Tripura", UP: "Uttar Pradesh", UK: "Uttarakhand", WB: "West Bengal" };

export function mapWooOrder(o: WooOrder, warehouseId: string, def: DefaultPackage): MapResult {
  const externalId = String(o.id), name = `#${o.number}`;
  if (!["processing", "on-hold"].includes(o.status)) return { ok: false, externalId, name, reason: `Status "${o.status}" is not ready to ship`, skip: true };
  const s = o.shipping?.address_1 ? o.shipping : o.billing;
  if (s.country && s.country !== "IN") return { ok: false, externalId, name, reason: "International order (not enabled)", skip: true };
  if (o.currency !== "INR") return { ok: false, externalId, name, reason: `Currency ${o.currency} is not supported` };
  const cod = o.payment_method === "cod";
  const total = money(o.total);
  return {
    ok: true, externalId, name,
    input: {
      orderNumber: `WC-${o.number}`.slice(0, 40), mode: "B2C", direction: "forward",
      paymentType: cod ? "cod" : "prepaid", codAmountRupees: cod ? total : 0, declaredValueRupees: Math.max(total, 1), warehouseId,
      consignee: {
        name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(), mobile: mobile10(o.shipping?.phone || o.billing?.phone),
        line1: s.address_1 ?? "", line2: s.address_2 || undefined, pincode: digits(s.postcode),
        city: s.city ?? "", state: IN_STATES[(s.state ?? "").toUpperCase()] ?? s.state ?? "",
      },
      products: o.line_items.map((l) => ({ name: l.name.slice(0, 120), sku: l.sku || undefined, qty: l.quantity, unitPriceRupees: money(l.price) })),
      packages: pkg(def, 0),
    },
  };
}
