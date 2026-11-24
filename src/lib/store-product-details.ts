import { z } from "zod";

/**
 * Online Store product details (phase 7c), shared by the product editor (client) and the storefront (server).
 * attributes = filterable facts (Finish, Material, Size, Surface, Pack size…) → shop filters + Specifications.
 * details = extra product-page sections; every field optional, empty ones are not shown.
 */
export const ProductAttribute = z.object({
  name: z.string().trim().min(1, "Name the attribute").max(30),
  value: z.string().trim().min(1, "Give the attribute a value").max(60),
});
export const ProductAttributes = z.array(ProductAttribute).max(12)
  .refine((a) => new Set(a.map((x) => x.name.toLowerCase())).size === a.length, "Each attribute name only once");
export type ProductAttribute = z.infer<typeof ProductAttribute>;

export const ProductDetails = z.object({
  /** One key benefit per line (shown as bullets near the price). */
  highlights: z.string().max(1000).default(""),
  specs: z.array(z.object({ label: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(200) })).max(20).default([]),
  usage: z.string().max(3000).default(""),
  inBox: z.string().max(1000).default(""),
  care: z.string().max(2000).default(""),
  warranty: z.string().max(1000).default(""),
});
export type ProductDetails = z.infer<typeof ProductDetails>;

export const readAttributes = (raw: unknown): ProductAttribute[] => {
  const p = ProductAttributes.safeParse(raw ?? []);
  return p.success ? p.data : [];
};
export const readDetails = (raw: unknown): ProductDetails => {
  const p = ProductDetails.safeParse(raw ?? {});
  return p.success ? p.data : ProductDetails.parse({});
};

/** Attribute name as a query key: "Pack size" → "a_pack-size". */
export const attrKey = (name: string) => `a_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)}`;

/**
 * Filters that make sense for the products on screen: attribute names used by at least 2 products with at least
 * 2 different values (so a bath-fittings category gets Finish / Material / Size, a cleaning one gets Surface / Pack size).
 */
export function facetsFor(products: Array<{ attributes: ProductAttribute[] }>, max = 6) {
  const map = new Map<string, { name: string; key: string; values: Map<string, number> }>();
  for (const p of products) for (const a of p.attributes) {
    const key = attrKey(a.name);
    const f = map.get(key) ?? { name: a.name, key, values: new Map<string, number>() };
    f.values.set(a.value, (f.values.get(a.value) ?? 0) + 1);
    map.set(key, f);
  }
  return [...map.values()]
    .filter((f) => f.values.size >= 2 && [...f.values.values()].reduce((s, x) => s + x, 0) >= 2)
    .sort((a, b) => [...b.values.values()].reduce((s, x) => s + x, 0) - [...a.values.values()].reduce((s, x) => s + x, 0))
    .slice(0, max)
    .map((f) => ({ name: f.name, key: f.key, values: [...f.values.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, count: n })).slice(0, 30) }));
}
