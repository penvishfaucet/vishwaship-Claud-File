import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { addDomain, disconnectDomain, setPrimary, verifyDomain } from "@/server/store/domains";
import { markStep } from "@/server/store/service";

/** Connect a custom domain. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ hostname: z.string().max(253) })); if (!p.ok) return p.res;
  const r = await addDomain(g.s.orgId, p.data.hostname);
  if (!r.ok) return fail(r.message);
  await storeAudit(g.s, "domain.add", r.id, { hostname: p.data.hostname });
  await markStep(g.s.orgId, 5);
  return NextResponse.json(r);
}

/** check | primary | disconnect */
export async function PATCH(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ id: z.string().max(60), action: z.enum(["check", "primary", "disconnect"]) })); if (!p.ok) return p.res;
  const { id, action } = p.data;
  if (action === "check") {
    if (!(await rateLimit(`store-dns:${g.s.orgId}`, 30, 600)).ok) return apiError(429, "rate_limited", "Too many checks. Try again in a few minutes.");
    const r = await verifyDomain(g.s.orgId, id);
    if (!r.ok) return fail(r.message, 404);
    await storeAudit(g.s, "domain.check", id, { owned: r.owned, pointed: r.pointed });
    return NextResponse.json(r);
  }
  const r = action === "primary" ? await setPrimary(g.s.orgId, id) : await disconnectDomain(g.s.orgId, id);
  if (!r.ok) return fail(r.message);
  await storeAudit(g.s, `domain.${action}`, id);
  return NextResponse.json(r);
}
