import { notFound } from "next/navigation";
import { POLICY_KINDS, type PolicyKind } from "@/lib/store-themes";
import { StoreShell } from "@/components/store/Storefront";
import { type SfSearch, resolveSf, sfMeta } from "../../_sf";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string; kind: string }>;
const isKind = (k: string): k is PolicyKind => k in POLICY_KINDS;

export async function generateMetadata({ params, searchParams }: { params: P; searchParams: SfSearch }) {
  const { kind } = await params;
  if (!isKind(kind)) return {};
  return sfMeta(await resolveSf(params, searchParams), `/policies/${kind}/`, POLICY_KINDS[kind]);
}

export default async function Policy({ params, searchParams }: { params: P; searchParams: SfSearch }) {
  const { kind } = await params;
  if (!isKind(kind)) notFound();
  const sf = await resolveSf(params, searchParams);
  const body = sf.settings.policies[kind];
  if (!body) notFound();
  return <StoreShell sf={sf}><div className="sf-wrap sf-page"><h1>{POLICY_KINDS[kind]}</h1><div className="sf-prose">{body}</div></div></StoreShell>;
}
