import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isEmail = (v: unknown): v is string => typeof v === "string" && v.length <= 160 && EMAIL_RE.test(v.trim());

/**
 * The Vishwaship client's own email (the account that books): its first active customer login, verified first.
 * Couriers (Shipmozo, Delhivery, Shipora X) reject a booking or pickup address without an email, while the receiver's
 * email is optional for our customers — so this is what the courier gets when none was entered.
 */
export async function clientEmail(orgId: string): Promise<string | null> {
  const db = await getDb();
  const [u] = await db.select({ email: schema.users.email }).from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), eq(schema.users.kind, "customer"), eq(schema.users.active, true), isNotNull(schema.users.email)))
    .orderBy(desc(isNotNull(schema.users.emailVerifiedAt)), asc(schema.users.createdAt)).limit(1);
  return isEmail(u?.email) ? u.email!.trim().toLowerCase() : null;
}

/** The email to send to the courier: the one entered, else the client's account email. */
export async function courierEmail(orgId: string, entered: unknown): Promise<string | undefined> {
  if (isEmail(entered)) return entered.trim();
  return (await clientEmail(orgId)) ?? undefined;
}
