import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { readSession } from "@/server/auth/session";
import { type StoreSettings, type ThemeConfig, defaultTheme, readSettings, readTheme, themeByKey } from "@/lib/store-themes";
import type { SfCategory, SfProduct } from "@/components/store/types";
import { planState } from "@/lib/store-plan";
import { couponText, saleFor, salePrice } from "@/lib/store-sale";
import { activeSales } from "./sales";
import { publicTags } from "./marketing";
import { onlineMethods } from "./checkout";

/**
 * Buyer-facing store lookup. Only live stores are public. The owner (customer session of the same org)
 * can open the draft with ?preview=1, and the theme editor iframe uses that. `demo` is a built-in sample store.
 */

export type Storefront = {
  id: string; name: string; slug: string; status: string;
  settings: StoreSettings; theme: ThemeConfig; themeKey: string;
  categories: SfCategory[]; products: SfProduct[];
  base: string; preview: boolean; demo: boolean; indexable: boolean;
  /** False when the trial ended and no plan is running (no new orders). */
  ordersOpen: boolean;
  /** Trial / plan over: buyers see a neutral "store unavailable" page instead of the store (the owner's preview still works). */
  unavailable: boolean;
  /** Biggest running sale, for the top bar countdown. */
  sale: { name: string; text: string; endsAt: string } | null;
  /** Coupons the merchant shows as offers on product pages. */
  offers: Array<{ code: string; text: string }>;
  /** Online payment (a verified gateway) is available at checkout. */
  onlinePay: boolean;
  /** Browser tag ids (never secrets); empty on preview and demo. */
  tags: { metaPixelId: string | null; ga4Id: string | null; gadsId: string | null; gadsLabel: string | null; codMilestone: string };
};

const NO_TAGS = { metaPixelId: null, ga4Id: null, gadsId: null, gadsLabel: null, codMilestone: "confirmed" };
const mediaUrl = (ref: string) => (ref.startsWith("sm_") ? `/api/store-media/${ref}/` : ref);

