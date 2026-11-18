import { CopyBtn } from "@/components/portal/orders/ui";
import { AwbLink, OrderIdLink, portalOrderHref, portalTrackHref } from "@/components/IdLinks";
import Link from "next/link";
import { and, desc, eq, or } from "drizzle-orm";
import { RefreshTracking } from "@/components/portal/RefreshTracking";
import { carrierLogo } from "@/lib/site";
import { StatusChip, statusLabel } from "@/lib/status";
import { t } from "@/server/content";
import { getDb, schema } from "@/server/db/client";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";
import { ensurePublicRef, timeline } from "@/server/tracking/service";

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function PortalTrack({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "tracking");
  const help = await t("portal.tracking.help");
  const db = await getDb();
  let found: Array<{ s: typeof schema.shipments.$inferSelect; o: typeof schema.orders.$inferSelect }> = [];
  if (q?.trim()) {
    const v = q.trim();
    found = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
      .where(and(eq(schema.shipments.orgId, ctx.org.id), or(eq(schema.shipments.awb, v.toUpperCase()), eq(schema.shipments.lrNumber, v.toUpperCase()), eq(schema.orders.orderNumber, v))))
      .orderBy(desc(schema.shipments.createdAt)).limit(5);
  }
  const [page] = await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.orgId, ctx.org.id));
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return (
    <>
      <div className="page-h"><div><h1>Track Order</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{help}</p></div></div>
      <form className="card row wrap" style={{ padding: 16, gap: 8, maxWidth: 680 }} role="search">
        <label htmlFor="tq" className="sr-only">AWB, LR or order ID</label>
        <input id="tq" name="q" className="input" defaultValue={q} placeholder="AWB / LR number or order ID" required style={{ flex: 1, minWidth: 220 }} />
        <button className="btn btn-orange">Track</button>
      </form>
      {q && found.length === 0 && <p className="mt12 muted" role="status">No shipment in your account matches “{q}”.</p>}
      {await Promise.all(found.map(async ({ s, o }) => {
        const events = await timeline(s.id);
        const latest = events[events.length - 1];
        const ref = await ensurePublicRef(s.id);
        const shareUrl = page?.isPublished && !page.disabledByAdmin ? `${appUrl}/t/${page.slug}/${ref}` : `${appUrl}/t/${ref}`;
        return (
          <section key={s.id} className="card mt16" style={{ padding: 18 }}>
            <div className="row between wrap" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 12, alignItems: "center" }}>
                {carrierLogo(s.carrierCode) && <img src={carrierLogo(s.carrierCode)!} alt={s.carrierName} style={{ height: 30 }} />}
                <div><OrderIdLink value={o.orderNumber} href={portalOrderHref(o.id)} /><div className="small id-row"><AwbLink value={s.awb} href={portalTrackHref(s.awb)} />{s.awb && <CopyBtn value={s.awb} label="AWB" />}</div></div>
              </div>
              <div style={{ textAlign: "right" }}>
                <StatusChip status={s.status} />
                <div className="tiny muted mt8">{s.etaDate ? `Expected by ${s.etaDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}` : "ETA not provided by carrier"}</div>
              </div>
            </div>
            <dl className="kv-list mt12">
              <dt>Carrier status (original)</dt><dd className="mono small">{latest?.rawStatus ?? "—"}{latest?.location ? ` · ${latest.location}` : ""}</dd>
              <dt>Last update</dt><dd>{s.lastEventAt ? fmt(s.lastEventAt) : "—"}</dd>
              <dt>Buyer tracking link</dt><dd className="small" style={{ wordBreak: "break-all" }}><a className="link" href={shareUrl} target="_blank" rel="noopener">{shareUrl}</a></dd>
            </dl>
            <RefreshTracking shipmentId={s.id} />
            <ol className="trk-tl">
              {[...events].reverse().map((e, i) => (
                <li key={e.id} className={i === 0 ? "cur" : ""}>
                  <span className="b small">{statusLabel(e.status)}{e.location ? <span className="muted"> · {e.location}</span> : null}<span className="tiny muted mono" style={{ display: "block" }}>{e.rawStatus}</span></span>
                  <span className="tiny muted">{fmt(e.occurredAt)}</span>
                </li>
              ))}
              {events.length === 0 && <li><span className="small muted">No scans yet.</span></li>}
            </ol>
          </section>
        );
      }))}
    </>
  );
}
