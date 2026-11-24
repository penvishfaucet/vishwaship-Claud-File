/** Storefront view models (plain data, safe to pass to client components). */
export type SfCategory = { id: string; name: string; slug: string };
export type SfVariant = { id: string; title: string; values: string[]; pricePaise: number; comparePaise: number | null; inStock: boolean };
export type SfProduct = {
  id: string; title: string; slug: string; description: string;
  pricePaise: number; comparePaise: number | null; images: string[];
  inStock: boolean; featured: boolean; categorySlug: string | null;
  seo: { title?: string; description?: string };
  /** Option names (e.g. ["Size","Colour"]); empty when the product has no variants. */
  options: string[];
  variants: SfVariant[];
  /** Running sale on this product (prices above already include it). */
  sale: { name: string; percentOff: number } | null;
  /** Published reviews. */
  rating: { avg: number; count: number } | null;
  /** Units sold in the last 90 days (placed orders, not cancelled or refunded). Drives Best Sellers. */
  sold: number;
  /** Add-ons: merchant-chosen compatible products first, then products often bought in the same order. */
  addons: string[];
  /** ISO time the product was added (Newest sort). */
  createdAt: string;
};
/** Small product card data for the cart drawer and add-on rows (client components). */
export type SfMini = { id: string; slug: string; title: string; image: string | null; pricePaise: number; comparePaise: number | null; hasOptions: boolean; inStock: boolean };
