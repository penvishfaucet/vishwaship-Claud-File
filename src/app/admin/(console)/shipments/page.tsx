import "@/styles/orders-v2.css";
import Link from "next/link";
import { OrdersView } from "@/components/portal/orders/OrdersView";
import { contentMap, type ContentKey } from "@/server/content";
import { requireStaff } from "@/server/auth/session";
import { normalizeLabelFormat } from "@/server/labels/formats";
import { adminFilterOptions, listOrderRows, parseOrderFilters, tabCounts } from "@/server/orders/view";
import { getSetting } from "@/server/quotes/service";
import { type PrintFormat, TAB_GROUPS } from "@/lib/order-view";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

/**
 * Admin → All Shipments (Orders): every customer's orders in the same Shipmozo-style view customers see —
 * same tabs, counts, filters, columns, Track and label download — plus a Customer column and filter.
 * Staff with shipments.read only; customer-only actions (create, cancel, archive, clone) are not shown here.
 */
export default async function AdminShipments({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaff("shipments.read");
  const f = parseOrderFilters(sp);
  const [list, counts, opts] = await Promise.all([listOrderRows(null, f), tabCounts(null, f), adminFilterOptions()]);
  const keys = [
    ...TAB_GROUPS.flatMap((g) => g.tabs).map((t) => `portal.orders.tab.${t.key}`),
    ...TAB_GROUPS.filter((g) => g.title).map((_, i) => `portal.orders.group.${i}`),
    "portal.orders.cod_line", "portal.orders.international",
  ] as ContentKey[];
  const labels = await contentMap(keys);
  const defaultLabel = normalizeLabelFormat((await getSetting<PrintFormat>("orders_label_default", "a4_fit")).value);
  const exportHref = `/api/admin/export/shipments?${new URLSearchParams(Object.entries({ org: f.customer, from: f.from, to: f.to }).filter(([, v]) => v) as [string, string][])}`;
  const qs = (p: SP) => {
    const m: SP = { ...sp, ...p };
    delete m.page;
    return `/admin/shipments/?${new URLSearchParams(Object.entries(m).filter((e): e is [string, string] => !!e[1]))}`;
  };
  const customer = opts.customers.find((c) => c.id === f.customer);
  const quick: Array<[string, SP, boolean]> = [
    ["Booking being confirmed", { exception: f.exception === "booking" ? undefined : "booking" }, f.exception === "booking"],
    ["No scan for 72 h", { exception: f.exception === "stale" ? undefined : "stale" }, f.exception === "stale"],
    ["Cancelled", { tab: "all", status: f.status === "cancelled" ? undefined : "cancelled" }, f.status === "cancelled"],
    ["Lost", { tab: "all", status: f.status === "lost" ? undefined : "lost" }, f.status === "lost"],
  ];
  return (
    <>
      <div className="page-h">
        <div>
          <h1>All Orders</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Every customer&apos;s orders with the same tabs and statuses customers see · {list.total.toLocaleString("en-IN")} match.</p>
        </div>
      </div>
      <nav className="as-quick" aria-label="Admin shortcuts">
        <span className="small muted">Exceptions:</span>
        {quick.map(([label, p, on]) => <Link key={label} href={qs(p)} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>{label}</Link>)}
        {customer && <span className="small">Showing <b>{customer.name}</b> · <Link className="link-navy" href={`/admin/customers/${customer.id}/`}>Profile</Link> · <Link className="link-navy" href={qs({ customer: undefined })}>All customers</Link></span>}
      </nav>
      <OrdersView
        filters={f}
        counts={counts}
        rows={list.rows}
        total={list.total}
        options={{ couriers: opts.couriers, warehouses: [], tags: [] }}
        hidden={[]}
        labels={labels}
        features={{ storeSync: false, tracking: true, international: false }}
        defaultLabel={defaultLabel}
        walletPaise={0}
        admin={{ customers: opts.customers, exportHref }}
      />
    </>
  );
}