export const loadStorefront = cache(async (slug: string, opts: { preview?: boolean; demoTheme?: string } = {}): Promise<Storefront | null> => {
  if (slug === "demo") return demoStore(opts.demoTheme);
  const db = await getDb();
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.slug, slug));
  if (!s) return null;
  let preview = false;
  if (opts.preview) {
    const sess = await readSession("customer");
    preview = !!sess && sess.orgId === s.orgId;
  }
  if (!preview && s.status !== "live") return null;
  const theme = preview ? readTheme(s.draftTheme, s.themeKey) : readTheme(s.publishedTheme, s.themeKey);
  const cats = await db.select().from(schema.storeCategories).where(eq(schema.storeCategories.storeId, s.id)).orderBy(asc(schema.storeCategories.sort));
  const prods = await db.select().from(schema.storeProducts)
    .where(and(eq(schema.storeProducts.storeId, s.id), eq(schema.storeProducts.status, "active")))
    .orderBy(desc(schema.storeProducts.featured), desc(schema.storeProducts.createdAt)).limit(2000);
  const catSlug = new Map(cats.map((c) => [c.id, c.slug]));
  const withOptions = prods.filter((p) => (p.options as string[]).length > 0).map((p) => p.id);
  const vars = withOptions.length
    ? await db.select().from(schema.storeProductVariants).where(and(inArray(schema.storeProductVariants.productId, withOptions), eq(schema.storeProductVariants.archived, false))).orderBy(asc(schema.storeProductVariants.sort))
    : [];
  const [sales, ratings, offerRows] = await Promise.all([
    activeSales(s.id, db),
    db.select({ productId: schema.storeReviews.productId, avg: sql<number>`avg(${schema.storeReviews.rating})::float`, n: sql<number>`count(*)::int` })
      .from(schema.storeReviews).where(and(eq(schema.storeReviews.storeId, s.id), eq(schema.storeReviews.status, "published"))).groupBy(schema.storeReviews.productId),
    db.select().from(schema.storeCoupons).where(and(eq(schema.storeCoupons.storeId, s.id), eq(schema.storeCoupons.active, true), eq(schema.storeCoupons.showOnStore, true))),
  ]);
  const now = Date.now();
  const offers = offerRows.filter((c) => (!c.startsAt || c.startsAt.getTime() <= now) && (!c.endsAt || c.endsAt.getTime() > now) && (c.maxUses === null || c.used < c.maxUses))
    .slice(0, 5).map((c) => ({ code: c.code, text: couponText(c) }));
  const rate = new Map(ratings.map((r) => [r.productId, { avg: Math.round(r.avg * 10) / 10, count: r.n }]));
  const { sold, together } = await salesSignals(s.id);
  const activeIds = new Set(prods.map((p) => p.id));
  const salePair = (price: number, compare: number | null, pct: number | null) =>
    pct ? { pricePaise: salePrice(price, pct), comparePaise: Math.max(compare ?? 0, price) } : { pricePaise: price, comparePaise: compare };
  const banner = [...sales].sort((a, b) => b.percentOff - a.percentOff)[0] ?? null;
  return {
    id: s.id, name: s.name, slug: s.slug, status: s.status, settings: readSettings(s.settings),
    theme: { ...theme, logo: theme.logo }, themeKey: s.themeKey,
    categories: cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    products: prods.map((p) => {
      const options = p.options as string[];
      const pv = options.length ? vars.filter((v) => v.productId === p.id) : [];
      const sale = saleFor(sales, p.id, p.categoryId);
      const pct = sale?.percentOff ?? null;
      const variants = pv.map((v) => ({ id: v.id, title: v.title, values: v.optionValues as string[], ...salePair(v.pricePaise, v.comparePaise, pct), inStock: v.stock > 0 }));
      const cheapest = variants.length ? variants.reduce((m, v) => (v.pricePaise < m.pricePaise ? v : m)) : null;
      return {
        id: p.id, title: p.title, slug: p.slug, description: p.description ?? "",
        ...(cheapest ? { pricePaise: cheapest.pricePaise, comparePaise: cheapest.comparePaise } : salePair(p.pricePaise, p.comparePaise, pct)),
        images: (p.images as string[]).map(mediaUrl), inStock: options.length ? pv.some((v) => v.stock > 0) : p.stock > 0, featured: p.featured,
        categorySlug: p.categoryId ? catSlug.get(p.categoryId) ?? null : null,
        seo: (p.seo as { title?: string; description?: string }) ?? {},
        options, variants, sale: sale ? { name: sale.name, percentOff: sale.percentOff } : null, rating: rate.get(p.id) ?? null,
        sold: sold.get(p.id) ?? 0, createdAt: p.createdAt.toISOString(),
        addons: [...new Set([...((p.addonIds as string[] | null) ?? []), ...(together.get(p.id) ?? [])])].filter((x) => x !== p.id && activeIds.has(x)).slice(0, 6),
      };
    }),
    sale: banner ? { name: banner.name, text: banner.bannerText || `${banner.name}: ${banner.percentOff}% off`, endsAt: banner.endsAt.toISOString() } : null,
    offers,
    base: `/s/${s.slug}`, preview, demo: false, indexable: !preview && s.status === "live" && planState(s).state !== "expired", ordersOpen: planState(s).ordersOpen,
    unavailable: !preview && planState(s).state === "expired", onlinePay: preview ? false : (await onlineMethods(s.orgId)).length > 0,
    tags: preview ? NO_TAGS : await publicTags(s.orgId),
  };
});

/**
 * Best-seller counts (units, last 90 days) and "bought together" pairs (last 180 days) from placed store orders.
 * Cancelled orders and refunded / refund-due payments are left out.
 */
