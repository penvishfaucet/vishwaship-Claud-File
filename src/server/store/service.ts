import "server-only";
import { and, asc, desc, eq, inArray, max, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";
import { newId } from "@/server/util/ids";
import {
  ONBOARDING_STEPS, RESERVED_SLUGS, SLUG_RE, type StoreSettings, type ThemeConfig,
  defaultTheme, readSettings, readTheme, themeByKey,
} from "@/lib/store-themes";

/**
 * Online store service. Every merchant-side function takes orgId from the session (portalContext / apiCustomer)
 * and filters by it — a store id from the request is never trusted on its own.
 */

export type StoreRow = typeof schema.stores.$inferSelect;

export async function storeForOrg(orgId: string): Promise<StoreRow | null> {
  const db = await getDb();
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.orgId, orgId));
  return s ?? null;
}

export async function slugProblem(slug: string, exceptStoreId?: string): Promise<string | null> {
  if (!SLUG_RE.test(slug)) return "Use 3-40 lowercase letters, numbers or hyphens (not at the start or end)";
  if (RESERVED_SLUGS.has(slug)) return "This store URL is reserved. Please choose another.";
  const db = await getDb();
  const [hit] = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(exceptStoreId ? and(eq(schema.stores.slug, slug), ne(schema.stores.id, exceptStoreId)) : eq(schema.stores.slug, slug));
  return hit ? "This store URL is already taken" : null;
}

export async function createStore(orgId: string, a: { name: string; slug: string }): Promise<{ ok: true; store: StoreRow } | { ok: false; message: string }> {
  if (await storeForOrg(orgId)) return { ok: false, message: "You already have a store" };
  const problem = await slugProblem(a.slug);
  if (problem) return { ok: false, message: problem };
  const db = await getDb();
  const id = newId("st");
  try {
    const [s] = await db.insert(schema.stores).values({
      id, orgId, name: a.name, slug: a.slug, themeKey: "bazaar", draftTheme: defaultTheme("bazaar"),
      settings: readSettings({}), stepsDone: [1], onboardingStep: 2, trialEndsAt: new Date(Date.now() + (await storeBillingSetting()).trialDays * 86400_000),
    }).returning();
    return { ok: true, store: s };
  } catch {
    return { ok: false, message: "This store URL is already taken" };
  }
}

