import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { type TrackingPageSettings, defaultTrackingSettings, slugify } from "@/lib/tracking-page";

/** Get (or create with defaults) the org's tracking page row. Slug is unique and stable once created. */
export async function getOrCreateTrackingPage(orgId: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.orgId, orgId));
  if (row) return row;
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  let slug = slugify(org.businessName);
  const [taken] = await db.select({ o: schema.trackingPages.orgId }).from(schema.trackingPages).where(eq(schema.trackingPages.slug, slug));
  if (taken) slug = `${slug}-${randomBytes(3).toString("hex")}`;
  const [created] = await db.insert(schema.trackingPages).values({ orgId, slug, draft: defaultTrackingSettings(org.businessName) }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.orgId, orgId)))[0];
}

/**
 * What a buyer sees on a shared tracking link: the seller's published branded page when they have one,
 * otherwise their business name with the account's contact mobile and email (so the buyer knows who
 * shipped the order and how to reach them), in Vishwaship colours.
 */
export async function buyerBranding(orgId: string): Promise<TrackingPageSettings | null> {
  const live = await liveBranding(orgId);
  if (live) return live;
  const db = await getDb();
  const [org] = await db.select({ name: schema.orgs.businessName }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  if (!org) return null;
  const [u] = await db.select({ mobile: schema.users.mobile, email: schema.users.email }).from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), eq(schema.users.kind, "customer"), eq(schema.users.active, true))).orderBy(asc(schema.users.createdAt)).limit(1);
  const m = (u?.mobile ?? "").replace(/\D/g, "").slice(-10);
  return { ...defaultTrackingSettings(org.name), supportPhone: m.length === 10 ? `+91 ${m.slice(0, 5)} ${m.slice(5)}` : "", supportEmail: u?.email ?? "" };
}

/** Branding visible to buyers: only when published, not disabled by admin, and the module is still enabled. */
export async function liveBranding(orgId: string): Promise<TrackingPageSettings | null> {
  const db = await getDb();
  const [p] = await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.orgId, orgId));
  if (!p || !p.isPublished || p.disabledByAdmin || !p.published) return null;
  if (!(await hasFeature(orgId, "branded_tracking"))) return null;
  return p.published as TrackingPageSettings;
}
