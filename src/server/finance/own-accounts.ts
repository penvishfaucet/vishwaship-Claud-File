import "server-only";
import { getSetting } from "@/server/quotes/service";

/**
 * Own accounts (owner 2026-11-26): the owner's own businesses ship from their own customer accounts. They work like any
 * customer (portal, shipments, wallet, their own P&L tab), but the Admin dashboard figures and the Profit & Loss totals
 * leave them out, so those numbers show only real customers. Marked per customer in Admin → Customers → (customer).
 */
export const OWN_ACCOUNTS_KEY = "own_accounts";

export async function ownAccountIds(): Promise<string[]> {
  const v = (await getSetting<unknown>(OWN_ACCOUNTS_KEY, [])).value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
