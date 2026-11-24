import { notFound } from "next/navigation";
import { readExtras } from "@/lib/store-costs";
import { ProductForm } from "@/components/portal/store/CatalogForms";
import { getProduct, listCategories, listProducts, productVariants } from "@/server/store/catalog";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Edit product — Vishwaship" };

export default async function EditProduct({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, store } = await requireStorePage();
  const { id } = await params;
  const p = await getProduct(ctx.org.id, id);
  if (!p) notFound();
  const cats = await listCategories(ctx.org.id);
  const seo = (p.seo ?? {}) as { title?: string; description?: string };
  const variants = await productVariants(ctx.org.id, p.id);
  const catalog = (await listProducts(ctx.org.id, { limit: 2000 })).filter((x) => x.status !== "archived").map((x) => ({ id: x.id, title: x.title, sku: x.sku, status: x.status }));
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/products/">Store products</a></p><h1>{p.title}</h1></div>
        {p.status === "active" && <a className="btn btn-outline" href={`/s/${store.slug}/products/${p.slug}/?preview=1`} target="_blank" rel="noopener">View in store</a>}
      </div>
      <ProductForm id={p.id} storeSlug={store.slug} categories={cats.map((c) => ({ id: c.id, name: c.name }))} catalog={catalog}
        initial={{
          title: p.title, slug: p.slug, description: p.description ?? "", price: String(p.pricePaise / 100), compare: p.comparePaise ? String(p.comparePaise / 100) : "",
          categoryId: p.categoryId ?? "", images: p.images as string[], stock: String(p.stock), weight: String(p.weightGrams),
          status: p.status as "draft" | "active" | "archived", featured: p.featured, seoTitle: seo.title ?? "", seoDescription: seo.description ?? "",
          sku: p.sku ?? "", hsn: p.hsn ?? "", taxPercent: String(p.taxBps / 100), lowStockAt: String(p.lowStockAt),
          costs: (() => { const x = readExtras(p.costExtras); const r = (v: number) => (v ? String(v / 100) : ""); return { product: p.unitCostPaise === null ? "" : String(p.unitCostPaise / 100), packaging: r(x.packagingPaise), labour: r(x.labourPaise), other: r(x.otherPaise), overhead: r(x.overheadPaise) }; })(), lengthCm: p.lengthMm ? String(p.lengthMm / 10) : "", breadthCm: p.breadthMm ? String(p.breadthMm / 10) : "", heightCm: p.heightMm ? String(p.heightMm / 10) : "",
          addonIds: (p.addonIds as string[] | null) ?? [],
          options: p.options as string[], variants: variants.map((v) => ({ id: v.id, values: v.optionValues as string[], sku: v.sku ?? "", price: String(v.pricePaise / 100), compare: v.comparePaise ? String(v.comparePaise / 100) : "", stock: String(v.stock), weight: v.weightGrams ? String(v.weightGrams) : "" })),
        }} />
    </>
  );
}
