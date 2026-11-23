import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { issueOtp, verifyOtp } from "@/server/otp";
import { rateLimit } from "@/server/security/rate-limit";
import { PICKUP_OTP_MSG, checkPickupMobileToken } from "@/server/warehouses";
import { firebasePhoneConfig } from "@/server/auth/firebase-phone";

async function load(id: string, orgId: string) {
  const db = await getDb();
  const [w] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.orgId, orgId)));
  return w;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const w = await load((await params).id, s.orgId);
  if (!w) return apiError(404, "not_found", "Address not found");
  // mobile OTP through Firebase: the browser sends the SMS to this number and returns a token to PUT below
  if (await firebasePhoneConfig()) return NextResponse.json({ firebase: true, mobile: w.mobile });
  const rl = await rateLimit(`otp:wh:${w.mobile}`, 5, 3600);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many OTP requests. Try again later.");
  const r = await issueOtp(w.mobile, `pickup_mobile:${w.id}`);
  if (!r.sent) return apiError(503, "provider_error", "SMS is not configured yet. Contact support.");
  return NextResponse.json({ sent: true, devCode: r.devCode });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const w = await load((await params).id, s.orgId);
  if (!w) return apiError(404, "not_found", "Address not found");
  const p = await parseJson(req, z.union([z.object({ code: z.string().regex(/^\d{6}$/) }), z.object({ idToken: z.string().min(20).max(4096) })]));
  if (!p.ok) return p.res;
  if ("idToken" in p.data) {
    const otp = await checkPickupMobileToken(p.data.idToken, w.mobile);
    if (otp === "off") return apiError(400, "validation_error", "Mobile OTP is switched off. Request a new code.");
    if (otp !== "ok") return apiError(400, "validation_error", PICKUP_OTP_MSG[otp]);
  } else {
    const v = await verifyOtp(w.mobile, `pickup_mobile:${w.id}`, p.data.code);
    if (!v.ok) return apiError(400, "validation_error", v.message);
  }
  const db = await getDb();
  await db.update(schema.warehouses).set({ mobileVerifiedAt: new Date() }).where(eq(schema.warehouses.id, w.id));
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "warehouse.mobile_verified", targetType: "warehouse", targetId: w.id });
  return NextResponse.json({ ok: true });
}
