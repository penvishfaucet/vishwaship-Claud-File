import { CartView } from "@/components/store/StoreClient";
import { StoreShell } from "@/components/store/Storefront";
import { cartCheckoutInfo, recData } from "@/server/store/public";
import { type SfParams, type SfSearch, resolveSf, sfMeta } from "../_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const m = await sfMeta(await resolveSf(params, searchParams), "/cart/", "Cart");
  return { ...m, robots: { index: false, follow: false } };
}

export default async function Cart({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <h1>Your cart</h1>
        <CartView store={sf.slug} base={sf.base} checkout={cartCheckoutInfo(sf)} data={recData(sf)} />
      </div>
    </StoreShell>
  );
}
