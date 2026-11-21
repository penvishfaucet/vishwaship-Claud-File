import { NextResponse } from "next/server";
import { z } from "zod";
import { saveOrgSetting } from "@/server/couriers";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { onlineMethods } from "@/server/store/checkout";
import { GATEWAY_KEYS, type GatewayKey, removeGateway, saveGatewayKeys, testGateway } from "@/server/store/gateways";

const Gw = z.enum(GATEWAY_KEYS as [GatewayKey, ...GatewayKey[]]);
const limited = async (orgId: string) => !(await rateLimit(`store-pg:${orgId}`, 30, 600)).ok;

/** Save a Cashfree / PhonePe / Paytm account (tested at once). Blank secrets keep the stored ones. */
export async function PUT(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (await limited(g.s.orgId)) return apiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const p = await parseJson(req, z.object({ gateway: Gw, mode: z.enum(["test", "live"]), keys: z.record(z.string().max(40), z.string().max(200)) })); if (!p.ok) return p.res;
  const r = await saveGatewayKeys(g.s.orgId, g.s.userId, p.data.gateway, p.data.mode, p.data.keys);
  await storeAudit(g.s, "gateway.save", undefined, { gateway: p.data.gateway, mode: p.data.mode, ok: r.ok });
  return r.ok ? NextResponse.json(r) : fail(r.message);
}

/** Test again. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (await limited(g.s.orgId)) return apiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const p = await parseJson(req, z.object({ gateway: Gw })); if (!p.ok) return p.res;
  const r = await testGateway(g.s.orgId, p.data.gateway, g.s.userId);
  await storeAudit(g.s, "gateway.test", undefined, { gateway: p.data.gateway, ok: r.ok });
  return r.ok ? NextResponse.json(r) : fail(r.message);
}

/** Choose which connected method buyers get when they pick "Pay online". */
export async function PATCH(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ primary: z.enum(["razorpay", ...GATEWAY_KEYS] as [string, ...string[]]) })); if (!p.ok) return p.res;
  if (!(await onlineMethods(g.s.orgId)).includes(p.data.primary as never)) return fail("Connect this payment method first");
  await saveOrgSetting(g.s.orgId, "store_payments", { primary: p.data.primary }, g.s.userId);
  await storeAudit(g.s, "gateway.primary", undefined, { primary: p.data.primary });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ gateway: Gw })); if (!p.ok) return p.res;
  await removeGateway(g.s.orgId, p.data.gateway);
  await storeAudit(g.s, "gateway.remove", undefined, { gateway: p.data.gateway });
  return NextResponse.json({ ok: true });
}
