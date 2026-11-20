import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { revokeAllSessions } from "@/server/auth/session";
import { consumeResetOtp } from "@/server/auth/signup-otp";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { DeviceSchema, issueMobileSession, requestMeta } from "@/server/mobile/auth";
import { mobileJson } from "@/server/mobile/http";
import { meView } from "@/server/mobile/views";
import { hashPassword } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";

/** Forgot password (code from POST /api/auth/signup-otp {purpose:"reset"}). Signs out every web and app session. */
const Body = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code sent to your email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  device: DeviceSchema.optional(),
});

export async function POST(req: Request) {
  const m = requestMeta(req);
  if (!(await rateLimit(`reset:${m.ip}`, 10, 3600)).ok) return apiError(429, "rate_limited", "Too many attempts. Please try again later.");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const v = p.data;
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.email, v.email)));
  if (!u || !u.active || !u.orgId) return apiError(404, "not_found", "No Vishwaship account uses this email.");
  const otp = await consumeResetOtp(v.email, v.otp);
  if (!otp.ok) return apiError(422, "validation_error", otp.message);
  await db.update(schema.users).set({ passwordHash: await hashPassword(v.password), emailVerifiedAt: u.emailVerifiedAt ?? new Date() }).where(eq(schema.users.id, u.id));
  await revokeAllSessions(u.id);
  await audit({ actorUserId: u.id, actorKind: "customer", orgId: u.orgId, action: "auth.password_reset", details: { via: "email_otp", channel: "android" } });
  const session = await issueMobileSession(u.id, u.orgId, m, v.device);
  return mobileJson({ ...session, me: await meView(u.id, u.orgId) });
}
