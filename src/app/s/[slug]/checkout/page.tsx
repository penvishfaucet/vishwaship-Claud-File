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
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <h1>Checkout</h1>
        {open ? <Checkout store={sf.slug} base={sf.base} storeName={sf.name} /> : <p className="sf-note">{sf.demo ? "This is a demo store — orders can't be placed here." : !sf.ordersOpen ? ORDERS_PAUSED_TEXT : "Checkout works once the store is published."}</p>}
      </div>
    </StoreShell>
  );
}
