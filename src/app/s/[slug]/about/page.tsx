import { StoreShell } from "@/components/store/Storefront";
import { type SfParams, type SfSearch, resolveSf, sfMeta } from "../_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  return sfMeta(await resolveSf(params, searchParams), "/about/", "About us");
}

export default async function About({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page"><h1>About {sf.name}</h1><div className="sf-prose">{sf.settings.about || sf.settings.tagline || "Welcome to our store."}</div></div>
    </StoreShell>
  );
}
