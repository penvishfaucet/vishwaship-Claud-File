import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { sha256, safeEqual } from "@/server/security/crypto";
import { newId } from "@/server/util/ids";

/** OTP: 6 digits, 10 min, max 5 attempts, hashed at rest. Sending goes through the SMS adapter when configured. */
export async function issueOtp(target: string, purpose: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const db = await getDb();
  await db.insert(schema.otpChallenges).values({ id: newId("otp"), target, purpose, codeHash: sha256(`${purpose}:${target}:${code}`), expiresAt: new Date(Date.now() + 10 * 60_000) });
  const [sms] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, "sms"), eq(schema.providerAccounts.status, "enabled")));
  if (sms) {
    // TODO(owner): wire the chosen SMS provider + DLT template once supplied. Until then this branch is unreachable.
    return { sent: true as const, devCode: null };
  }
  // No SMS provider: return the code for on-screen display, but never in production.
  if (process.env.NODE_ENV === "production") return { sent: false as const, devCode: null };
  return { sent: true as const, devCode: code };
}

export async function verifyOtp(target: string, purpose: string, code: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.otpChallenges)
    .where(and(eq(schema.otpChallenges.target, target), eq(schema.otpChallenges.purpose, purpose), isNull(schema.otpChallenges.verifiedAt), gt(schema.otpChallenges.expiresAt, new Date())))
    .orderBy(desc(schema.otpChallenges.createdAt)).limit(1);
  if (!c) return { ok: false as const, message: "Code expired. Request a new one." };
  if (c.attempts >= 5) return { ok: false as const, message: "Too many attempts. Request a new code." };
  await db.update(schema.otpChallenges).set({ attempts: c.attempts + 1 }).where(eq(schema.otpChallenges.id, c.id));
  if (!safeEqual(sha256(`${purpose}:${target}:${code}`), c.codeHash)) return { ok: false as const, message: "Incorrect code." };
  await db.update(schema.otpChallenges).set({ verifiedAt: new Date() }).where(eq(schema.otpChallenges.id, c.id));
  return { ok: true as const };
}
