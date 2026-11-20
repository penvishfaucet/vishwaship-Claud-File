import { CouponManager } from "@/components/portal/store/StoreOps";
import { listCoupons } from "@/server/store/catalog-io";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store coupons — Vishwaship" };

export default async function StoreCoupons() {
  const { ctx } = await requireStorePage();
  const list = await listCoupons(ctx.org.id);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Coupons</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Discount codes buyers enter at checkout. Every coupon is checked again on the server when the order is placed.</p></div></div>
      <CouponManager coupons={list.map((c) => ({ ...c, startsAt: c.startsAt?.toISOString() ?? null, endsAt: c.endsAt?.toISOString() ?? null }))} />
    </>
  );
}
