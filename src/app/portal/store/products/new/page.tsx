import { ProductForm } from "@/components/portal/store/CatalogForms";
import { listCategories } from "@/server/store/catalog";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Add product — Vishwaship" };

export default async function NewProduct() {
  const { ctx, store } = await requireStorePage();
  const cats = await listCategories(ctx.org.id);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/products/">Store products</a></p><h1>Add product</h1></div></div>
      <ProductForm storeSlug={store.slug} categories={cats.map((c) => ({ id: c.id, name: c.name }))}
        initial={{ title: "", slug: "", description: "", price: "", compare: "", categoryId: "", images: [], stock: "10", weight: "500", status: "active", featured: false, seoTitle: "", seoDescription: "", sku: "", hsn: "", taxPercent: "0", lowStockAt: "5", lengthCm: "", breadthCm: "", heightCm: "", options: [], variants: [] }} />
    </>
  );
}
