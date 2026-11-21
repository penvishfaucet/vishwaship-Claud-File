import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createCustomerAccount } from "@/server/auth/accounts";
import { consumeSignupOtp } from "@/server/auth/signup-otp";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { DeviceSchema, issueMobileSession, requestMeta } from "@/server/mobile/auth";
import { mobileJson } from "@/server/mobile/http";
import { meView } from "@/server/mobile/views";
import { hashPassword } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";

/**
 * Android Create Account: same rules as the website signup (email OTP from POST /api/auth/signup-otp, password of
 * at least 8 characters, terms accepted). It is one account for web and app.
 */
const Body = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code sent to your email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Please accept the Terms & shipping policy" }) }),
  device: DeviceSchema.optional(),
  /** Franchise referral code (e.g. VSF-0001), when the app was opened from a referral link. */
  referralCode: z.string().trim().max(20).optional(),
});

export async function POST(req: Request) {
  const m = requestMeta(req);
  if (!(await rateLimit(`signup:${m.ip}`, 5, 3600)).ok) return apiError(429, "rate_limited", "Too many sign-ups from this network. Please try again later.");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const v = p.data;
  const db = await getDb();
  const dup = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.email, v.email)));
  if (dup.length) return apiError(409, "conflict", "An account with this email already exists. Sign in, or use Forgot password to recover it.");
  const otp = await consumeSignupOtp(v.email, v.otp);
  if (!otp.ok) return apiError(422, "validation_error", otp.message);
  const userId = await createCustomerAccount({ name: v.name, email: v.email, passwordHash: await hashPassword(v.password), via: "email_otp", referralCode: v.referralCode });
  if (!userId) return apiError(409, "conflict", "An account with this email already exists. Sign in, or use Forgot password to recover it.");
  const [u] = await db.select({ orgId: schema.users.orgId }).from(schema.users).where(eq(schema.users.id, userId));
  const session = await issueMobileSession(userId, u.orgId!, m, v.device);
  return mobileJson({ ...session, me: await meView(userId, u.orgId!) }, { status: 201 });
}
