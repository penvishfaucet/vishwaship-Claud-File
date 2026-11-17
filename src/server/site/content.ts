import "server-only";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/server/db/client";
import { readSession } from "@/server/auth/session";
import { can } from "@/server/auth/rbac";
import { getSetting } from "@/server/quotes/service";
import { DEFAULTS, SECTION_KEYS, SECTION_SCHEMAS, mergePartners, type SectionKey, type SiteContent } from "@/lib/site-content";

/**
 * Website content lives in content_blocks under keys "site.<section>" (locale "en") as JSON text:
 * draft = what Admin is editing, published = what visitors see.
 */
const keyOf = (s: SectionKey) => `site.${s}`;

function parseSection<S extends SectionKey>(section: S, raw: string | null | undefined): SiteContent[S] {
  const base = DEFAULTS[section];
  if (!raw) return structuredClone(base);
  try {
    const merged = { ...base, ...(JSON.parse(raw) as object) };
    const r = SECTION_SCHEMAS[section].safeParse(merged);
    return (r.success ? r.data : structuredClone(base)) as SiteContent[S];
  } catch {
    return structuredClone(base);
  }
}

const loadRows = cache(async () => {
  const db = await getDb();
  const rows = await db.select().from(schema.contentBlocks).where(eq(schema.contentBlocks.locale, "en"));
  return new Map(rows.filter((r) => r.key.startsWith("site.")).map((r) => [r.key, r]));
});

/** Staff with content.write can preview drafts by adding ?preview=1. */
export async function canPreview() {
  const s = await readSession("staff");
  return !!s && can(s.role, "content.write");
}

export async function getSiteContent(opts: { preview?: boolean } = {}): Promise<SiteContent> {
  const rows = await loadRows();
  const usePreview = !!opts.preview && (await canPreview());
  const out = {} as Record<SectionKey, unknown>;
  for (const s of SECTION_KEYS) {
    const row = rows.get(keyOf(s));
    out[s] = parseSection(s, usePreview ? (row?.draft ?? row?.published) : row?.published);
  }
  const c = out as SiteContent;
  c.partners = { items: mergePartners(c.partners.items) };
  return c;
}

/** Admin editor state: draft (or published, or default) per section + whether a draft is unpublished. */
export async function getEditorState() {
  const rows = await loadRows();
  return Object.fromEntries(SECTION_KEYS.map((s) => {
    const row = rows.get(keyOf(s));
    const value = parseSection(s, row?.draft ?? row?.published);
    if (s === "partners") (value as SiteContent["partners"]).items = mergePartners((value as SiteContent["partners"]).items);
    return [s, { value, published: row?.published != null, unpublished: !!row && row.draft !== row.published, publishedAt: row?.publishedAt?.toISOString() ?? null }];
  })) as Record<SectionKey, { value: unknown; published: boolean; unpublished: boolean; publishedAt: string | null }>;
}

export async function saveSection(section: SectionKey, data: unknown, userId: string, publish: boolean) {
  const parsed = SECTION_SCHEMAS[section].safeParse(data);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const json = JSON.stringify(parsed.data);
  const db = await getDb();
  const now = new Date();
  const [row] = await db.select().from(schema.contentBlocks).where(and(eq(schema.contentBlocks.key, keyOf(section)), eq(schema.contentBlocks.locale, "en")));
  const set = { draft: json, updatedBy: userId, updatedAt: now, ...(publish ? { published: json, publishedBy: userId, publishedAt: now } : {}) };
  if (row) await db.update(schema.contentBlocks).set(set).where(and(eq(schema.contentBlocks.key, keyOf(section)), eq(schema.contentBlocks.locale, "en")));
  else await db.insert(schema.contentBlocks).values({ key: keyOf(section), locale: "en", ...set });
  return { ok: true as const };
}

/** Weight (grams) at or above which the calculator selects B2B; shared with Create Shipment. */
export async function b2bThresholdGrams() {
  return (await getSetting<number>("b2b_threshold_grams", 10_000)).value;
}
