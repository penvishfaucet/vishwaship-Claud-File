import { rupees } from "@/lib/store-themes";
import { istDay, storeAnalytics } from "@/server/store/analytics";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store analytics — Vishwaship" };
type SP = Promise<{ range?: string }>;

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`);
const money = (v: number | null) => (v === null ? "—" : rupees(Math.round(v)));
const x = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}×`);
const n = (v: number) => v.toLocaleString("en-IN");

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", marginTop: 4 }}>{value}</div>
      {note && <div className="tiny muted" style={{ marginTop: 2 }}>{note}</div>}
    </div>
  );
}

export default async function StoreAnalyticsPage({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireStorePage();
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.range)) ? Number(sp.range) : 30;
  const to = istDay(new Date()), from = istDay(new Date(Date.now() - (days - 1) * 86400_000));
  const a = await storeAnalytics(ctx.org.id, from, to);
  const s = a.store;
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Analytics</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>{from} to {to} (IST)</p></div>
        <nav className="tabs" aria-label="Date range">{[7, 30, 90].map((d) => <a key={d} className={d === days ? "on" : ""} href={`?range=${d}`}>Last {d} days</a>)}</nav>
      </div>

      <h2 style={{ fontSize: 15, margin: "4px 0 8px" }}>Store performance</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 10 }}>
        <Tile label="Revenue" value={rupees(s.revenuePaise)} note={`${n(s.orders)} orders (${n(s.online)} online · ${n(s.cod)} COD)`} />
        <Tile label="Average order value" value={rupees(s.aovPaise)} />
        <Tile label="Visitors" value={n(s.visitors)} note={`${n(s.views)} page views · visitors who allowed analytics`} />
        <Tile label="Conversion rate" value={pct(s.conversionRate)} note={s.conversionRate === null ? "Shown after 20+ visitors who allowed analytics" : "Orders ÷ visitors"} />
        <Tile label="Cancelled" value={n(s.cancelled)} note={`${n(s.abandonedPayments)} unpaid online checkouts`} />
      </div>

      {s.topProducts.length > 0 && (
        <div className="card p0" style={{ marginTop: 12 }}>
          <div className="card-h"><b>Top products</b></div>
          <table className="os-dns"><thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead>
            <tbody>{s.topProducts.map((p) => <tr key={p.title}><td>{p.title}</td><td>{n(p.units)}</td><td>{rupees(p.revenuePaise)}</td></tr>)}</tbody></table>
        </div>
      )}

      <h2 style={{ fontSize: 15, margin: "20px 0 8px" }}>Ad performance</h2>
      <p className="small muted" style={{ marginTop: 0, maxWidth: 860 }}>
        <b>Platform-reported</b> purchases are what Meta / Google say their ads produced, using their own rules (they can count views and other devices).
        <b> Matched orders</b> are orders in your store we can tie to that platform ourselves (ad click id or UTM tag). The two are shown side by side, never added together.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 12 }}>
        {a.platforms.map((p) => (
          <div className="card" style={{ padding: 16 }} key={p.platform}>
            <div className="row between wrap" style={{ gap: 6 }}>
              <h3 style={{ margin: 0 }}>{p.platform === "meta" ? "Meta (Facebook & Instagram)" : "Google Ads"}</h3>
              <span className="tiny muted">{p.hasData ? `${p.sources.includes("csv") ? "From your CSV" : "Synced from Meta"}${p.lastUpdated ? ` · ${p.lastUpdated.toLocaleDateString("en-IN")}` : ""}` : ""}</span>
            </div>
            {!p.hasData && p.matchedOrders === 0 ? (
              <p className="small muted">No data yet. {p.platform === "meta" ? <>Connect your ad account in <a className="orange" href="/portal/store/marketing/">Meta & Google</a>.</> : <>Upload a Google Ads CSV in <a className="orange" href="/portal/store/marketing/">Meta & Google</a>.</>}</p>
            ) : (
              <>
                <dl className="kv-list" style={{ marginTop: 10 }}>
                  <dt>Spend</dt><dd>{rupees(p.spendPaise)}</dd>
                  <dt>Impressions · Clicks</dt><dd>{n(p.impressions)} · {n(p.clicks)}</dd>
                  <dt>CPM</dt><dd>{money(p.cpm)}</dd>
                  <dt>CPC</dt><dd>{money(p.cpc)}</dd>
                  <dt>CTR</dt><dd>{pct(p.ctr)}</dd>
                </dl>
                <div className="grid2" style={{ marginTop: 12, gap: 10 }}>
                  <div style={{ background: "var(--gray-soft)", borderRadius: 10, padding: 10 }}>
                    <div className="tiny muted">Platform-reported</div>
                    <div className="small"><b>{n(p.platformPurchases)}</b> purchases · {rupees(p.platformValuePaise)}</div>
                    <div className="small">ROAS {x(p.platformRoas)} · cost/purchase {money(p.costPerPlatformPurchase)}</div>
                  </div>
                  <div style={{ background: "var(--gray-soft)", borderRadius: 10, padding: 10 }}>
                    <div className="tiny muted">Matched orders (your store)</div>
                    <div className="small"><b>{n(p.matchedOrders)}</b> orders · {rupees(p.matchedRevenuePaise)}</div>
                    <div className="small">ROAS {x(p.matchedRoas)} · cost/purchase {money(p.costPerPurchase)}</div>
                  </div>
                </div>
                {p.campaigns.length > 0 && (
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table className="os-dns"><thead><tr><th>Campaign</th><th>Spend</th><th>CTR</th><th>CPC</th><th>Platform purchases</th><th>Matched</th></tr></thead>
                      <tbody>{p.campaigns.map((c) => <tr key={c.name}><td>{c.name}</td><td>{rupees(c.spendPaise)}</td><td>{pct(c.ctr)}</td><td>{money(c.cpc)}</td><td>{n(c.platformPurchases)}</td><td>{n(c.matchedOrders)}</td></tr>)}</tbody></table>
                    <p className="tiny muted">Matched orders are linked to a campaign when the order&apos;s utm_campaign equals the campaign name.</p>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="card p0" style={{ marginTop: 16, overflowX: "auto" }}>
        <div className="card-h"><b>By day</b></div>
        <table className="os-dns"><thead><tr><th>Day</th><th>Page views</th><th>Visitors</th><th>Orders</th><th>Revenue</th><th>Ad spend</th></tr></thead>
          <tbody>{[...a.daily].reverse().map((d) => <tr key={d.day}><td>{d.day}</td><td>{n(d.views)}</td><td>{n(d.visitors)}</td><td>{n(d.orders)}</td><td>{rupees(d.revenuePaise)}</td><td>{d.spendPaise ? rupees(d.spendPaise) : "—"}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
