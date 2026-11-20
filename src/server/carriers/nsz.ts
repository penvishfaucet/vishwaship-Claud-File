import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

/**
 * Non-serviceable zones (NSZ) learned from bookings. Delhivery B2B can quote a lane and then reject the
 * booking with "Destination Center is NSZ". When that happens we remember the destination PIN for that
 * courier integration for a while, so it is not offered there again and the customer is not sent into
 * the same failure. Stored in pricing_settings under `nsz_pins:<adapter>` as { pin: ISO time }.
 */
export const NSZ_DAYS = 15;
const NSZ_RE = /\bNSZ\b|non[-\s]?serviceable\s+zone/i;
const key = (adapter: string) => `nsz_pins:${adapter}`;

/** True when a courier's error says the destination is a non-serviceable zone. */
export const isNszError = (message: string) => NSZ_RE.test(message);

/** Customer-facing message for an NSZ rejection (no raw courier text). */
export const nszMessage = (carrier: string, pin: string) =>
  `${carrier} cannot deliver to PIN ${pin} right now: its delivery centre for this PIN is a non-serviceable zone (NSZ). Nothing was charged — please choose another courier for this order.`;

async function load(adapter: string): Promise<Record<string, string>> {
  const db = await getDb();
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, key(adapter)));
  return (row?.value as Record<string, string> | undefined) ?? {};
}

/** Remember a PIN as NSZ for this integration (older entries are dropped). */
export async function rememberNsz(adapter: string, pin: string, now = new Date()) {
  const cutoff = now.getTime() - NSZ_DAYS * 86_400_000;
  const kept = Object.fromEntries(Object.entries(await load(adapter)).filter(([, at]) => Date.parse(at) > cutoff));
  kept[pin] = now.toISOString();
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: key(adapter), value: kept })
    .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: kept, updatedAt: now } });
}

/** True when this integration rejected this PIN as NSZ within the last NSZ_DAYS days. */
export async function isNszPin(adapter: string, pin: string, now = new Date()) {
  const at = (await load(adapter))[pin];
  return !!at && now.getTime() - Date.parse(at) < NSZ_DAYS * 86_400_000;
}
