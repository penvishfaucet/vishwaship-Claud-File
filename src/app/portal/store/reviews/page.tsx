import { ReviewsManager } from "@/components/portal/store/Promo";
import { requireStorePage } from "@/server/store/portal";
import { storeReviewsForOrg } from "@/server/store/reviews";
import "@/styles/store.css";

export const metadata = { title: "Product reviews — Vishwaship" };

export default async function StoreReviews({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { ctx, store } = await requireStorePage();
  const sp = await searchParams;
  const rows = await storeReviewsForOrg(ctx.org.id, sp.status);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Product reviews</h1>
        <p className="small muted" style={{ margin: "4px 0 0", maxWidth: 820 }}>Reviews go live as soon as a buyer posts them. Hide or delete any that are spam or abusive. &quot;Verified buyer&quot; means the mobile matched an order of that product in your store.</p></div>
        <nav className="tabs" aria-label="Filter">{[["", "All"], ["published", "Live"], ["hidden", "Hidden"]].map(([k, l]) => <a key={k} className={(sp.status ?? "") === k ? "on" : ""} href={k ? `?status=${k}` : "?"}>{l}</a>)}</nav>
      </div>
      <ReviewsManager storeBase={`/s/${store.slug}`} reviews={rows.map(({ r, product, slug }) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, name: r.name, verified: r.verified, status: r.status, createdAt: r.createdAt.toISOString(), product, slug }))} />
    </>
  );
}
