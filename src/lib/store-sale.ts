/** Sale-event pricing. Pure, so the storefront (display) and checkout (charging) always agree. */
export type SaleRule = { id: string; name: string; percentOff: number; scope: string; categoryIds: string[]; productIds: string[]; endsAt: Date; bannerText: string | null };

/** The best running sale for a product (highest % off), or null. */
export function saleFor(rules: SaleRule[], productId: string, categoryId: string | null): SaleRule | null {
  let best: SaleRule | null = null;
  for (const r of rules) {
    const hit = r.scope === "all" || (r.scope === "products" && r.productIds.includes(productId)) || (r.scope === "categories" && !!categoryId && r.categoryIds.includes(categoryId));
    if (hit && (!best || r.percentOff > best.percentOff)) best = r;
  }
  return best;
}

/** Price after a whole-percent sale, rounded to the rupee (₹999 at 20% off → ₹799). */
export function salePrice(pricePaise: number, percentOff: number) {
  const p = Math.round((pricePaise * (100 - percentOff)) / 100);
  return Math.min(pricePaise, Math.max(100, Math.round(p / 100) * 100));
}

const r = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
/** "10% off on orders above ₹999 (up to ₹200)" — the line shown under a product. */
export function couponText(c: { kind: string; value: number; minSubtotalPaise: number; maxDiscountPaise: number | null }) {
  const what = c.kind === "percent" ? `${c.value / 100}% off` : c.kind === "flat" ? `${r(c.value)} off` : "Free shipping";
  return `${what}${c.minSubtotalPaise > 0 ? ` on orders above ${r(c.minSubtotalPaise)}` : ""}${c.kind === "percent" && c.maxDiscountPaise ? ` (up to ${r(c.maxDiscountPaise)})` : ""}`;
}
