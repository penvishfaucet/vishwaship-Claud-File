import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { newId } from "@/server/util/ids";

/**
 * New customer account (email-OTP signup or first Google sign-in). The email is already verified by the caller.
 * Business details, mobile and address come next on Complete Your Profile. Returns null when the email is taken.
 */
export async function createCustomerAccount(a: { name: string; email: string; passwordHash?: string | null; googleSub?: string; via: "email_otp" | "google" }) {
  const db = await getDb();
  const orgId = newId("org"), userId = newId("usr");
  try {
    await db.insert(schema.orgs).values({ id: orgId, name: a.name, businessName: a.name });
    await db.insert(schema.users).values({ id: userId, kind: "customer", orgId, name: a.name, email: a.email, emailVerifiedAt: new Date(), passwordHash: a.passwordHash ?? null, googleSub: a.googleSub ?? null });
  } catch (e) {
    if (/unique|duplicate/i.test((e as Error).message) || (e as { cause?: { code?: string } }).cause?.code === "23505") { await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId)); return null; }
    throw e;
  }
  await db.insert(schema.wallets).values({ id: newId("wal"), orgId });
  await db.insert(schema.creditBalances).values({ orgId, credits: 0 });
  await audit({ actorUserId: userId, actorKind: "customer", orgId, action: "auth.signup", details: { via: a.via } });
  return userId;
}

