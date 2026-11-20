import { GoogleAdsUpload, MarketingForm, MetaConnect } from "@/components/portal/store/Marketing";
import { marketingOverview } from "@/server/store/marketing";
import { metaAppConfigured, metaConnection } from "@/server/store/meta-connect";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store marketing — Vishwaship" };

export default async function StoreMarketing({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ctx } = await requireStorePage();
  const sp = await searchParams;
  const [overview, conn] = await Promise.all([marketingOverview(ctx.org.id), metaConnection(ctx.org.id)]);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Meta & Google</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Connect your ad accounts and tracking. Results show in <a className="orange" href="/portal/store/analytics/">Analytics</a>.</p></div></div>
      {sp.ok && <div className="small mb12" role="status" style={{ background: "var(--green-soft)", color: "var(--green)", borderRadius: 10, padding: "10px 12px", maxWidth: 860 }}>{sp.ok.slice(0, 200)}</div>}
      {sp.err && <div className="err-box small mb12" role="alert" style={{ maxWidth: 860 }}>{sp.err.slice(0, 200)}</div>}
      <div style={{ display: "grid", gap: 16 }}>
        <MetaConnect conn={conn as Parameters<typeof MetaConnect>[0]["conn"]} appReady={metaAppConfigured()} />
        <MarketingForm initial={overview} />
        <GoogleAdsUpload />
      </div>
    </>
  );
}
