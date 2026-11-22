import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { hashPassword, verifyPassword } from "@/server/security/crypto";

/** Change the signed-in user's own password (current password needed when one is set). Staff viewing as a customer cannot. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (s.impersonatorId) return apiError(403, "forbidden", "Staff viewing this account cannot change the customer's password");
  const p = await parseJson(req, z.object({ current: z.string().max(128).default(""), next: z.string().min(8, "New password must be at least 8 characters").max(128) })); if (!p.ok) return p.res;
  if (!(await rateLimit(`pwchange:${s.userId}`, 6, 900)).ok) return apiError(429, "rate_limited", "Too many attempts. Please wait 15 minutes.");
  const db = await getDb();
  const [u] = await db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, s.userId));
  if (u?.hash && !(await verifyPassword(p.data.current, u.hash))) return apiError(422, "validation_error", "Current password is not correct");
  if (p.data.current && p.data.current === p.data.next) return apiError(422, "validation_error", "Choose a password different from the current one");
  await db.update(schema.users).set({ passwordHash: await hashPassword(p.data.next), mustResetPassword: false }).where(eq(schema.users.id, s.userId));
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "auth.password_changed", targetType: "user", targetId: s.userId });
  return NextResponse.json({ ok: true });
}
