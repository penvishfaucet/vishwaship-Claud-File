import "@/styles/orders-v2.css";
import { eq } from "drizzle-orm";
import { OrdersView } from "@/components/portal/orders/OrdersView";
import { getDb, schema } from "@/server/db/client";
import { contentMap, type ContentKey } from "@/server/content";
import { orgSetting } from "@/server/couriers";
import { hasFeature } from "@/server/features";
import { filterOptions, listOrderRows, parseOrderFilters, tabCounts } from "@/server/orders/view";
import { portalContext } from "@/server/portal/context";
import { getSetting } from "@/server/quotes/service";
import { OPTIONAL_COLUMNS, type OptionalColumn, type PrintFormat, PRINT_FORMATS, TAB_GROUPS } from "@/lib/order-view";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const [u] = await db.select({ prefs: schema.users.prefs }).from(schema.users).where(eq(schema.users.id, ctx.session.userId));
  const prefs = (u?.prefs ?? {}) as { ordersHidden?: string[]; ordersPageSize?: number };
  const f = parseOrderFilters({ ...sp, size: sp.size ?? (prefs.ordersPageSize ? String(prefs.ordersPageSize) : undefined) });
  const [counts, data, options, storeSync, tracking] = await Promise.all([
    tabCounts(ctx.org.id, f), listOrderRows(ctx.org.id, f), filterOptions(ctx.org.id), hasFeature(ctx.org.id, "store_channels"), hasFeature(ctx.org.id, "tracking"),
  ]);
  const keys = [
    ...TAB_GROUPS.flatMap((g) => g.tabs).map((t) => `portal.orders.tab.${t.key}`),
    ...TAB_GROUPS.filter((g) => g.title).map((_, i) => `portal.orders.group.${i}`),
    "portal.orders.cod_line", "portal.orders.international",
  ] as ContentKey[];
  const labels = await contentMap(keys);
  // label size: customer's own default (Settings → Label) if it is one of the print sizes, else the Admin default
  const own = (await orgSetting<{ format?: string }>(ctx.org.id, "label_settings"))?.format;
  const adminDefault = (await getSetting<PrintFormat>("orders_label_default", "a4_fit")).value;
  const defaultLabel = (PRINT_FORMATS.some((p) => p.key === own) ? own : adminDefault) as PrintFormat;
  const hidden = (prefs.ordersHidden ?? []).filter((k): k is OptionalColumn => OPTIONAL_COLUMNS.some((c) => c.key === k));
  return (
    <OrdersView
      filters={f}
      counts={counts}
      rows={data.rows}
      total={data.total}
      options={options}
      hidden={hidden}
      labels={labels}
      features={{ storeSync, tracking, international: false }}
      defaultLabel={defaultLabel}
      walletPaise={ctx.walletAvailable}
    />
  );
}
