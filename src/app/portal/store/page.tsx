import { CheckCircle2, Circle, ExternalLink, Globe, Palette, ShoppingBag } from "lucide-react";
import { and, eq, sql } from "drizzle-orm";
import { planState } from "@/lib/store-plan";
import { ONBOARDING_STEPS } from "@/lib/store-themes";
import { StoreBasicsForm } from "@/components/portal/store/StoreBasicsForm";
import { getDb, schema } from "@/server/db/client";
import { appUrl, storePage } from "@/server/store/portal";
import { launchChecklist } from "@/server/store/service";
import { tabCounts } from "@/server/store/orders";
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
  const plan = planState(store);
  const db0 = await getDb();
  const counts = await tabCounts(ctx.org.id);
  const [{ low }] = await db0.select({ low: sql<number>`count(*)::int` }).from(schema.storeProducts).where(and(eq(schema.storeProducts.storeId, store.id), eq(schema.storeProducts.status, "active"), sql`${schema.storeProducts.stock} <= ${schema.storeProducts.lowStockAt}`));
  const kpis = [
    { k: "pending", label: "Waiting for acceptance", n: counts.pending ?? 0, href: "/portal/store/orders/?tab=pending", hot: (counts.pending ?? 0) > 0 },
    { k: "to_pack", label: "To pack", n: counts.to_pack ?? 0, href: "/portal/store/dispatch/?view=all", hot: false },
    { k: "ready", label: "Ready to ship", n: counts.ready ?? 0, href: "/portal/store/orders/?tab=ready", hot: false },
    { k: "transit", label: "In transit", n: counts.transit ?? 0, href: "/portal/store/orders/?tab=transit", hot: false },
    { k: "rto", label: "RTO", n: counts.rto ?? 0, href: "/portal/store/orders/?tab=rto", hot: (counts.rto ?? 0) > 0 },
    { k: "low", label: "Low on stock", n: low, href: "/portal/store/inventory/?view=low", hot: low > 0 },
  ];
  const [{ pendingAds }] = await db0.select({ pendingAds: sql<number>`count(*)::int` }).from(schema.storeAdChanges).where(and(eq(schema.storeAdChanges.storeId, store.id), eq(schema.storeAdChanges.status, "pending")));
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{store.name}</h1>
          <p className="small" style={{ margin: "4px 0 0" }}>
            <span className={`chip ${live && plan.state !== "expired" ? "c-active" : store.status === "suspended" || plan.state === "expired" ? "c-cancelled" : "c-draft"}`}>{live ? (plan.state === "expired" ? "Hidden from buyers: plan ended" : "Live") : store.status === "suspended" ? "Paused by Vishwaship" : store.status === "paused" ? "Unpublished" : "Draft — not visible to buyers"}</span>
            {" "}<a href={live ? url : `${url}?preview=1`} target="_blank" rel="noopener" className="orange">{url.replace(/^https?:\/\//, "")} <ExternalLink size={12} aria-hidden /></a>
          </p>
          {store.status === "suspended" && store.suspendedReason && <p className="small red" style={{ margin: "6px 0 0" }}>{store.suspendedReason}</p>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <a className="btn btn-outline" href={`${url}?preview=1`} target="_blank" rel="noopener">Preview</a>
          <a className="btn btn-orange" href="/portal/store/setup/7/">{live ? "Publish changes" : "Launch checklist"}</a>
        </div>
      </div>
      {plan.state === "expired" && <div className="err-box small mb12" role="alert"><b>Your store is unavailable to buyers.</b> Your {store.paidUntil ? "plan" : "free trial"} has ended, so buyers see a &ldquo;store unavailable&rdquo; page and cannot order. Everything here keeps working. <a className="orange" href="/portal/store/plan/">Renew</a> to reopen the same store at once.</div>}
      {plan.state === "active" && plan.until && plan.daysLeft <= 7 && <p className="note small mb12"><b>Plan ends on {plan.until.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}</b> ({plan.daysLeft} day{plan.daysLeft === 1 ? "" : "s"} left). The store stays open until then. <a className="orange" href="/portal/store/plan/">Renew now</a>: the new period starts when the current one ends.</p>}
      {plan.state === "trial" && plan.until && <p className="note small mb12">Free trial: <b>{plan.daysLeft} {plan.daysLeft === 1 ? "day" : "days"} left</b>. <a className="orange" href="/portal/store/plan/">See plans</a></p>}
      <nav className="so-kpis" aria-label="Orders at a glance">
        {kpis.map((c) => <a key={c.k} className={`card so-kpi${c.hot ? " hot" : ""}`} href={c.href}><b>{c.n}</b><span>{c.label}</span></a>)}
      </nav>
      {pendingAds > 0 && <p className="note small mb12"><b>{pendingAds} ad {pendingAds === 1 ? "change needs" : "changes need"} your approval.</b> <a className="orange" href="/portal/store/managed-ads/">Review in Managed Meta Ads</a></p>}
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
