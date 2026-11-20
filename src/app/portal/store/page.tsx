import { CheckCircle2, Circle, ExternalLink, Globe, Palette, ShoppingBag } from "lucide-react";
import { and, eq, sql } from "drizzle-orm";
import { ONBOARDING_STEPS } from "@/lib/store-themes";
import { StoreBasicsForm } from "@/components/portal/store/StoreBasicsForm";
import { getDb, schema } from "@/server/db/client";
import { appUrl, storePage } from "@/server/store/portal";
import { launchChecklist } from "@/server/store/service";
import "@/styles/store.css";

export const metadata = { title: "Online Store — Vishwaship" };

export default async function StoreOverview() {
  const { ctx, store } = await storePage();
  if (!store) {
    return (
      <>
        <div className="page-h"><div><h1>Create your online store</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Your own website with products, cart and Cash on Delivery — orders flow straight into Vishwaship for shipping.</p></div>
          <a className="btn btn-outline" href="/s/demo/" target="_blank" rel="noopener">View demo store</a></div>
        <ol className="stepper row wrap" style={{ gap: 14 }} aria-label="Setup steps">
          {ONBOARDING_STEPS.map((s) => <li key={s.n} className={s.n === 1 ? "cur" : ""}><span className="n">{s.n}</span>{s.title}</li>)}
        </ol>
        <StoreBasicsForm initial={{ name: ctx.org.businessName, slug: "" }} appUrl={appUrl()} exists={false} />
      </>
    );
  }
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeProducts).where(and(eq(schema.storeProducts.storeId, store.id), eq(schema.storeProducts.status, "active")));
  const done = new Set(store.stepsDone as number[]);
  const checklist = await launchChecklist(ctx.org.id);
  const url = `${appUrl()}/s/${store.slug}/`;
  const live = store.status === "live";
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{store.name}</h1>
          <p className="small" style={{ margin: "4px 0 0" }}>
            <span className={`chip ${live ? "c-active" : store.status === "suspended" ? "c-cancelled" : "c-draft"}`}>{live ? "Live" : store.status === "suspended" ? "Paused by Vishwaship" : store.status === "paused" ? "Unpublished" : "Draft — not visible to buyers"}</span>
            {" "}<a href={live ? url : `${url}?preview=1`} target="_blank" rel="noopener" className="orange">{url.replace(/^https?:\/\//, "")} <ExternalLink size={12} aria-hidden /></a>
          </p>
          {store.status === "suspended" && store.suspendedReason && <p className="small red" style={{ margin: "6px 0 0" }}>{store.suspendedReason}</p>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <a className="btn btn-outline" href={`${url}?preview=1`} target="_blank" rel="noopener">Preview</a>
          <a className="btn btn-orange" href="/portal/store/setup/7/">{live ? "Publish changes" : "Launch checklist"}</a>
        </div>
      </div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Setup progress ({done.size}/7)</h3>
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {ONBOARDING_STEPS.map((s) => (
              <li key={s.n}><a href={`/portal/store/setup/${s.n}/`} className="row" style={{ gap: 8, alignItems: "center", padding: "6px 0" }}>
                {done.has(s.n) ? <CheckCircle2 size={18} className="green" aria-label="Done" /> : <Circle size={18} className="muted" aria-label="Not done" />}
                <span style={{ fontWeight: s.n === store.onboardingStep && !done.has(s.n) ? 600 : 400 }}>{s.n}. {s.title}</span>
                {s.optional && <span className="tiny muted">optional</span>}
              </a></li>
            ))}
          </ol>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Before you publish</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {checklist.map((c) => <li key={c.key} className="row" style={{ gap: 8 }}>{c.ok ? <CheckCircle2 size={16} className="green" aria-label="Done" /> : <Circle size={16} className={c.required ? "orange" : "muted"} aria-label="To do" />}<a href={c.href}>{c.label}</a>{!c.required && <span className="tiny muted">recommended</span>}</li>)}
            </ul>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <a className="btn btn-outline" href="/portal/store/products/"><ShoppingBag size={14} aria-hidden /> Products ({n})</a>
            <a className="btn btn-outline" href="/portal/store/theme/"><Palette size={14} aria-hidden /> Theme editor</a>
            <a className="btn btn-outline" href="/portal/store/domains/"><Globe size={14} aria-hidden /> Domains</a>
          </div>
        </div>
      </div>
    </>
  );
}
