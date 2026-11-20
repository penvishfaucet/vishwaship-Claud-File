/** Storefront view models (plain data, safe to pass to client components). */
export type SfCategory = { id: string; name: string; slug: string };
export type SfProduct = {
  id: string; title: string; slug: string; description: string;
  pricePaise: number; comparePaise: number | null; images: string[];
  inStock: boolean; featured: boolean; categorySlug: string | null;
  seo: { title?: string; description?: string };
};
