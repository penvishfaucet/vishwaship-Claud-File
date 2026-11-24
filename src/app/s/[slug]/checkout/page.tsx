import { ORDERS_PAUSED_TEXT } from "@/lib/store-plan";
import { Checkout } from "@/components/store/Checkout";
import { StoreShell } from "@/components/store/Storefront";
import { type SfParams, type SfSearch, resolveSf, sfMeta } from "../_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const m = await sfMeta(await resolveSf(params, searchParams), "/checkout/", "Checkout");
  return { ...m, robots: { index: false, follow: false } };
}

export default async function CheckoutPage({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const open = !sf.demo && !sf.preview && sf.status === "live" && sf.ordersOpen;
  const buyNow = (await searchParams).buy === "1";
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <h1>{buyNow ? "Buy now" : "Checkout"}</h1>
        {buyNow && open && <p className="sf-note" style={{ marginTop: -8 }}>Only the item you picked is in this order. Your cart is kept as it is. <a className="sf-link" href={`${sf.base}/checkout/`}>Check out the whole cart instead</a></p>}
        {open ? <Checkout store={sf.slug} base={sf.base} storeName={sf.name} buyNow={buyNow} /> : <p className="sf-note">{sf.demo ? "This is a demo store — orders can't be placed here." : !sf.ordersOpen ? ORDERS_PAUSED_TEXT : "Checkout works once the store is published."}</p>}
      </div>
    </StoreShell>
  );
}
