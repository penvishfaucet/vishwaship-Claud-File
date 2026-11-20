import { DomainsManager } from "@/components/portal/store/DomainsManager";
import { MAX_DOMAINS, dnsRecords, listDomains } from "@/server/store/domains";
import { appUrl, requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store domains — Vishwaship" };

export default async function StoreDomains() {
  const { ctx, store } = await requireStorePage();
  const doms = await listDomains(ctx.org.id);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Domains</h1></div></div>
      <DomainsManager max={MAX_DOMAINS} defaultUrl={`${appUrl()}/s/${store.slug}/`}
        domains={doms.map((d) => ({
          id: d.id, hostname: d.hostname, status: d.status, sslStatus: d.sslStatus, isPrimary: d.isPrimary,
          lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null, lastCheckMessage: d.lastCheckMessage, records: dnsRecords(d),
        }))} />
    </>
  );
}