async function salesSignals(storeId: string) {
  const db = await getDb();
  const since = new Date(Date.now() - 180 * 86400_000), recent = Date.now() - 90 * 86400_000;
  const rows = await db.select({ lines: schema.storeOrders.lines, at: schema.storeOrders.placedAt }).from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.storeId, storeId), eq(schema.storeOrders.status, "placed"), gte(schema.storeOrders.placedAt, since),
      notInArray(schema.storeOrders.paymentStatus, ["refunded", "refund_due"])))
    .orderBy(desc(schema.storeOrders.placedAt)).limit(5000);
  const sold = new Map<string, number>();
  const pairs = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const lines = ((r.lines as Array<{ productId?: string; qty?: number }>) ?? []).filter((l) => typeof l.productId === "string");
    if (r.at && r.at.getTime() >= recent) for (const l of lines) sold.set(l.productId!, (sold.get(l.productId!) ?? 0) + Math.max(0, Number(l.qty) || 0));
    const ids = [...new Set(lines.map((l) => l.productId!))];
    for (const a of ids) for (const b of ids) if (a !== b) { const m = pairs.get(a) ?? new Map<string, number>(); m.set(b, (m.get(b) ?? 0) + 1); pairs.set(a, m); }
  }
  // "bought together" only when it happened in at least 2 orders (one order is a coincidence)
  const together = new Map([...pairs].map(([a, m]) => [a, [...m].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).map(([b]) => b).slice(0, 4)]));
  return { sold, together };
}

/** Best sellers: units sold first; stores with little sales data fall back to the merchant's Featured picks, then newest. */
export function bestSellers(products: SfProduct[], n: number, categorySlug?: string | null) {
  const pool = products.filter((p) => p.inStock && (!categorySlug || p.categorySlug === categorySlug));
  return [...pool].sort((a, b) => b.sold - a.sold || Number(b.featured) - Number(a.featured) || b.createdAt.localeCompare(a.createdAt)).slice(0, n);
}

/** What the cart drawer / cart page need for "Complete your purchase" and empty-cart Best sellers. */
export function recData(sf: Storefront) {
  const best = bestSellers(sf.products, 8).map((p) => p.id);
  const recs = Object.fromEntries(sf.products.filter((p) => p.addons.length).map((p) => [p.id, p.addons]));
  const ids = new Set([...best, ...Object.values(recs).flat()]);
  return { recs, best, pool: sf.products.filter((p) => ids.has(p.id)).map(mini) };
}

/** Checkout facts the cart drawer / cart page show before the buyer reaches checkout. */
export function cartCheckoutInfo(sf: Storefront) {
  const ck = sf.settings.checkout;
  return { codEnabled: ck.codEnabled, shippingFeePaise: ck.shippingFeePaise, freeShippingAbovePaise: ck.freeShippingAbovePaise, ready: !sf.demo && !sf.preview && sf.status === "live" && sf.ordersOpen, demo: sf.demo };
}

/** Card data for client components (cart drawer, add-on rows). */
export const mini = (p: SfProduct) => ({ id: p.id, slug: p.slug, title: p.title, image: p.images[0] ?? null, pricePaise: p.pricePaise, comparePaise: p.comparePaise, hasOptions: p.options.length > 0, inStock: p.inStock });

export const logoUrl = (sf: Storefront) => (sf.theme.logo ? mediaUrl(sf.theme.logo) : null);
export const sectionImage = (ref: string | undefined) => (ref ? mediaUrl(ref) : null);

