import "server-only";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { storeByHost } from "@/server/store/domains";
import { type Storefront, loadStorefront } from "@/server/store/public";

export type SfParams = Promise<{ slug: string }>;
export type SfSearch = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Query string that keeps preview / demo-theme mode on internal links ("" for a normal buyer visit). */
export const keepQs = (sf: Storefront) => (sf.demo ? `theme=${sf.themeKey}` : sf.preview ? "preview=1" : "");

/** "~d" is the internal slug custom-domain requests are rewritten to (next.config.ts); the store comes from the Host. */
export async function resolveSf(params: SfParams, searchParams?: SfSearch, opts: { allowUnavailable?: boolean } = {}): Promise<Storefront> {
  const sf = await resolveAny(params, searchParams);
  // trial / plan over: every buyer page (custom domain or hosted link) shows the neutral "unavailable" page instead
  if (sf.unavailable && !opts.allowUnavailable) redirect(`${sf.base}/unavailable/`);
  return sf;
}

async function resolveAny(params: SfParams, searchParams?: SfSearch): Promise<Storefront> {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  if (slug === "~d" || slug === "%7Ed") {
    const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "");
    const id = host ? await storeByHost(host) : null;
    if (!id) notFound();
    const db = await getDb();
    const [s] = await db.select({ slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, id));
    const sf = s ? await loadStorefront(s.slug) : null;
    if (!sf) notFound();
    return { ...sf, base: "" };
  }
  const sf = await loadStorefront(slug, { preview: one(sp.preview) === "1", demoTheme: one(sp.theme) || undefined });
  if (!sf) notFound();
  return sf;
}

export const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");

/** Canonical origin+base: the primary verified custom domain (once SSL is active) or the hosted link. */
export async function canonicalBase(sf: Storefront) {
  if (sf.demo) return `${appUrl()}/s/demo`;
  const db = await getDb();
  const [d] = await db.select({ host: schema.storeDomains.hostname }).from(schema.storeDomains)
    .where(and(eq(schema.storeDomains.storeId, sf.id), eq(schema.storeDomains.isPrimary, true), eq(schema.storeDomains.status, "verified"), eq(schema.storeDomains.sslStatus, "active")));
  return d ? `https://${d.host}` : `${appUrl()}/s/${sf.slug}`;
}

export async function sfMeta(sf: Storefront, path: string, title?: string, description?: string): Promise<Metadata> {
  const base = await canonicalBase(sf);
  const t = title ? `${title} | ${sf.name}` : sf.settings.seo.title || sf.name;
  return {
    title: t,
    description: description || sf.settings.seo.description || sf.settings.tagline || undefined,
    alternates: { canonical: `${base}${path}` },
    robots: sf.indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: t, siteName: sf.name, type: "website", url: `${base}${path}` },
  };
}
