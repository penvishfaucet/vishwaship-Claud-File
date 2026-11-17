import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/server/db/client";
import { NAV_LABEL_DEFAULTS } from "@/components/portal/nav";
import { SITE } from "@/lib/site";

/**
 * Admin-editable customer-facing copy. Every key has a code default; Admin can save a draft and
 * publish it without a deployment. Pages render the PUBLISHED value (or the default).
 * Locales: "en" today; add "hi" etc. by publishing the same key with another locale.
 */
const STATIC_KEYS = {
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
  "portal.support.phone": { label: "Sidebar — seller support phone", default: SITE.phone },
  "portal.support.hours": { label: "Sidebar — seller support hours", default: SITE.hours },
  "portal.support.email": { label: "Support email shown to sellers", default: SITE.email },
  "portal.early_cod.terms": { label: "Early COD — terms shown to customers", default: "Early COD pays your delivered COD amount faster than the standard cycle. A fee (percentage of the COD amount) is deducted from each early payout. RTO, lost or disputed shipments are excluded. Vishwaship may pause Early COD for accounts with high RTO or open disputes." },
  "portal.edd.help": { label: "EDD widget — help text", default: "Show buyers an estimated delivery date on your product page. The widget only reveals the PIN code check and date, never your rates." },
} as const;

const NAV_KEYS = Object.fromEntries(Object.entries(NAV_LABEL_DEFAULTS).map(([id, label]) => [`nav.${id}`, { label: `Sidebar — ${label}`, default: label }]));

export const CONTENT_KEYS: Record<string, { label: string; default: string }> = { ...STATIC_KEYS, ...NAV_KEYS };

export type ContentKey = keyof typeof STATIC_KEYS | `nav.${string}`;

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
  return CONTENT_KEYS[key]?.default ?? "";
}

export async function contentMap(keys: ContentKey[], locale = "en") {
  return Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await t(k, locale)]))) as Record<ContentKey, string>;
}