// ---------- built-in demo store ----------
function demoStore(themeKey?: string): Storefront {
  const key = themeByKey(themeKey ?? "bazaar").key;
  const theme = defaultTheme(key);
  const cats: SfCategory[] = [
    { id: "c1", name: "Kurtas", slug: "kurtas" }, { id: "c2", name: "Home decor", slug: "home-decor" }, { id: "c3", name: "Accessories", slug: "accessories" },
  ];
  const P = (id: string, title: string, price: number, compare: number | null, cat: string, img: string, desc: string, featured = true): SfProduct => ({
    id, title, slug: id, description: desc, pricePaise: price * 100, comparePaise: compare ? compare * 100 : null,
    images: [`/store-demo/${img}.svg`], inStock: true, featured, categorySlug: cat, seo: {}, options: [], variants: [],
    sale: compare ? { name: "Festive Sale", percentOff: Math.round((1 - price / compare) * 100) } : null, rating: null,
    sold: featured ? 10 : 2, addons: [], createdAt: new Date(0).toISOString(),
  });
  const products = [
    P("indigo-cotton-kurta", "Indigo Cotton Kurta", 1299, 1799, "kurtas", "kurta-indigo", "Breathable hand-block printed cotton kurta. Regular fit."),
    P("mustard-festive-kurta", "Mustard Festive Kurta", 1599, null, "kurtas", "kurta-mustard", "Soft rayon kurta with subtle embroidery at the neckline."),
    P("terracotta-planter", "Terracotta Planter (Set of 2)", 649, 899, "home-decor", "planter", "Hand-thrown terracotta planters with drainage holes."),
    P("brass-diya", "Brass Diya", 499, null, "home-decor", "diya", "Polished brass diya, perfect for festivals and gifting."),
    P("jute-tote", "Printed Jute Tote", 399, 549, "accessories", "tote", "Sturdy jute tote with cotton handles."),
    P("silver-jhumka", "Oxidised Silver Jhumka", 349, null, "accessories", "jhumka", "Lightweight oxidised jhumkas for everyday wear."),
    P("cushion-cover", "Block Print Cushion Cover", 449, null, "home-decor", "cushion", "16x16 inch cotton cushion cover, hand block printed.", false),
    P("cotton-stole", "Handloom Cotton Stole", 699, 999, "accessories", "stole", "Soft handloom stole in natural dyes.", false),
  ];
  // demo add-ons: kurtas → stole and jhumka; planter → diya
  for (const p of products) p.addons = p.categorySlug === "kurtas" ? ["cotton-stole", "silver-jhumka"] : p.id === "terracotta-planter" ? ["brass-diya"] : [];
  // kurtas show how size variants look
  for (const p of products.filter((x) => x.categorySlug === "kurtas")) {
    p.options = ["Size"];
    p.variants = ["S", "M", "L", "XL"].map((sz, i) => ({ id: `${p.id}-${sz.toLowerCase()}`, title: sz, values: [sz], pricePaise: p.pricePaise + (sz === "XL" ? 10_000 : 0), comparePaise: p.comparePaise, inStock: i !== 0 }));
  }
  const settings = readSettings({
    tagline: "Handmade goods from Indian artisans",
    about: "Vishwa Crafts is a sample store that shows what your online store can look like. Products, prices and reviews here are examples.",
    contact: { email: "hello@example.com", phone: "", whatsapp: "", address: "Jaipur, Rajasthan" },
    policies: {
      shipping: "Orders are dispatched within 2 working days and delivered in 3-7 days across India.",
      refund: "Returns are accepted within 7 days of delivery for unused items in original packing.",
      privacy: "We use your details only to process and deliver your order.",
      terms: "This is a demo store. No real orders are placed here.",
    },
    seo: { title: "Vishwa Crafts — demo store", description: "Sample online store built on Vishwaship." },
  });
  return {
    id: "demo", name: "Vishwa Crafts", slug: "demo", status: "live", settings, theme, themeKey: key,
    categories: cats, products, base: "/s/demo", preview: false, demo: true, indexable: false, tags: NO_TAGS, ordersOpen: true, unavailable: false, onlinePay: true,
    sale: { name: "Festive Sale", text: "Festive Sale is on: up to 30% off", endsAt: new Date(Date.now() + 2 * 86400_000 + 5 * 3600_000).toISOString() },
    offers: [{ code: "WELCOME10", text: "10% off on orders above ₹999 (up to ₹200)" }, { code: "FREESHIP", text: "Free shipping" }],
  };
}