export async function updateBasics(orgId: string, a: { name: string; slug: string }) {
  const s = await storeForOrg(orgId);
  if (!s) return { ok: false as const, message: "Create your store first" };
  if (a.slug !== s.slug) {
    const problem = await slugProblem(a.slug, s.id);
    if (problem) return { ok: false as const, message: problem };
  }
  const db = await getDb();
  await db.update(schema.stores).set({ name: a.name, slug: a.slug, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  await markStep(orgId, 1);
  return { ok: true as const };
}

export async function markStep(orgId: string, step: number) {
  const s = await storeForOrg(orgId);
  if (!s) return;
  const done = new Set<number>((s.stepsDone as number[]) ?? []);
  done.add(step);
  const next = Math.min(7, Math.max(s.onboardingStep, step + 1));
  const db = await getDb();
  await db.update(schema.stores).set({ stepsDone: [...done].sort((x, y) => x - y), onboardingStep: next, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
}

export async function saveDraftTheme(orgId: string, themeKey: string, config: ThemeConfig) {
  const s = await storeForOrg(orgId);
  if (!s) return { ok: false as const, message: "Create your store first" };
  if (s.customDesign && themeKey !== s.themeKey) return { ok: false as const, message: "Your store uses a custom design set up by Vishwaship. Contact support to change the theme." };
  if (themeKey !== s.themeKey && (await storeBillingSetting()).disabledThemes.includes(themeKey)) return { ok: false as const, message: "This theme is not available right now. Please pick another." };
  if (config.logo) await assertMediaOwned(s.id, [config.logo]);
  const imgs = config.sections.map((x) => x.settings.image).filter((v): v is string => !!v);
  if (imgs.length) await assertMediaOwned(s.id, imgs);
  const db = await getDb();
  await db.update(schema.stores).set({ themeKey: themeByKey(themeKey).key, draftTheme: config, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  return { ok: true as const };
}

export async function saveSettings(orgId: string, patch: Partial<StoreSettings>, step?: number) {
  const s = await storeForOrg(orgId);
  if (!s) return { ok: false as const, message: "Create your store first" };
  const next = readSettings({ ...readSettings(s.settings), ...patch });
  if (next.checkout.warehouseId) {
    const db = await getDb();
    const [w] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, next.checkout.warehouseId), eq(schema.warehouses.orgId, orgId)));
    if (!w) return { ok: false as const, message: "Pickup warehouse not found" };
  }
  const db = await getDb();
  await db.update(schema.stores).set({ settings: next, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  if (step) await markStep(orgId, step);
  return { ok: true as const };
}

async function assertMediaOwned(storeId: string, ids: string[]) {
  const db = await getDb();
  const rows = await db.select({ id: schema.storeMedia.id }).from(schema.storeMedia)
    .where(and(eq(schema.storeMedia.storeId, storeId), inArray(schema.storeMedia.id, ids)));
  if (rows.length !== new Set(ids).size) throw new Error("Image not found in your store");
}

// ---------- launch checklist & publish ----------
export type ChecklistItem = { key: string; label: string; ok: boolean; required: boolean; href: string };

export async function launchChecklist(orgId: string): Promise<ChecklistItem[]> {
  const s = await storeForOrg(orgId);
  if (!s) return [];
  const db = await getDb();
  const prods = await db.select({ id: schema.storeProducts.id }).from(schema.storeProducts)
    .where(and(eq(schema.storeProducts.storeId, s.id), eq(schema.storeProducts.status, "active"))).limit(1);
  const st = readSettings(s.settings);
  const theme = readTheme(s.draftTheme, s.themeKey);
  const policiesOk = !!(st.policies.shipping.trim() && st.policies.refund.trim() && st.policies.privacy.trim() && st.policies.terms.trim());
  return [
    { key: "basics", label: "Store name and URL", ok: true, required: true, href: "/portal/store/setup/1/" },
    { key: "logo", label: "Logo added", ok: !!theme.logo, required: false, href: "/portal/store/setup/2/" },
    { key: "products", label: "At least one active product", ok: prods.length > 0, required: true, href: "/portal/store/products/" },
    { key: "pickup", label: "Pickup warehouse selected", ok: !!st.checkout.warehouseId, required: true, href: "/portal/store/setup/4/" },
    { key: "contact", label: "Contact email or phone", ok: !!(st.contact.email || st.contact.phone), required: true, href: "/portal/store/pages/" },
    { key: "policies", label: "Shipping, refund, privacy and terms pages", ok: policiesOk, required: true, href: "/portal/store/pages/" },
    { key: "seo", label: "Search title and description", ok: !!(st.seo.title && st.seo.description), required: false, href: "/portal/store/pages/" },
  ];
}

/** Draft → live. Saves a numbered version so it can be restored later. */
export async function publishStore(orgId: string, actorUserId: string, note?: string) {
  const s = await storeForOrg(orgId);
  if (!s) return { ok: false as const, message: "Create your store first" };
  if (s.status === "suspended") return { ok: false as const, message: "Your store was paused by Vishwaship. Contact support." };
  const missing = (await launchChecklist(orgId)).filter((c) => c.required && !c.ok);
  if (missing.length) return { ok: false as const, message: `Before publishing: ${missing.map((m) => m.label.toLowerCase()).join(", ")}` };
  const config = readTheme(s.draftTheme, s.themeKey);
  const db = await getDb();
  const [{ v }] = await db.select({ v: max(schema.storeThemeVersions.version) }).from(schema.storeThemeVersions).where(eq(schema.storeThemeVersions.storeId, s.id));
  await db.insert(schema.storeThemeVersions).values({ id: newId("stv"), storeId: s.id, orgId, version: (v ?? 0) + 1, themeKey: s.themeKey, config, publishedBy: actorUserId, note: note ?? null });
  await db.update(schema.stores).set({ publishedTheme: config, status: "live", publishedAt: new Date(), updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  await markStep(orgId, 7);
  return { ok: true as const, version: (v ?? 0) + 1 };
}

export async function unpublishStore(orgId: string) {
  const s = await storeForOrg(orgId);
  if (!s) return { ok: false as const, message: "No store" };
  if (s.status === "suspended") return { ok: false as const, message: "Your store was paused by Vishwaship" };
  const db = await getDb();
  await db.update(schema.stores).set({ status: "paused", updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  return { ok: true as const };
}

export async function themeVersions(orgId: string) {
  const s = await storeForOrg(orgId);
  if (!s) return [];
  const db = await getDb();
  return db.select({ id: schema.storeThemeVersions.id, version: schema.storeThemeVersions.version, themeKey: schema.storeThemeVersions.themeKey, note: schema.storeThemeVersions.note, createdAt: schema.storeThemeVersions.createdAt })
    .from(schema.storeThemeVersions).where(eq(schema.storeThemeVersions.storeId, s.id)).orderBy(desc(schema.storeThemeVersions.version)).limit(20);
}

/** Copy a published version back into the draft (the live store changes only on the next publish). */
export async function restoreVersion(orgId: string, versionId: string) {
  const s = await storeForOrg(orgId);
  if (!s) return { ok: false as const, message: "No store" };
  const db = await getDb();
  const [v] = await db.select().from(schema.storeThemeVersions).where(and(eq(schema.storeThemeVersions.id, versionId), eq(schema.storeThemeVersions.storeId, s.id)));
  if (!v) return { ok: false as const, message: "Version not found" };
  await db.update(schema.stores).set({ draftTheme: v.config, themeKey: v.themeKey, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  return { ok: true as const, version: v.version };
}

export const stepTitle = (n: number) => ONBOARDING_STEPS.find((x) => x.n === n)?.title ?? "";

export async function storeCategories(storeId: string) {
  const db = await getDb();
  return db.select().from(schema.storeCategories).where(eq(schema.storeCategories.storeId, storeId)).orderBy(asc(schema.storeCategories.sort), asc(schema.storeCategories.name));
}

/** Admin store settings (trial length, themes switched off). Full config lives in billing.ts; read here without importing it. */
export async function storeBillingSetting(): Promise<{ trialDays: number; disabledThemes: string[] }> {
  const v = (await getSetting<{ trialDays?: number; disabledThemes?: string[] }>("store_billing", {})).value;
  return { trialDays: Number.isFinite(v.trialDays) ? Number(v.trialDays) : 15, disabledThemes: Array.isArray(v.disabledThemes) ? v.disabledThemes : [] };
}
