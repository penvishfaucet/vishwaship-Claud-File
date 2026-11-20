import { CheckCircle2, Circle } from "lucide-react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ONBOARDING_STEPS, readSettings, readTheme, rupees } from "@/lib/store-themes";
import { StoreBasicsForm } from "@/components/portal/store/StoreBasicsForm";
import { ThemeEditor } from "@/components/portal/store/ThemeEditor";
import { CheckoutStep, PublishButton, StepNext } from "@/components/portal/store/SettingsForms";
import { getDb, schema } from "@/server/db/client";
import { appUrl, requireStorePage } from "@/server/store/portal";
import { launchChecklist } from "@/server/store/service";
import { listDomains } from "@/server/store/domains";
import "@/styles/store.css";

export const metadata = { title: "Store setup — Vishwaship" };

export default async function SetupStep({ params }: { params: Promise<{ step: string }> }) {
  const n = Number((await params).step);
  const meta = ONBOARDING_STEPS.find((s) => s.n === n);
  if (!meta) notFound();
  const { ctx, store } = await requireStorePage();
  const done = new Set(store.stepsDone as number[]);
  const url = `${appUrl()}/s/${store.slug}/`;

  let body: React.ReactNode = null;
  if (n === 1) body = <StoreBasicsForm initial={{ name: store.name, slug: store.slug }} appUrl={appUrl()} exists />;
  if (n === 2) body = <ThemeEditor mode="step" slug={store.slug} initial={{ themeKey: store.themeKey, config: readTheme(store.draftTheme, store.themeKey) }} status={{ status: store.status, publishedAt: null, customDesign: store.customDesign, hasUnpublished: false }} />;
  if (n === 3) {
    const db = await getDb();
    const prods = await db.select({ id: schema.storeProducts.id, title: schema.storeProducts.title, price: schema.storeProducts.pricePaise, stock: schema.storeProducts.stock, status: schema.storeProducts.status })
      .from(schema.storeProducts).where(eq(schema.storeProducts.storeId, store.id)).limit(20);
    const active = prods.filter((p) => p.status === "active").length;
    body = (
      <div className="card" style={{ padding: 20, maxWidth: 760 }}>
        <p className="small muted" style={{ marginTop: 0 }}>Add at least one product with a photo, price, stock and packed weight. Weight is used for courier rates.</p>
        {prods.length > 0 && <table className="os-dns" style={{ marginBottom: 12 }}><tbody>{prods.map((p) => <tr key={p.id}><td><a className="orange" href={`/portal/store/products/${p.id}/`}>{p.title}</a></td><td>{rupees(p.price)}</td><td>{p.stock} in stock</td><td className="small muted">{p.status}</td></tr>)}</tbody></table>}
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn btn-outline" href="/portal/store/products/new/">+ Add product</a>
          {active > 0 && <StepNext step={3} />}
        </div>
      </div>
    );
  }
  if (n === 4) {
    const db = await getDb();
    const wh = await db.select({ id: schema.warehouses.id, label: schema.warehouses.label, city: schema.warehouses.city, pincode: schema.warehouses.pincode })
      .from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
    body = <CheckoutStep initial={readSettings(store.settings).checkout} warehouses={wh.map((w) => ({ id: w.id, label: `${w.label} — ${w.city} ${w.pincode}` }))} />;
  }
  if (n === 5) {
    const doms = await listDomains(ctx.org.id);
    body = (
      <div className="card" style={{ padding: 20, maxWidth: 760 }}>
        <p style={{ marginTop: 0 }}>Your store already has a free link: <a className="orange" href={`${url}?preview=1`} target="_blank" rel="noopener">{url.replace(/^https?:\/\//, "")}</a></p>
        <p className="small muted">Want your own domain like <b>shop.yourbrand.com</b>? Connect it now or any time later.</p>
        {doms.length > 0 && <p className="small">Connected: {doms.map((d) => `${d.hostname} (${d.status === "verified" ? "verified" : "waiting for DNS"})`).join(", ")}</p>}
        <div className="row wrap" style={{ gap: 8 }}>
          <a className="btn btn-outline" href="/portal/store/domains/">Connect a domain</a>
          <StepNext step={5} label={doms.length ? "Continue" : "Skip for now"} skip={!doms.length} />
        </div>
      </div>
    );
  }
  if (n === 6) body = (
    <div className="card" style={{ padding: 20, maxWidth: 760 }}>
      <p style={{ marginTop: 0 }}>Connect Facebook, Instagram, Meta Pixel, Google Ads and Google Analytics to track visitors and sales from your ads.</p>
      <p className="small muted">Add them on the Meta &amp; Google page — or skip and do it any time after launch.</p>
      <div className="row wrap" style={{ gap: 8 }}><a className="btn btn-outline" href="/portal/store/marketing/">Set up Meta &amp; Google</a><StepNext step={6} label={done.has(6) ? "Continue" : "Skip for now"} skip={!done.has(6)} /></div>
    </div>
  );
  if (n === 7) {
    const checklist = await launchChecklist(ctx.org.id);
    const blocking = checklist.filter((c) => c.required && !c.ok);
    body = (
      <div className="card" style={{ padding: 20, maxWidth: 760 }}>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px", display: "grid", gap: 8 }}>
          {checklist.map((c) => <li key={c.key} className="row" style={{ gap: 8 }}>{c.ok ? <CheckCircle2 size={18} className="green" aria-label="Done" /> : <Circle size={18} className={c.required ? "orange" : "muted"} aria-label="To do" />}<span>{c.label}</span>{!c.ok && <a className="orange small" href={c.href}>Fix</a>}{!c.required && <span className="tiny muted">recommended</span>}</li>)}
        </ul>
        <div className="row wrap" style={{ gap: 8, alignItems: "flex-start" }}>
          <a className="btn btn-outline btn-lg" href={`${url}?preview=1`} target="_blank" rel="noopener">Preview store</a>
          <PublishButton disabled={blocking.length > 0 || store.status === "suspended"} live={store.status === "live"} />
        </div>
        {store.status === "live" && <p className="small" style={{ marginTop: 12 }}>Your store is live at <a className="orange" href={url} target="_blank" rel="noopener">{url.replace(/^https?:\/\//, "")}</a></p>}
      </div>
    );
  }

  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a> · Step {n} of 7</p><h1>{meta.title}</h1></div></div>
      <ol className="stepper row wrap" style={{ gap: 14 }} aria-label="Setup steps">
        {ONBOARDING_STEPS.map((s) => (
          <li key={s.n} className={s.n === n ? "cur" : done.has(s.n) ? "done" : ""}>
            <a href={`/portal/store/setup/${s.n}/`} className="row" style={{ gap: 8, alignItems: "center" }} aria-current={s.n === n ? "step" : undefined}><span className="n">{done.has(s.n) && s.n !== n ? "✓" : s.n}</span>{s.title}</a>
          </li>
        ))}
      </ol>
      {body}
    </>
  );
}
