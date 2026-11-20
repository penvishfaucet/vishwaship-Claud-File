import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { removeRazorpay, saveRazorpayKeys, testRazorpay } from "@/server/store/razorpay";

/** Save the merchant's own Razorpay keys (tested immediately). Blank secrets keep the stored ones. */
export async function PUT(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-rzp:${g.s.orgId}`, 20, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const p = await parseJson(req, z.object({ keyId: z.string().max(60), keySecret: z.string().max(120).default(""), webhookSecret: z.string().max(120).default("") })); if (!p.ok) return p.res;
  const r = await saveRazorpayKeys(g.s.orgId, g.s.userId, p.data);
  await storeAudit(g.s, "razorpay.save", undefined, { ok: r.ok });
  return r.ok ? NextResponse.json(r) : fail(r.message);
}

export async function POST() {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-rzp:${g.s.orgId}`, 20, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const r = await testRazorpay(g.s.orgId, g.s.userId);
  await storeAudit(g.s, "razorpay.test", undefined, { ok: r.ok });
  return r.ok ? NextResponse.json(r) : fail(r.message);
}

export async function DELETE() {
  const g = await storeGuard(); if (g.err) return g.err;
  await removeRazorpay(g.s.orgId);
  await storeAudit(g.s, "razorpay.remove");
  return NextResponse.json({ ok: true });
}
