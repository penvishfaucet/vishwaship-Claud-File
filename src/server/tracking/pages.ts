import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
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

/** Branding visible to buyers: only when published, not disabled by admin, and the module is still enabled. */
export async function liveBranding(orgId: string): Promise<TrackingPageSettings | null> {
  const db = await getDb();
  const [p] = await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.orgId, orgId));
  if (!p || !p.isPublished || p.disabledByAdmin || !p.published) return null;
  if (!(await hasFeature(orgId, "branded_tracking"))) return null;
  return p.published as TrackingPageSettings;
}
