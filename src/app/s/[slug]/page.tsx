import { Sections, StoreShell } from "@/components/store/Storefront";
import { type SfParams, type SfSearch, resolveSf, sfMeta } from "./_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  return sfMeta(await resolveSf(params, searchParams), "/");
}

export default async function StoreHome({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  return <StoreShell sf={sf}><Sections sf={sf} /></StoreShell>;
}
