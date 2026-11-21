import { eq } from "drizzle-orm";
import { SalesManager } from "@/components/portal/store/Promo";
import { getDb, schema } from "@/server/db/client";
import { requireStorePage } from "@/server/store/portal";
import { listSales } from "@/server/store/sales";
import "@/styles/store.css";

export const metadata = { title: "Sale events — Vishwaship" };

export default async function StoreSales() {
  const { store } = await requireStorePage();
  const db = await getDb();
  const [sales, cats, prods] = await Promise.all([
    listSales(store.id),
    db.select({ id: schema.storeCategories.id, name: schema.storeCategories.name }).from(schema.storeCategories).where(eq(schema.storeCategories.storeId, store.id)),
    db.select({ id: schema.storeProducts.id, name: schema.storeProducts.title }).from(schema.storeProducts).where(eq(schema.storeProducts.storeId, store.id)),
  ]);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Sale events</h1>
        <p className="small muted" style={{ margin: "4px 0 0", maxWidth: 820 }}>Run a timed sale on the whole store, some categories or some products. Buyers see the sale price, a % OFF badge and a countdown bar. To show a coupon as an offer on product pages, tick &quot;Show as an offer&quot; in <a className="orange" href="/portal/store/coupons/">Coupons</a>.</p></div></div>
      <SalesManager sales={sales.map((s) => ({ id: s.id, name: s.name, percentOff: s.percentOff, scope: s.scope, categoryIds: s.categoryIds as string[], productIds: s.productIds as string[], startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), bannerText: s.bannerText, active: s.active }))}
        categories={cats} products={prods} />
    </>
  );
}
