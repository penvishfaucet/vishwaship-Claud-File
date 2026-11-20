import { CartView } from "@/components/store/StoreClient";
import { StoreShell } from "@/components/store/Storefront";
import { type SfParams, type SfSearch, resolveSf, sfMeta } from "../_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const m = await sfMeta(await resolveSf(params, searchParams), "/cart/", "Cart");
  return { ...m, robots: { index: false, follow: false } };
}

export default async function Cart({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const ck = sf.settings.checkout;
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <h1>Your cart</h1>
        <CartView store={sf.slug} base={sf.base} checkout={{ codEnabled: ck.codEnabled, shippingFeePaise: ck.shippingFeePaise, freeShippingAbovePaise: ck.freeShippingAbovePaise, ready: false, demo: sf.demo }} />
      </div>
    </StoreShell>
  );
}
