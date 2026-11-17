import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { apiError, parseJson } from "@/server/http";
import { getOrCreateTrackingPage } from "@/server/tracking/pages";
import { TrackingPageSettings } from "@/lib/tracking-page";

async function guard() {
  const s = await apiCustomer();
  if (!s) return { err: apiError(401, "unauthorized", "Please log in") };
  if (!(await hasFeature(s.orgId, "branded_tracking"))) return { err: apiError(403, "forbidden", "Branded tracking is not included in your plan") };
  return { s };
}

/** Save draft (does not change the live page). */
export async function PUT(req: Request) {
  const g = await guard(); if (g.err) return g.err; const s = g.s!;
  const p = await parseJson(req, TrackingPageSettings);
  if (!p.ok) return p.res;
  await getOrCreateTrackingPage(s.orgId);
  const db = await getDb();
  await db.update(schema.trackingPages).set({ draft: p.data, updatedAt: new Date() }).where(eq(schema.trackingPages.orgId, s.orgId));
  return NextResponse.json({ ok: true });
}

/** Publish (draft → live) or unpublish. */
export async function POST(req: Request) {
  const g = await guard(); if (g.err) return g.err; const s = g.s!;
  const p = await parseJson(req, z.object({ action: z.enum(["publish", "unpublish"]) }));
  if (!p.ok) return p.res;
  const page = await getOrCreateTrackingPage(s.orgId);
  const db = await getDb();
  if (p.data.action === "publish") {
    if (page.disabledByAdmin) return apiError(403, "forbidden", "Your tracking page was paused by Vishwaship. Contact support.");
    const draft = TrackingPageSettings.safeParse(page.draft);
    if (!draft.success) return apiError(422, "validation_error", "Save a valid draft before publishing");
    await db.update(schema.trackingPages).set({ published: draft.data, isPublished: true, publishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.trackingPages.orgId, s.orgId));
  } else {
    await db.update(schema.trackingPages).set({ isPublished: false, updatedAt: new Date() }).where(eq(schema.trackingPages.orgId, s.orgId));
  }
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: `tracking_page.${p.data.action}`, targetType: "tracking_page", targetId: s.orgId });
  return NextResponse.json({ ok: true, slug: page.slug });
}
