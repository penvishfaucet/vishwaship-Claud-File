import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/http";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { createStore, markStep, slugProblem, updateBasics } from "@/server/store/service";

const Basics = z.object({ name: z.string().trim().min(2, "Enter your store name").max(60), slug: z.string().trim().toLowerCase().max(40) });

/** Create the store (onboarding step 1). */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, Basics); if (!p.ok) return p.res;
  const r = await createStore(g.s.orgId, p.data);
  if (!r.ok) return fail(r.message);
  await storeAudit(g.s, "create", r.store.id, { slug: r.store.slug });
  return NextResponse.json({ ok: true, slug: r.store.slug });
}

/** Update name / URL (step 1 again), or mark an optional step done/skipped. */
export async function PATCH(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.union([Basics, z.object({ step: z.number().int().min(1).max(7) })])); if (!p.ok) return p.res;
  if ("step" in p.data) { await markStep(g.s.orgId, p.data.step); return NextResponse.json({ ok: true }); }
  const r = await updateBasics(g.s.orgId, p.data);
  if (!r.ok) return fail(r.message);
  await storeAudit(g.s, "basics", undefined, { slug: p.data.slug });
  return NextResponse.json({ ok: true });
}

/** Live store-URL availability check while typing. */
export async function GET(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const slug = (new URL(req.url).searchParams.get("slug") ?? "").toLowerCase().slice(0, 40);
  const { storeForOrg } = await import("@/server/store/service");
  const mine = await storeForOrg(g.s.orgId);
  const problem = mine?.slug === slug ? null : await slugProblem(slug, mine?.id);
  return NextResponse.json({ ok: !problem, message: problem });
}
