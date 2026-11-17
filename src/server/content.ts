import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/server/db/client";

/**
 * Admin-editable customer-facing copy. Every key has a code default; Admin can save a draft and
 * publish it without a deployment. Pages render the PUBLISHED value (or the default).
 * Locales: "en" today; add "hi" etc. by publishing the same key with another locale.
 */
export const CONTENT_KEYS = {
  "portal.dashboard.kyc_banner": { label: "Dashboard — KYC banner text", default: "Complete your KYC — required for COD and remittances. Takes 2 minutes." },
  "portal.dashboard.announcement": { label: "Dashboard — announcement banner (empty = hidden)", default: "" },
  "portal.warehouses.title": { label: "Warehouses — page title", default: "Warehouses / Pickup Addresses" },
  "portal.warehouses.empty": { label: "Warehouses — empty state", default: "No pickup addresses yet. Add one to start shipping." },
  "portal.warehouses.help": { label: "Warehouses — help text", default: "Pickup mobile numbers are verified by OTP before couriers can be booked from that address." },
  "portal.reports.help": { label: "Reports — help text", default: "Downloads use the same filters as the screen and include only your own shipments." },
  "portal.tracking.help": { label: "Track Order — help text", default: "Search by AWB, LR or your order ID." },
  "portal.tracking_page.help": { label: "Branded tracking — help text", default: "Customise the page your buyers see when they track an order. Changes go live only when you publish." },
  "portal.notifications.whatsapp_help": { label: "WhatsApp notifications — help text", default: "Messages are sent to the buyer's delivery phone number from Vishwaship's verified WhatsApp account." },
  "portal.upgrade.body": { label: "Upgrade page — body text", default: "This feature is not included in your current plan. Contact Vishwaship support to enable it." },
  "public.tracking.footer": { label: "Public tracking page — footer note", default: "Shipping powered by Vishwaship" },
  "portal.support.phone_label": { label: "Sidebar — seller support label", default: "Seller Support" },
} as const;

export type ContentKey = keyof typeof CONTENT_KEYS;

const loadPublished = cache(async (locale: string) => {
  const db = await getDb();
  const rows = await db.select().from(schema.contentBlocks).where(eq(schema.contentBlocks.locale, locale));
  return new Map(rows.filter((r) => r.published !== null).map((r) => [r.key, r.published as string]));
});

/** Published copy for a key (falls back to English, then to the code default). */
export async function t(key: ContentKey, locale = "en"): Promise<string> {
  const loc = await loadPublished(locale);
  if (loc.has(key)) return loc.get(key)!;
  if (locale !== "en") { const en = await loadPublished("en"); if (en.has(key)) return en.get(key)!; }
  return CONTENT_KEYS[key].default;
}

export async function contentMap(keys: ContentKey[], locale = "en") {
  return Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await t(k, locale)]))) as Record<ContentKey, string>;
}
