import "server-only";
import { safeFetch } from "@/server/security/safe-fetch";
import type { ShopifyOrder, WooOrder } from "./mapping";

/**
 * Store API clients. Auth per platform docs:
 *  - Shopify: custom app Admin API access token in X-Shopify-Access-Token. Scopes needed:
 *    read_orders, read_merchant_managed_fulfillment_orders, write_merchant_managed_fulfillment_orders.
 *  - WooCommerce: REST API consumer key/secret (Read/Write) via HTTP Basic over HTTPS.
 * All calls go through safeFetch (https only, private/metadata IPs blocked, no redirects).
 */
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-10";

export type StoreCreds = { token?: string; key?: string; secret?: string };

export function normalizeStoreUrl(platform: string, raw: string): string {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new Error("Enter a valid store address"); }
  if (u.protocol !== "https:") throw new Error("Store address must use https");
  if (platform === "shopify" && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(u.hostname)) throw new Error("Use your permanent Shopify address, e.g. yourstore.myshopify.com");
  return `https://${u.hostname.toLowerCase()}${platform === "woocommerce" ? u.pathname.replace(/\/+$/, "") : ""}`;
}

async function call(url: string, init: RequestInit & { allowedHosts?: string[] }) {
  const r = await safeFetch(url, { ...init, timeoutMs: 20_000 });
  if (r.status === 401 || r.status === 403) throw new Error("The store rejected the credentials (check token/keys and scopes)");
  if (r.status === 429) throw new Error("The store rate-limited us; will retry later");
  if (!r.ok) throw new Error(`Store API error HTTP ${r.status}`);
  return r;
}

export const shopify = {
  headers: (c: StoreCreds) => ({ "x-shopify-access-token": c.token ?? "", accept: "application/json", "content-type": "application/json" }),
  async test(base: string, c: StoreCreds) {
    const r = await call(`${base}/admin/api/${SHOPIFY_API_VERSION}/shop.json`, { headers: shopify.headers(c) });
    const j = (await r.json()) as { shop: { name: string; currency: string } };
    return `Connected to “${j.shop.name}” (${j.shop.currency})`;
  },
  async openOrders(base: string, c: StoreCreds, sinceId?: string) {
    const q = new URLSearchParams({ status: "open", fulfillment_status: "unfulfilled", limit: "100", ...(sinceId ? { since_id: sinceId } : {}) });
    const r = await call(`${base}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${q}`, { headers: shopify.headers(c) });
    return ((await r.json()) as { orders: ShopifyOrder[] }).orders;
  },
  /** Create a fulfillment with tracking for all open fulfillment orders of the order. */
  async pushTracking(base: string, c: StoreCreds, orderId: string, t: { number: string; company: string; url: string }) {
    const fo = await call(`${base}/admin/api/${SHOPIFY_API_VERSION}/orders/${encodeURIComponent(orderId)}/fulfillment_orders.json`, { headers: shopify.headers(c) });
    const fos = ((await fo.json()) as { fulfillment_orders: Array<{ id: number; status: string }> }).fulfillment_orders.filter((f) => f.status === "open" || f.status === "in_progress");
    if (!fos.length) return "No open fulfillment orders (already fulfilled?)";
    await call(`${base}/admin/api/${SHOPIFY_API_VERSION}/fulfillments.json`, {
      method: "POST", headers: shopify.headers(c),
      body: JSON.stringify({ fulfillment: { line_items_by_fulfillment_order: fos.map((f) => ({ fulfillment_order_id: f.id })), tracking_info: { number: t.number, company: t.company, url: t.url }, notify_customer: true } }),
    });
    return "Fulfilled with tracking";
  },
};

export const woo = {
  headers: (c: StoreCreds) => ({ authorization: `Basic ${Buffer.from(`${c.key}:${c.secret}`).toString("base64")}`, accept: "application/json", "content-type": "application/json" }),
  async test(base: string, c: StoreCreds) {
    await call(`${base}/wp-json/wc/v3/orders?per_page=1`, { headers: woo.headers(c) });
    return "Connected to WooCommerce REST API v3";
  },
  async openOrders(base: string, c: StoreCreds) {
    const r = await call(`${base}/wp-json/wc/v3/orders?status=processing&per_page=100&orderby=date&order=asc`, { headers: woo.headers(c) });
    return (await r.json()) as WooOrder[];
  },
  /** Adds a customer-visible order note with tracking and marks the order completed. */
  async pushTracking(base: string, c: StoreCreds, orderId: string, t: { number: string; company: string; url: string }) {
    await call(`${base}/wp-json/wc/v3/orders/${encodeURIComponent(orderId)}/notes`, { method: "POST", headers: woo.headers(c), body: JSON.stringify({ note: `Shipped via ${t.company}. AWB ${t.number}. Track: ${t.url}`, customer_note: true }) });
    await call(`${base}/wp-json/wc/v3/orders/${encodeURIComponent(orderId)}`, { method: "PUT", headers: woo.headers(c), body: JSON.stringify({ status: "completed" }) });
    return "Tracking note added, order completed";
  },
};
