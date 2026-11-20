"use client";
import { paymentLabel } from "@/lib/payment";
import { fetchLabels } from "@/components/labels/LabelDownload";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArchiveRestore, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Eye, FileText, Filter,
  MessageCircle, PlusCircle, RefreshCw, Settings, Settings2, Tag, Truck, Upload, XCircle,
  ClipboardList, CopyPlus, LifeBuoy, MoreHorizontal, Package, Pencil, Receipt, SlidersHorizontal, Undo2, UserRound,
} from "lucide-react";
import { DateRangePicker } from "@/components/portal/DateRangePicker";
import { carrierLogo } from "@/lib/site";
import { statusLabel } from "@/lib/status";
import {
  COD_FILTERS, OPTIONAL_COLUMNS, type OptionalColumn, PAGE_SIZES, type PrintFormat, PRINT_FORMATS, PRINT_HINT, TAB_GROUPS, bookingStage, orderStatusText, type TabKey, codDisplay,
} from "@/lib/order-view";
import type { OrderFilters, OrderRow } from "@/server/orders/view";
import { BreakdownDialog, CodDialog, PickupDialog, TrackDialog } from "./dialogs";
import { DailyManifest, openManifest } from "@/components/portal/ManifestActions";
import { CodStatusText, CopyBtn, ago, inr, istDate, istTime, kg, useDismiss } from "./ui";

interface Props {
  filters: OrderFilters;
  counts: Record<TabKey, number>;
  rows: OrderRow[];
  total: number;
  options: { couriers: Array<{ code: string; name: string }>; warehouses: Array<{ id: string; label: string }>; tags: Array<{ id: string; name: string }> };
  hidden: OptionalColumn[];
  labels: Record<string, string>;
  features: { storeSync: boolean; tracking: boolean; international: boolean };
  defaultLabel: PrintFormat;
  walletPaise: number;
}

type DialogState = null | { kind: "track"; shipmentId: string } | { kind: "cod" | "breakdown" | "pickup"; row: OrderRow };
type Toast = null | { text: string; bad?: boolean; retry?: { ids: string[]; format: PrintFormat }; sub?: string[] };

const SOURCE: Record<string, string> = { manual: "Custom", bulk: "Bulk Import", api: "API", shopify: "Shopify", woocommerce: "WooCommerce", custom: "Custom" };
const SHIP_STATUSES = ["not_booked", "booked", "pickup_pending", "picked_up", "in_transit", "at_delivery_center", "out_for_delivery", "delivered", "ndr", "rto_initiated", "rto_in_transit", "rto_delivered", "cancelled", "lost"];

/** Booking badge in "Order Details" (shared with Admin: lib/order-view bookingStage). */
const bookingBadge = (r: OrderRow) => bookingStage(r);

export function OrdersView(p: Props) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const f = p.filters;
  const [hidden, setHidden] = useState<Set<OptionalColumn>>(new Set(p.hidden));
  const show = (c: OptionalColumn) => !hidden.has(c);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [tools, setTools] = useState(false);
  const menuOpen = useRef(false);
  const L = (k: string, d: string) => p.labels[k] || d;

  useEffect(() => { setSelected(new Set()); }, [p.rows]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 9000); return () => clearTimeout(t); }, [toast]);

  const refresh = useCallback(() => { router.refresh(); setLastRefresh(new Date()); }, [router]);
  // Tracking / COD updates arrive in the background — refresh the list every 60 s while visible and idle.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && !dialog && !menuOpen.current) refresh(); }, 60_000);
    return () => clearInterval(t);
  }, [dialog, refresh]);

  const href = useCallback((patch: Record<string, string | undefined>, keepPage = false) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "") q.delete(k); else q.set(k, v); }
    if (!keepPage && !("page" in patch)) q.delete("page");
    q.delete("group"); q.delete("bucket");
    const s = q.toString();
    return s ? `${path}?${s}` : `${path}`;
  }, [params, path]);
  const go = (patch: Record<string, string | undefined>) => router.push(href(patch));
  const exportHref = `/api/portal/orders/export?${new URLSearchParams({ ...Object.fromEntries(params.entries()), tab: f.tab, direction: f.direction, dateType: f.dateType, from: f.from, to: f.to }).toString()}`;

  // ------------------------------------------------------------ actions
  async function downloadLabels(ids: string[], format: PrintFormat) {
    if (!ids.length) return;
    const w = window.open("about:blank", "_blank");
    setBusy("labels");
    try {
      const r = await fetchLabels("/api/portal/labels", ids, format, w);
      const retryIds = r.skipped.filter((x) => x.retryable).map((x) => x.shipmentId);
      const retry = (r.ok ? retryIds : retryIds.length ? retryIds : r.skipped.length ? [] : ids);
      const sub = [...r.notices, PRINT_HINT];
      if (!r.ok) { setToast({ text: r.message, bad: true, retry: retry.length ? { ids: retry, format } : undefined, sub }); return; }
      setToast(r.skipped.length
        ? { text: `${r.pages} label page(s) ready. Not included: ${r.skipped.map((x) => `${x.orderNumber} (${x.reason})`).join("; ")}`, bad: true, retry: retry.length ? { ids: retry, format } : undefined, sub }
        : { text: `${r.pages} label page(s) ready (${PRINT_FORMATS.find((x) => x.key === format)?.name}).`, sub });
    } finally { setBusy(null); }
  }
  async function cancel(r: OrderRow) {
    const booked = !!r.shipment;
    if (!confirm(booked ? `Cancel shipment ${r.shipment?.awb ?? r.orderNumber}? We ask ${r.shipment?.carrierName} to cancel it; the shipping charge is refunded to your wallet once the courier confirms.` : `Cancel order ${r.orderNumber}?`)) return;
    setBusy(`cancel:${r.id}`);
    const res = await fetch(`/api/portal/orders/${r.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    setToast(res.ok ? { text: j.message ?? "Cancelled" } : { text: j.error?.message ?? "Cancellation failed", bad: true });
    refresh();
  }
  async function clone(r: OrderRow) {
    setBusy("clone");
    const res = await fetch(`/api/portal/orders/${r.id}/clone`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setToast({ text: j.error?.message ?? "Could not clone the order", bad: true }); return; }
    router.push(j.editUrl);
  }
  async function archive(ids: string[], on: boolean) {
    setBusy("archive");
    const res = await fetch("/api/portal/orders/archive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, archive: on }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    setToast(res.ok ? { text: `${j.count} order(s) ${on ? "moved to Archive" : "restored"}.` } : { text: j.error?.message ?? "Could not update", bad: true });
    refresh();
  }
  async function syncOrders() {
    setBusy("sync");
    const res = await fetch("/api/portal/orders/sync", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setToast({ text: j.error?.message ?? "Sync failed", bad: true }); return; }
    const parts = (j.results as Array<{ store: string; ok: boolean; message?: string; counts?: Record<string, number> }>).map((x) => x.ok ? `${x.store}: ${x.counts?.imported ?? 0} new` : `${x.store}: ${x.message}`);
    setToast({ text: `Sync finished — ${parts.join("; ")}`, bad: !j.ok });
    refresh();
  }

  const allIds = p.rows.map((r) => r.id);
  const allSel = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const selRows = p.rows.filter((r) => selected.has(r.id));
  const selLabelIds = selRows.flatMap((r) => (r.shipment?.awb ? [r.shipment.id] : []));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pages = Math.max(1, Math.ceil(p.total / f.pageSize));
  const colCount = 4 + ["orderDate", "product", "package", "shipping", "pickup"].filter((c) => show(c as OptionalColumn)).length + 1;

  return (
    <div className="ov">
      {/* compact top: region switch · Add Order · options icon */}
      <div className="oc-head">
        <div className="oc-seg" role="group" aria-label="Shipment region">
          <span className="on" aria-current="true">Domestic</span>
          <button type="button" onClick={() => setToast({ text: L("portal.orders.international", "International shipping is not enabled for your account."), bad: true })}>International</button>
        </div>
        <div className="oc-head-r">
          <AddOrder reverse={f.direction === "reverse"} onOpen={(o) => { menuOpen.current = o; }} />
          <button type="button" className={`oc-opt${tools ? " on" : ""}`} aria-label="Filters and options" aria-expanded={tools} onClick={() => setTools((t) => !t)}><SlidersHorizontal size={22} aria-hidden /></button>
        </div>
      </div>
      <DailyManifest couriers={p.options.couriers} warehouses={p.options.warehouses} />
      {/* status tabs: one scrollable row with counts */}
      <nav className="oc-tabs" aria-label="Order status">
        {TAB_GROUPS.flatMap((g) => g.tabs).map((t) => {
          const on = f.tab === t.key;
          return <Link key={t.key} href={href({ tab: t.key === "all" ? undefined : t.key })} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>{L(`portal.orders.tab.${t.key}`, t.label)}<i>{p.counts[t.key]}</i></Link>;
        })}
      </nav>
      {f.direction === "reverse" && <p className="oc-note small">Showing <b>return orders</b>. <Link href={href({ direction: undefined, tab: undefined })}>Back to forward orders</Link></p>}
      <div className="ov-top" hidden={!tools}>
        <nav className="ov-dir" aria-label="Shipment direction">
          <Link href={href({ direction: undefined, tab: undefined })} className={f.direction === "forward" ? "on" : ""} aria-current={f.direction === "forward" ? "page" : undefined}>Forward</Link>
          <Link href={href({ direction: "reverse", tab: undefined })} className={f.direction === "reverse" ? "on" : ""} aria-current={f.direction === "reverse" ? "page" : undefined}>Reverse</Link>
        </nav>
        <div className="ov-seg" role="group" aria-label="Shipment region">
          <span className="on" aria-current="true" style={{ borderRadius: 9, padding: "7px 16px", fontSize: 13, fontWeight: 600 }}>Domestic</span>
          <button type="button" className="off" aria-disabled="true" title={L("portal.orders.international", "International shipping is not enabled for your account.")}
            onClick={() => setToast({ text: L("portal.orders.international", "International shipping is not enabled for your account."), bad: true })}>International</button>
        </div>
        <div className="ov-act">
          {p.features.storeSync && <button type="button" className="ov-btn navy" onClick={syncOrders} disabled={busy === "sync"}><RefreshCw size={16} aria-hidden className={busy === "sync" ? "spin" : undefined} /> {busy === "sync" ? "Syncing…" : "Sync Orders"}</button>}
          <Link className="ov-btn navy" href="/portal/orders/bulk/"><Upload size={16} aria-hidden /> Bulk Import</Link>
        </div>
      </div>

      {/* row 2: status navigation */}
      <nav className="ov-status" aria-label="Order status groups" hidden>
        {TAB_GROUPS.map((g, gi) => (
          <div className="ov-sgroup" key={gi}>
            <span>{g.title ? L(`portal.orders.group.${gi}`, g.title) : " "}</span>
            <div className="ov-stabs">
              {g.tabs.map((t) => {
                const on = f.tab === t.key;
                const n = p.counts[t.key];
                return (
                  <Link key={t.key} href={href({ tab: t.key === "all" ? undefined : t.key })} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
                    <b className="ov-box-n" aria-label={`${n} orders`}>{n}</b><span className="ov-box-l">{L(`portal.orders.tab.${t.key}`, t.label)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* row 3: filters + table */}
      <section className="ov-card" aria-label="Orders list">
        {tools && <FilterBar p={p} go={go} exportHref={exportHref} onRefresh={refresh} lastRefresh={lastRefresh} hidden={hidden} setHidden={setHidden} setToast={setToast} onMenu={(o) => { menuOpen.current = o; }} />}

        {selected.size > 0 && (
          <div className="ov-bulk" role="region" aria-label="Bulk actions" style={{ margin: "0 12px 12px" }}>
            <b>{selected.size} selected</b>
            <LabelMenu label={`Download labels (${selLabelIds.length})`} formats={LABEL_CHOICES.flatMap((g) => g.items.map((i) => ({ key: i.key, name: g.group === "Thermal printer" ? `Thermal ${i.name}` : i.name, ok: true })))} disabled={!selLabelIds.length || busy === "labels"}
              onPick={(fmt) => downloadLabels(selLabelIds, fmt)} dark onOpen={(o) => { menuOpen.current = o; }} />
            {f.tab === "archive"
              ? <button type="button" className="ov-btn ghost sm" onClick={() => archive([...selected], false)}><ArchiveRestore size={14} aria-hidden /> Restore</button>
              : <button type="button" className="ov-btn ghost sm" onClick={() => archive([...selected], true)}><Archive size={14} aria-hidden /> Archive</button>}
            <button type="button" className="ov-btn ghost sm" onClick={() => setSelected(new Set())}>Clear</button>
            {selLabelIds.length < selected.size && <span className="small">{selected.size - selLabelIds.length} without AWB will be skipped</span>}
          </div>
        )}

        {p.rows.length === 0 ? (
          <div className="ov-empty">
            <p className="muted">No orders match these filters for {istDate(`${f.from}T12:00:00+05:30`)} – {istDate(`${f.to}T12:00:00+05:30`)}.</p>
            <div className="row" style={{ justifyContent: "center", gap: 8 }}>
              <Link className="ov-btn ghost" href={path}>Clear filters</Link>
              <Link className="ov-btn orange" href={f.direction === "reverse" ? "/portal/orders/new/?direction=reverse" : "/portal/orders/new/"}><PlusCircle size={16} aria-hidden /> {f.direction === "reverse" ? "Add Return" : "Create Order"}</Link>
            </div>
          </div>
        ) : (
          <>
            {/* One simple card per order: ID, payment, status and three actions. Everything else is inside the order. */}
            <label className="row small oc-selall"><input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(allIds))} /> Select all on this page</label>
            <div className="oc-grid">
              {p.rows.map((r) => (
                <ShipCard key={r.id} r={r} selected={selected.has(r.id)} onToggle={() => toggle(r.id)} open={setDialog} defaultLabel={p.defaultLabel}
                  onLabel={(fmt) => r.shipment && downloadLabels([r.shipment.id], fmt)} onCancel={() => cancel(r)} onArchive={(on) => archive([r.id], on)}
                  onClone={() => clone(r)} busy={busy} onMenu={(o) => { menuOpen.current = o; }} />
              ))}
            </div>
            <div className="ov-tablewrap" hidden>
              <table className="ov-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all orders on this page" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(allIds))} /></th>
                    {show("orderDate") && <th>Order Date</th>}
                    <th>Order Details</th>
                    {show("product") && <th>Product Details</th>}
                    {show("package") && <th>Package Details</th>}
                    <th>Payment</th>
                    <th>Tracking Info</th>
                    {show("shipping") && <th>Shipping Details</th>}
                    {show("pickup") && <th>Pickup Address</th>}
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <DesktopRow key={r.id} r={r} show={show} colCount={colCount} selected={selected.has(r.id)} onToggle={() => toggle(r.id)}
                      codLabel={L("portal.orders.cod_line", "WhatsApp COD order confirmation")} open={setDialog} busy={busy}
                      onLabel={(fmt) => r.shipment && downloadLabels([r.shipment.id], fmt)} onCancel={() => cancel(r)} onArchive={(on) => archive([r.id], on)}
                      onMenu={(o) => { menuOpen.current = o; }} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ov-cards" style={{ padding: 12 }} hidden>
              <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(allIds))} /> Select all on this page</label>
              {p.rows.map((r) => (
                <MobileCard key={r.id} r={r} selected={selected.has(r.id)} onToggle={() => toggle(r.id)} open={setDialog} defaultLabel={p.defaultLabel}
                  codLabel={L("portal.orders.cod_line", "WhatsApp COD order confirmation")} onLabel={(fmt) => r.shipment && downloadLabels([r.shipment.id], fmt)}
                  onCancel={() => cancel(r)} onArchive={(on) => archive([r.id], on)} busy={busy} />
              ))}
            </div>
          </>
        )}
      </section>

      <Pager total={p.total} page={f.page} pages={pages} pageSize={f.pageSize} href={href} onSize={async (n) => {
        await fetch("/api/portal/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ordersPageSize: n }) }).catch(() => null);
        go({ size: String(n) });
      }} />

      <Link className="oc-returns" href={f.direction === "reverse" ? href({ direction: undefined, tab: undefined }) : href({ direction: "reverse", tab: undefined })}>
        <Undo2 size={18} aria-hidden /> {f.direction === "reverse" ? "Forward" : "Returns"}
      </Link>
      {dialog?.kind === "track" && <TrackDialog shipmentId={dialog.shipmentId} onClose={() => setDialog(null)} onChanged={refresh} />}
      {dialog?.kind === "cod" && <CodDialog row={dialog.row} onClose={() => setDialog(null)} />}
      {dialog?.kind === "breakdown" && <BreakdownDialog row={dialog.row} onClose={() => setDialog(null)} />}
      {dialog?.kind === "pickup" && <PickupDialog row={dialog.row} onClose={() => setDialog(null)} />}
      {toast && <div className={`ov-toast${toast.bad ? " bad" : ""}`} role={toast.bad ? "alert" : "status"}><span>{toast.text}{toast.sub?.map((x) => <small key={x} style={{ display: "block", opacity: 0.85, marginTop: 4 }}>{x}</small>)}</span>{toast.retry && <button type="button" className="ov-btn sm ghost" onClick={() => { const t = toast.retry!; setToast(null); void downloadLabels(t.ids, t.format); }}>Retry {toast.retry.ids.length > 1 ? `${toast.retry.ids.length} ` : ""}failed</button>}<button type="button" onClick={() => setToast(null)} aria-label="Dismiss">✕</button></div>}
    </div>
  );
}

// ---------------------------------------------------------------- top actions

function AddOrder({ reverse, onOpen }: { reverse: boolean; onOpen: (o: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const set = (o: boolean) => { setOpen(o); onOpen(o); };
  const ref = useDismiss(open, () => set(false));
  return (
    <div className="ov-split" ref={ref}>
      <Link className="ov-btn orange" href={reverse ? "/portal/orders/new/?direction=reverse" : "/portal/orders/new/"}><PlusCircle size={16} aria-hidden /> {reverse ? "Add Return" : "Create Order"}</Link>
      <button type="button" className="ov-btn navy caret" aria-label="More ways to add orders" aria-expanded={open} aria-haspopup="menu" onClick={() => set(!open)}><ChevronDown size={16} aria-hidden /></button>
      {open && (
        <div className="ov-menu" role="menu">
          <Link role="menuitem" href="/portal/orders/new/">Create Order</Link>
          <Link role="menuitem" href="/portal/orders/new/?direction=reverse">Create return (reverse pickup)</Link>
          <Link role="menuitem" href="/portal/orders/new/?quick=1">Quick add</Link>
          <Link role="menuitem" href="/portal/orders/bulk/">Bulk import (Excel / CSV)</Link>
          <Link role="menuitem" href="/portal/integrations/">Connect a store</Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- filter bar

function FilterBar({ p, go, exportHref, onRefresh, lastRefresh, hidden, setHidden, setToast, onMenu }: {
  p: Props; go: (patch: Record<string, string | undefined>) => void; exportHref: string; onRefresh: () => void; lastRefresh: Date;
  hidden: Set<OptionalColumn>; setHidden: (s: Set<OptionalColumn>) => void; setToast: (t: Toast) => void; onMenu: (o: boolean) => void;
}) {
  const f = p.filters;
  const [more, setMore] = useState(false);
  const [cfg, setCfg] = useState(false);
  useEffect(() => onMenu(more || cfg), [more, cfg, onMenu]);
  const moreRef = useDismiss(more, () => setMore(false));
  const cfgRef = useDismiss(cfg, () => setCfg(false));
  const [ref, setRef] = useState(f.ref ?? "");
  const [awb, setAwb] = useState(f.awb ?? "");
  useEffect(() => { setRef(f.ref ?? ""); setAwb(f.awb ?? ""); }, [f.ref, f.awb]);
  const activeMore = [f.courier, f.type, f.payment, f.warehouse, f.status, f.cod, f.tag].filter(Boolean).length;
  const chips: Array<[string, string]> = [];
  if (f.ref) chips.push(["ref", `Reference: ${f.ref}`]);
  if (f.awb) chips.push(["awb", `AWB/LR: ${f.awb}`]);
  if (f.q) chips.push(["q", `Search: ${f.q}`]);
  if (f.courier) chips.push(["courier", `Courier: ${p.options.couriers.find((c) => c.code === f.courier)?.name ?? f.courier}`]);
  if (f.type) chips.push(["type", `Type: ${f.type}`]);
  if (f.payment) chips.push(["payment", `Payment: ${f.payment.toUpperCase()}`]);
  if (f.warehouse) chips.push(["warehouse", `Warehouse: ${p.options.warehouses.find((w) => w.id === f.warehouse)?.label ?? "—"}`]);
  if (f.status) chips.push(["status", `Status: ${f.status === "not_booked" ? "Not booked" : statusLabel(f.status)}`]);
  if (f.cod) chips.push(["cod", `COD confirmation: ${COD_FILTERS.find((c) => c.key === f.cod)?.label ?? f.cod}`]);
  if (f.tag) chips.push(["tag", `Tag: ${p.options.tags.find((t) => t.id === f.tag)?.name ?? "—"}`]);

  return (
    <>
      <div className="ov-filters">
        <label className="sr-only" htmlFor="ov-dt">Date type</label>
        <select id="ov-dt" className="ov-field" value={f.dateType} onChange={(e) => go({ dateType: e.target.value === "created" ? undefined : e.target.value })}>
          <option value="created">Order Created</option><option value="booked">Shipment Booked</option><option value="delivered">Delivered</option>
        </select>
        <DateRangePicker from={f.from} to={f.to} />
        <form className="ov-search" role="search" onSubmit={(e) => { e.preventDefault(); go({ ref: ref.trim() || undefined }); }}>
          <label className="sr-only" htmlFor="ov-ref">Search by reference id</label>
          <input id="ov-ref" className="ov-field" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Search by reference id" maxLength={60} enterKeyHint="search" />
        </form>
        <form className="ov-search" role="search" onSubmit={(e) => { e.preventDefault(); go({ awb: awb.trim() || undefined }); }}>
          <label className="sr-only" htmlFor="ov-awb">Search by AWB or LR</label>
          <input id="ov-awb" className="ov-field" value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="Search by awb" maxLength={60} enterKeyHint="search" />
        </form>
        <div className="ov-more" ref={moreRef}>
          <button type="button" className="ov-btn ghost" style={{ borderRadius: 10, height: 44 }} aria-expanded={more} onClick={() => setMore(!more)}><Filter size={16} aria-hidden /> More Filters</button>
          {activeMore > 0 && <span className="ov-dot" aria-label={`${activeMore} filters active`} />}
          {more && <MoreFilters p={p} onApply={(patch) => { setMore(false); go(patch); }} />}
        </div>
        <div className="ov-tools">
          <a className="ov-btn ghost icon" href={exportHref} aria-label="Download orders (CSV, current filters)" title="Download orders (CSV, current filters)"><Download size={18} aria-hidden /></a>
          <button type="button" className="ov-btn ghost icon" aria-label="Refresh" title={`Refresh · updated ${lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`} onClick={onRefresh}><RefreshCw size={18} aria-hidden /></button>
          <div className="ov-more" ref={cfgRef}>
            <button type="button" className="ov-btn ghost icon" aria-label="Table settings" aria-expanded={cfg} onClick={() => setCfg(!cfg)}><Settings size={18} aria-hidden /></button>
            {cfg && (
              <div className="ov-panel right" role="dialog" aria-label="Table settings">
                <b className="small">Show columns</b>
                <p className="tiny muted" style={{ margin: 0 }}>Order Details, Payment, Tracking Info (AWB, status) and Action are always shown.</p>
                {OPTIONAL_COLUMNS.map((c) => (
                  <label key={c.key} className="check"><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => {
                    const n = new Set(hidden); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); setHidden(n);
                  }} /> {c.label}</label>
                ))}
                <button type="button" className="ov-btn navy sm" onClick={async () => {
                  const r = await fetch("/api/portal/prefs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ordersHidden: [...hidden] }) });
                  setCfg(false); setToast(r.ok ? { text: "Column preference saved." } : { text: "Could not save preference", bad: true });
                }}>Save preference</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {chips.length > 0 && (
        <div className="ov-chips" aria-label="Active filters">
          {chips.map(([k, t]) => <span key={k} className="ov-chip">{t} <Link href="#" onClick={(e) => { e.preventDefault(); go({ [k]: undefined }); }} aria-label={`Remove ${t}`}>✕</Link></span>)}
        </div>
      )}
    </>
  );
}

function MoreFilters({ p, onApply }: { p: Props; onApply: (patch: Record<string, string | undefined>) => void }) {
  const f = p.filters;
  const [v, setV] = useState({ courier: f.courier ?? "", type: f.type ?? "", payment: f.payment ?? "", warehouse: f.warehouse ?? "", status: f.status ?? "", cod: f.cod ?? "", tag: f.tag ?? "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="ov-panel" role="dialog" aria-label="More filters" onSubmit={(e) => { e.preventDefault(); onApply(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x || undefined]))); }}>
      <label>Courier<select className="ov-field" value={v.courier} onChange={set("courier")}><option value="">All couriers</option>{p.options.couriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      <label>Shipment type<select className="ov-field" value={v.type} onChange={set("type")}><option value="">B2C, MPS and B2B</option><option value="B2C">B2C (single box)</option><option value="MPS">MPS (B2C multi-box)</option><option value="B2B">B2B</option></select></label>
      <label>Payment mode<select className="ov-field" value={v.payment} onChange={set("payment")}><option value="">All</option><option value="prepaid">Prepaid</option><option value="cod">COD</option><option value="fod">FOD</option></select></label>
      <label>Warehouse<select className="ov-field" value={v.warehouse} onChange={set("warehouse")}><option value="">All warehouses</option>{p.options.warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></label>
      <label>Shipment status<select className="ov-field" value={v.status} onChange={set("status")}><option value="">Any status</option>{SHIP_STATUSES.map((s) => <option key={s} value={s}>{s === "not_booked" ? "Not booked yet" : statusLabel(s)}</option>)}</select></label>
      <label>WhatsApp COD confirmation<select className="ov-field" value={v.cod} onChange={set("cod")}><option value="">Any</option>{COD_FILTERS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      {p.options.tags.length > 0 && <label className="full">Tag<select className="ov-field" value={v.tag} onChange={set("tag")}><option value="">Any tag</option>{p.options.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      <div className="full row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="ov-btn ghost sm" onClick={() => onApply({ courier: undefined, type: undefined, payment: undefined, warehouse: undefined, status: undefined, cod: undefined, tag: undefined })}>Clear</button>
        <button type="submit" className="ov-btn orange sm">Apply filters</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- menus (position: fixed → never clipped by the table scroller)

function useFixedMenu(onOpen?: (o: boolean) => void) {
  const [pos, setPos] = useState<null | React.CSSProperties>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setPos(null); onOpen?.(false); }, [onOpen]);
  const ref = useDismiss(!!pos, close);
  useEffect(() => {
    if (!pos) return;
    const c = () => close();
    window.addEventListener("resize", c); window.addEventListener("scroll", c, true);
    return () => { window.removeEventListener("resize", c); window.removeEventListener("scroll", c, true); };
  }, [pos, close]);
  const toggle = () => {
    if (pos) return close();
    const r = btn.current!.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    const below = window.innerHeight - r.bottom;
    setPos(below > 340 || below > r.top ? { position: "fixed", top: r.bottom + 6, right, maxHeight: below - 16, overflowY: "auto" } : { position: "fixed", bottom: window.innerHeight - r.top + 6, right, maxHeight: r.top - 16, overflowY: "auto" });
    onOpen?.(true);
  };
  return { pos, btn, ref, toggle, close };
}

function LabelMenu({ label, formats, onPick, disabled, dark, onOpen }: { label: string; formats: Array<{ key: PrintFormat; name: string; ok: boolean; reason?: string }>; onPick: (f: PrintFormat) => void; disabled?: boolean; dark?: boolean; onOpen?: (o: boolean) => void }) {
  const m = useFixedMenu(onOpen);
  return (
    <div ref={m.ref} style={{ display: "inline-flex" }}>
      <button ref={m.btn} type="button" className={`ov-btn sm ${dark ? "ghost" : "navy"}`} disabled={disabled} aria-haspopup="menu" aria-expanded={!!m.pos} onClick={m.toggle}><FileText size={14} aria-hidden /> {label} <ChevronDown size={14} aria-hidden /></button>
      {m.pos && (
        <div className="ov-menu" role="menu" style={m.pos}>
          <span className="hd">Label format</span>
          {formats.map((x) => <button key={x.key} role="menuitem" type="button" disabled={!x.ok} onClick={() => { m.close(); onPick(x.key); }}><span>{x.name}{x.reason && <span className="why">{x.reason}</span>}</span></button>)}
        </div>
      )}
    </div>
  );
}

function RowMenu({ r, open, onLabel, onCancel, onArchive, onMenu }: { r: OrderRow; open: (d: DialogState) => void; onLabel: (f: PrintFormat) => void; onCancel: () => void; onArchive: (on: boolean) => void; onMenu: (o: boolean) => void }) {
  const m = useFixedMenu(onMenu);
  const s = r.shipment;
  const canCancel = s ? s.cancellable : r.cancellableOrder;
  return (
    <div ref={m.ref} style={{ display: "inline-flex" }}>
      <button ref={m.btn} type="button" className="ov-btn navy caret" aria-label={`More actions for ${r.orderNumber}`} aria-haspopup="menu" aria-expanded={!!m.pos} onClick={m.toggle}><ChevronDown size={18} aria-hidden /></button>
      {m.pos && (
        <div className="ov-menu" role="menu" style={m.pos}>
          {s && (
            <>
              <span className="hd">Download Label</span>
              {s.awb ? s.labelFormats.map((x) => (
                <button key={x.key} role="menuitem" type="button" disabled={!x.ok} onClick={() => { m.close(); onLabel(x.key); }}>
                  <Download size={14} aria-hidden /><span>{x.name}{s.pieces > 1 || r.boxes > 1 ? ` · ${Math.max(r.boxes, s.pieces)} boxes` : ""}{x.reason && <span className="why">{x.reason}</span>}</span>
                </button>
              )) : <button type="button" disabled><span>AWB Pending<span className="why">Labels appear once the courier assigns the AWB</span></span></button>}
              <div className="sep" />
              <span className="hd">Documents</span>
              <a role="menuitem" href={`/api/portal/shipments/${s.id}/invoice`} target="_blank" rel="noopener"><FileText size={14} aria-hidden /> Download invoice</a>
              <Link role="menuitem" href={`/portal/billing/shipment/${s.id}/`}><Receipt size={14} aria-hidden /> Vishwaship GST invoice</Link>
              <div className="sep" />
            </>
          )}
          <Link role="menuitem" href={`/portal/orders/${r.id}/`}><Eye size={14} aria-hidden /> View Order Details</Link>
          <button role="menuitem" type="button" onClick={() => { m.close(); open({ kind: "cod", row: r }); }}><MessageCircle size={14} aria-hidden /> View WhatsApp COD Confirmation</button>
          {r.archived
            ? <button role="menuitem" type="button" onClick={() => { m.close(); onArchive(false); }}><ArchiveRestore size={14} aria-hidden /> Restore from Archive</button>
            : <button role="menuitem" type="button" onClick={() => { m.close(); onArchive(true); }}><Archive size={14} aria-hidden /> Move to Archive</button>}
          {canCancel && <><div className="sep" /><button role="menuitem" type="button" className="danger" onClick={() => { m.close(); onCancel(); }}><XCircle size={14} aria-hidden /> {s ? "Cancel Shipment" : "Cancel Order"}</button></>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- cells

function TrackingCell({ r, open }: { r: OrderRow; open: (d: DialogState) => void }) {
  const s = r.shipment;
  if (!s) return r.orderStatus === "cancelled" ? <span className="small muted">Order cancelled</span> : <div className="small"><span className="muted">Not shipped yet</span><div><Link className="ov-link" href={r.orderStatus === "draft" ? `/portal/orders/new/?draft=${r.id}` : `/portal/orders/${r.id}/`}>{r.orderStatus === "draft" ? "Edit draft →" : "Assign Courier →"}</Link></div></div>;
  const logo = carrierLogo(s.carrierCode);
  return (
    <div>
      <div className="row" style={{ gap: 6 }}>{logo && <img src={logo} alt="" width={22} height={22} style={{ objectFit: "contain" }} />}<span>{s.carrierName} {s.serviceName && s.serviceName !== s.carrierName ? <span className="muted">· {s.serviceName}</span> : null}</span></div>
      <div className="ov-awb">AWB: {s.awb
        ? <><button type="button" className="ov-amt" style={{ textDecoration: "none" }} onClick={() => open({ kind: "track", shipmentId: s.id })} aria-label={`Track AWB ${s.awb}`}>{s.awb}</button><CopyBtn value={s.awb} label="AWB" /></>
        : <span className="ov-badge orange">AWB Pending</span>}</div>
      {s.lr && <div className="ov-awb">LR Number: <span className="mono">{s.lr}</span><CopyBtn value={s.lr} label="LR number" /></div>}
      <div>Status: <b>{statusLabel(s.status)}</b></div>
      {(s.lastLocation || s.lastEventAt) && <div className="tiny muted">{s.lastLocation ?? "—"}{s.lastEventAt ? ` · ${istDate(s.lastEventAt)} ${istTime(s.lastEventAt)}` : ""}</div>}
      {s.awb && !["delivered", "rto_delivered", "cancelled"].includes(s.status) && (
        s.lastSyncError
          ? <button type="button" className="ov-sync bad ov-copy" style={{ padding: 0 }} onClick={() => open({ kind: "track", shipmentId: s.id })}>Sync failed{s.syncFailures > 1 ? ` (${s.syncFailures}×)` : ""} · Retry</button>
          : <div className="ov-sync">{s.lastSyncAt ? `Synced ${ago(s.lastSyncAt)}` : s.provider === "demo" ? "Demo courier · refresh on demand" : "Awaiting first courier sync"}</div>
      )}
    </div>
  );
}

function PaymentCell({ r, open }: { r: OrderRow; open: (d: DialogState) => void }) {
  return (
    <div>
      <div>Invoice: {inr(r.invoicePaise)}</div>
      {r.payment === "cod" && <div>COD: {inr(r.codPaise)}</div>}
      {r.payment === "fod" && <div>Receiver pays freight: {inr(r.receiverFreightPaise)}</div>}{r.payment === "fod" && r.codPaise > 0 && <div>COD to collect: {inr(r.codPaise)}</div>}
      <span className={`ov-badge ${r.payment === "cod" ? "navy" : r.payment === "fod" ? "orange" : "green"}`}>{paymentLabel(r.payment, r.codPaise)}</span>
      {r.chargedPaise != null && <div style={{ marginTop: 4 }}>Shipping:<br /><button type="button" className="ov-amt" onClick={() => open({ kind: "breakdown", row: r })} aria-label={`Shipping charge ${inr(r.chargedPaise)} — show breakdown`}>{inr(r.chargedPaise)}</button></div>}
    </div>
  );
}

function PackageCell({ r }: { r: OrderRow }) {
  const type = r.mode === "B2B" ? "B2B" : r.isMps ? "MPS" : "B2C";
  return (
    <div>
      <div>{r.boxes} Boxe(s) - <span className="ov-tag">({type})</span></div>
      <div>Dead wt. : {kg(r.actualGrams)}</div>
      <div>Volumetric: {kg(r.volumetricGrams)}</div>
      {r.packages.length > 0 && <div className="tiny muted">{r.packages.map((x) => `${x.count}× ${x.l}×${x.b}×${x.h} cm`).join(", ")}</div>}
      {r.chargeableGrams != null && <div className="small">Chargeable: <b>{kg(r.chargeableGrams)}</b></div>}
      {r.carrierGrams != null && <div className="small">Courier wt.: <b>{kg(r.carrierGrams)}</b></div>}
    </div>
  );
}

function ProductCell({ r }: { r: OrderRow }) {
  const [all, setAll] = useState(false);
  if (!r.products.length) return <span className="muted">—</span>;
  const list = all ? r.products : r.products.slice(0, 1);
  return (
    <div>
      {list.map((x, i) => <div key={i} style={i ? { marginTop: 6 } : undefined}><div>{x.name}</div><div>SKU: {x.sku || "--"}</div><div>QTY: {x.qty}</div></div>)}
      {r.products.length > 1 && <button type="button" className="ov-amt" style={{ fontWeight: 600, fontSize: 12 }} aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show less" : `+${r.products.length - 1} more`}</button>}
    </div>
  );
}

function CodLine({ r, label, open }: { r: OrderRow; label: string; open: (d: DialogState) => void }) {
  const c = codDisplay(r.cod);
  return (
    <div className="ov-cod">
      <span>{label}:</span>
      {c.buyer === "setup_required"
        ? <Link className="ov-codbtn t-warn" href="/portal/notifications/cod/"><Settings2 size={15} aria-hidden /> Setup</Link>
        : <button type="button" className="ov-codbtn" onClick={() => open({ kind: "cod", row: r })} title={c.reason}><MessageCircle size={14} aria-hidden /><CodStatusText s={c.buyer} /></button>}
      {c.cancellation && <button type="button" className="ov-codbtn" onClick={() => open({ kind: "cod", row: r })}>· <CodStatusText s={c.cancellation} /></button>}
      {r.codResponse && r.codDecidedAt && <span className="tiny muted">“{r.codResponse === "confirm" ? "Confirm Order" : "Cancel Order"}” · {istDate(r.codDecidedAt)} {istTime(r.codDecidedAt)}</span>}
      {c.buyer === "disabled" && <Link className="tiny ov-link" href="/portal/notifications/cod/">Turn on</Link>}
    </div>
  );
}

function Addr({ a }: { a: OrderRow["consignee"] }) {
  return (
    <div className="ov-addr">
      <div>{a.name}</div>
      {a.mobile && <div>{a.mobile}</div>}
      <div>{[a.line1, a.line2, a.district, a.city, a.state].filter(Boolean).join(", ")}{a.pincode ? `, ${a.pincode}` : ""}</div>
    </div>
  );
}

function DesktopRow({ r, show, colCount, selected, onToggle, codLabel, open, busy, onLabel, onCancel, onArchive, onMenu }: {
  r: OrderRow; show: (c: OptionalColumn) => boolean; colCount: number; selected: boolean; onToggle: () => void; codLabel: string; open: (d: DialogState) => void; busy: string | null;
  onLabel: (f: PrintFormat) => void; onCancel: () => void; onArchive: (on: boolean) => void; onMenu: (o: boolean) => void;
}) {
  const b = bookingBadge(r);
  const s = r.shipment;
  return (
    <>
      <tr className={`orow${selected ? " sel" : ""}`}>
        <td><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select order ${r.orderNumber}`} /></td>
        {show("orderDate") && <td className="date">{istDate(r.createdAt)} | {istTime(r.createdAt)}<div className="b">{SOURCE[r.source] ?? r.source}</div></td>}
        <td className="ord">
          <Link className="ov-link" href={`/portal/orders/${r.id}/`}>{r.orderNumber}</Link>
          <div>Ref. ID: {r.externalOrderId ?? r.invoiceNumber ?? "--"}</div>
          <span className={`ov-badge ${b.cls}`}>{b.text}</span>
          {r.tags.length > 0 && <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>{r.tags.map((t) => <span key={t.id} className="ov-badge" style={{ background: t.color, color: "#fff" }}><Tag size={10} aria-hidden /> {t.name}</span>)}</div>}
        </td>
        {show("product") && <td className="wrap"><ProductCell r={r} /></td>}
        {show("package") && <td><PackageCell r={r} /></td>}
        <td className="pay"><PaymentCell r={r} open={open} /></td>
        <td className="trk"><TrackingCell r={r} open={open} /></td>
        {show("shipping") && <td><Addr a={r.consignee} /></td>}
        {show("pickup") && <td>{r.pickup ? <button type="button" className="ov-pick" onClick={() => open({ kind: "pickup", row: r })}>{[r.pickup.label, r.pickup.city].filter(Boolean).join(", ")}{r.pickup.pincode ? `, ${r.pickup.pincode}` : ""}</button> : <span className="muted">—</span>}</td>}
        <td className="act">
          <div className="ov-track">
            {s?.awb
              ? <button type="button" className="ov-btn" onClick={() => open({ kind: "track", shipmentId: s.id })}><Truck size={15} aria-hidden /> Track</button>
              : <Link className="ov-btn" href={!s && r.orderStatus === "draft" ? `/portal/orders/new/?draft=${r.id}` : `/portal/orders/${r.id}/`} style={{ background: "var(--ov-orange)" }}>{s || r.orderStatus === "cancelled" ? "View" : r.orderStatus === "draft" ? "Edit Draft" : "Assign Courier"}</Link>}
            <RowMenu r={r} open={open} onLabel={onLabel} onCancel={onCancel} onArchive={onArchive} onMenu={onMenu} />
          </div>
          {busy === `cancel:${r.id}` && <div className="tiny muted" role="status">Cancelling…</div>}
        </td>
      </tr>
      {show("codLine") && <tr className={`osub${selected ? " sel" : ""}`}><td /><td colSpan={colCount - 1}><CodLine r={r} label={codLabel} open={open} /></td></tr>}
    </>
  );
}

function MobileCard({ r, selected, onToggle, open, defaultLabel, codLabel, onLabel, onCancel, onArchive, busy }: {
  r: OrderRow; selected: boolean; onToggle: () => void; open: (d: DialogState) => void; defaultLabel: PrintFormat; codLabel: string;
  onLabel: (f: PrintFormat) => void; onCancel: () => void; onArchive: (on: boolean) => void; busy: string | null;
}) {
  const s = r.shipment;
  const b = bookingBadge(r);
  const fmt = s?.labelFormats.find((x) => x.key === defaultLabel && x.ok) ?? s?.labelFormats.find((x) => x.ok);
  const canCancel = s ? s.cancellable : r.cancellableOrder;
  return (
    <article className="ov-mc" aria-label={`Order ${r.orderNumber}`} style={selected ? { borderColor: "var(--ov-orange)" } : undefined}>
      <div className="r">
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select order ${r.orderNumber}`} /><Link className="ov-link" href={`/portal/orders/${r.id}/`}>{r.orderNumber}</Link></label>
        <span className={`ov-badge ${b.cls}`}>{b.text}</span>
      </div>
      <div className="ov-awb">
        {s ? <><span className="muted small">AWB</span> {s.awb ? <><b className="mono">{s.awb}</b><CopyBtn value={s.awb} label="AWB" /></> : <span className="ov-badge orange">AWB Pending</span>}</> : <span className="muted small">Not shipped yet</span>}
      </div>
      {s?.lr && <div className="ov-awb small"><span className="muted">LR</span> <span className="mono">{s.lr}</span><CopyBtn value={s.lr} label="LR number" /></div>}
      {s && <div className="r small"><span>{s.carrierName}</span><b>{statusLabel(s.status)}</b></div>}
      <div className="grid2">
        <div><span>Recipient</span>{r.consignee.name}</div>
        <div><span>{r.payment === "cod" ? "COD value" : "Payment"}</span>{r.payment === "cod" ? inr(r.codPaise) : r.payment === "fod" ? `FOD · ${inr(r.receiverFreightPaise)}${r.codPaise > 0 ? ` + COD ${inr(r.codPaise)}` : ""}` : "Prepaid"}</div>
        <div><span>Shipping charged</span>{r.chargedPaise != null ? <button type="button" className="ov-amt" onClick={() => open({ kind: "breakdown", row: r })}>{inr(r.chargedPaise)}</button> : "—"}</div>
        <div><span>{codLabel}</span>{(() => { const c = codDisplay(r.cod); return c.buyer === "setup_required" ? <Link className="ov-link" href="/portal/notifications/cod/">Setup</Link> : <button type="button" className="ov-codbtn" style={{ padding: 0 }} onClick={() => open({ kind: "cod", row: r })}><CodStatusText s={c.buyer} />{c.cancellation ? <> · <CodStatusText s={c.cancellation} /></> : null}</button>; })()}</div>
      </div>
      <div className="btns">
        {s?.awb ? <button type="button" className="ov-btn navy" onClick={() => open({ kind: "track", shipmentId: s.id })}><Truck size={16} aria-hidden /> Track</button>
          : <Link className="ov-btn orange" href={!s && r.orderStatus === "draft" ? `/portal/orders/new/?draft=${r.id}` : `/portal/orders/${r.id}/`}>{s || r.orderStatus === "cancelled" ? "View order" : r.orderStatus === "draft" ? "Edit Draft" : "Assign Courier"}</Link>}
        {s?.awb && fmt && <button type="button" className="ov-btn ghost" onClick={() => onLabel(fmt.key)} disabled={busy === "labels"}><Download size={16} aria-hidden /> Download Label</button>}
      </div>
      <details>
        <summary>Products ({r.products.length})</summary>
        {r.products.map((x, i) => <div key={i} className="small">{x.name} · SKU {x.sku || "--"} · Qty {x.qty}</div>)}
      </details>
      <details>
        <summary>Package &amp; weights</summary>
        <div className="small"><PackageCell r={r} /></div>
      </details>
      <details>
        <summary>Delivery address</summary>
        <div className="small"><Addr a={r.consignee} /></div>
      </details>
      <details>
        <summary>Pickup address</summary>
        <div className="small">{r.pickup ? <>{r.pickup.label}<br />{[r.pickup.line1, r.pickup.line2, r.pickup.city, r.pickup.state, r.pickup.pincode].filter(Boolean).join(", ")}{r.pickup.contactName ? <><br />Contact: {r.pickup.contactName} {r.pickup.mobile}</> : null}</> : "—"}</div>
      </details>
      {s && (
        <details>
          <summary>Tracking</summary>
          <div className="small"><TrackingCell r={r} open={open} /></div>
        </details>
      )}
      <details>
        <summary>More actions</summary>
        <div className="btns" style={{ flexDirection: "column", alignItems: "stretch" }}>
          {s?.awb && s.labelFormats.map((x) => <button key={x.key} type="button" className="ov-btn ghost sm" disabled={!x.ok} onClick={() => onLabel(x.key)} title={x.reason}>Label · {x.name}{!x.ok ? " (unavailable)" : ""}</button>)}
          {s && <a className="ov-btn ghost sm" href={`/api/portal/shipments/${s.id}/invoice`} target="_blank" rel="noopener">Download invoice</a>}
          {s && <Link className="ov-btn ghost sm" href={`/portal/billing/shipment/${s.id}/`}>Vishwaship GST invoice</Link>}
          <Link className="ov-btn ghost sm" href={`/portal/orders/${r.id}/`}>View Order Details</Link>
          <button type="button" className="ov-btn ghost sm" onClick={() => onArchive(!r.archived)}>{r.archived ? "Restore from Archive" : "Move to Archive"}</button>
          {canCancel && <button type="button" className="ov-btn ghost sm" style={{ color: "var(--red)" }} onClick={onCancel}>{s ? "Cancel Shipment" : "Cancel Order"}</button>}
        </div>
      </details>
      <div className="tiny muted">{istDate(r.createdAt)} {istTime(r.createdAt)} · {SOURCE[r.source] ?? r.source}</div>
    </article>
  );
}

function SimpleCard({ r, selected, onToggle, onCancel, onClone, busy }: { r: OrderRow; selected: boolean; onToggle: () => void; onCancel: () => void; onClone: () => void; busy: string | null }) {
  const s = r.shipment;
  const b = bookingBadge(r);
  const canCancel = s ? s.cancellable : r.cancellableOrder;
  const pay = r.payment === "cod" ? <>COD <b>{inr(r.codPaise)}</b></> : r.payment === "fod" ? <>FOD <b>{inr(r.receiverFreightPaise)}</b>{r.codPaise > 0 && <> + COD <b>{inr(r.codPaise)}</b></>}</> : <>Prepaid</>;
  const ticket = `/portal/support/new/?order=${encodeURIComponent(r.orderNumber)}${s?.awb ? `&awb=${encodeURIComponent(s.awb)}` : ""}`;
  return (
    <article className="ov-sc" aria-label={`Order ${r.orderNumber}`} data-selected={selected || undefined}>
      <div className="ov-sc-top">
        <label className="ov-sc-id"><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select order ${r.orderNumber}`} />
          <Link href={!s && r.orderStatus === "draft" ? `/portal/orders/new/?draft=${r.id}` : `/portal/orders/${r.id}/`}>{r.orderNumber}</Link></label>
        <span className={`ov-badge ${b.cls}`}>{b.text}</span>
      </div>
      <div className="ov-sc-mid">
        <span className={`ov-pay ${r.payment}`}>{pay}</span>
        <span className="tiny muted">{istDate(r.createdAt)}</span>
      </div>
      <div className="ov-sc-act">
        {canCancel && <button type="button" className="ov-btn ghost sm" onClick={onCancel}>{s ? "Cancel shipment" : "Cancel"}</button>}
        <button type="button" className="ov-btn ghost sm" onClick={onClone} disabled={busy === "clone"}>Clone</button>
        <Link className="ov-btn ghost sm" href={ticket}>Raise ticket</Link>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- order card (mobile + desktop)


function ShipCard({ r, selected, onToggle, open, defaultLabel, onLabel, onCancel, onClone, onArchive, busy, onMenu }: {
  r: OrderRow; selected: boolean; onToggle: () => void; open: (d: DialogState) => void; defaultLabel: PrintFormat;
  onLabel: (f: PrintFormat) => void; onCancel: () => void; onClone: () => void; onArchive: (on: boolean) => void; busy: string | null; onMenu: (o: boolean) => void;
}) {
  const s = r.shipment;
  const b = bookingBadge(r);
  const fmt = s?.labelFormats.find((x) => x.key === defaultLabel && x.ok) ?? s?.labelFormats.find((x) => x.ok);
  const kind = r.isMps ? "MPS" : r.mode;
  const status = orderStatusText(r);
  const amount = r.payment === "cod" ? r.codPaise : r.payment === "fod" ? r.receiverFreightPaise : r.invoicePaise;
  const detail = !s && r.orderStatus === "draft" ? `/portal/orders/new/?draft=${r.id}` : `/portal/orders/${r.id}/`;
  return (
    <article className="oc" aria-label={`Order ${r.orderNumber}`} data-selected={selected || undefined}>
      <header className="oc-top">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select order ${r.orderNumber}`} />
        <Package size={20} aria-hidden className="oc-ico" />
        <Link className="oc-id" href={detail}>#{r.orderNumber}</Link>
        <CopyBtn value={r.orderNumber} label="Order ID" />
        <span className="oc-kind">({kind})</span>
        <ActionMenu r={r} open={open} onLabel={onLabel} onCancel={onCancel} onClone={onClone} onArchive={onArchive} onMenu={onMenu} />
      </header>
      <div className="oc-mid">
        <div className="oc-svc">{s ? (s.serviceName && s.serviceName !== s.carrierName ? `${s.carrierName} ${s.serviceName}` : s.carrierName) : "Courier not assigned"}</div>
        {s && (
          <div className="oc-awb">AWB:{" "}
            {s.awb ? <><button type="button" className="oc-link" onClick={() => open({ kind: "track", shipmentId: s.id })} aria-label={`Track AWB ${s.awb}`}>{s.awb}</button><CopyBtn value={s.awb} label="AWB" /></> : <span className="muted">Pending</span>}
          </div>
        )}
        <div>Status: <span className={`oc-st ${status.tone}`}>{status.text}</span></div>
        {s?.lastLocation && <div className="tiny muted">{s.lastLocation}{s.lastEventAt ? ` · ${istDate(s.lastEventAt)} ${istTime(s.lastEventAt)}` : ""}</div>}
      </div>
      <div className="oc-row">
        <UserRound size={30} aria-hidden className="oc-ico" />
        <div className="oc-who"><b>{r.consignee.name || "—"}</b><span>{r.consignee.mobile ?? ""}</span></div>
        <span className={`oc-pay ${r.payment}`}>{paymentLabel(r.payment, r.codPaise)}</span>
        <b className="oc-amt">{inr(amount)}</b>
      </div>
      <footer className="oc-foot">
        <div className="small">Order Date: {istDate(r.createdAt)} | {istTime(r.createdAt)}<br />Channel: <span className="oc-chan">{SOURCE[r.source] ?? r.source}</span></div>
        {s?.awb
          ? <LabelSplit formats={s.labelFormats} main={fmt?.key ?? "a4_fit"} onLabel={onLabel} busy={busy === "labels"} cartons={Math.max(r.boxes, s.pieces)} onMenu={onMenu} />
          : r.orderStatus === "cancelled" || s ? <Link className="oc-btn ghost" href={detail}>View</Link>
          : <Link className="oc-btn" href={detail}>{r.orderStatus === "draft" ? "Edit Draft" : "Assign Courier"}</Link>}
      </footer>
      {busy === `cancel:${r.id}` && <div className="tiny muted" role="status">Cancelling…</div>}
    </article>
  );
}

/** Sizes offered on the Label button: one A4 print (a shipment's labels on one sheet, up to 4) and the thermal rolls. */
const LABEL_CHOICES: Array<{ group: string; items: Array<{ key: PrintFormat; name: string }> }> = [
  { group: "A4 print", items: [{ key: "a4_fit", name: "A4 print (up to 4 labels per sheet)" }] },
  { group: "Thermal printer", items: [
    { key: "thermal_4x6", name: "4 × 6 in" }, { key: "thermal_3x4", name: "3 × 4 in" }, { key: "thermal_38x100", name: "100 × 38 mm" }, { key: "thermal_38x200", name: "200 × 38 mm" },
  ] },
  { group: "Courier label", items: [{ key: "original", name: "Courier's original label" }] },
];
const LABEL_KEYS = LABEL_CHOICES.flatMap((g) => g.items.map((i) => i.key));

/** Orange "Label" button: the main part downloads the default (A4 print); the arrow opens the sizes. */
function LabelSplit({ formats, main, onLabel, busy, cartons, onMenu }: { formats: Array<{ key: PrintFormat; name: string; ok: boolean; reason?: string }>; main: PrintFormat; onLabel: (f: PrintFormat) => void; busy: boolean; cartons: number; onMenu: (o: boolean) => void }) {
  const m = useFixedMenu(onMenu);
  const ok = (k: PrintFormat) => formats.find((x) => x.key === k) ?? (k === "original" ? undefined : { key: k, name: k, ok: true });
  // owner rule: the Label button always prints the A4 sheet; other sizes are in the arrow menu
  void main;
  const first = LABEL_KEYS.find((k) => ok(k)?.ok) ?? "a4_fit";
  return (
    <div ref={m.ref} className="oc-split">
      <button type="button" className="oc-btn main" onClick={() => onLabel(first)} disabled={busy} title={PRINT_FORMATS.find((x) => x.key === first)?.name}>Label</button>
      <button ref={m.btn} type="button" className="oc-btn caret" aria-label="Choose label size" aria-haspopup="menu" aria-expanded={!!m.pos} onClick={m.toggle} disabled={busy}><ChevronDown size={16} aria-hidden /></button>
      {m.pos && (
        <div className="ov-menu" role="menu" style={m.pos}>
          {cartons > 1 && <span className="hd">{cartons} cartons</span>}
          {LABEL_CHOICES.map((g, gi) => {
            const items = g.items.filter((i) => ok(i.key));
            if (!items.length) return null;
            return (
              <div key={g.group} role="group" aria-label={g.group}>
                {gi > 0 && <div className="sep" />}
                <span className="hd">{g.group}</span>
                {items.map((i) => { const f = ok(i.key)!; return (
                  <button key={i.key} role="menuitem" type="button" disabled={!f.ok} onClick={() => { m.close(); onLabel(i.key); }}>
                    <Download size={14} aria-hidden /><span>{i.name}{i.key === first && <span className="why">Default</span>}{f.reason && <span className="why">{f.reason}</span>}</span>
                  </button>
                ); })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function alertBox(text: string) {
  const d = document.createElement("div"); d.className = "ov-toast bad"; d.setAttribute("role", "alert"); d.textContent = text;
  document.body.appendChild(d); setTimeout(() => d.remove(), 7000);
}

function ActionMenu({ r, open, onLabel, onCancel, onClone, onArchive, onMenu }: { r: OrderRow; open: (d: DialogState) => void; onLabel: (f: PrintFormat) => void; onCancel: () => void; onClone: () => void; onArchive: (on: boolean) => void; onMenu: (o: boolean) => void }) {
  const m = useFixedMenu(onMenu);
  const s = r.shipment;
  const canCancel = s ? s.cancellable : r.cancellableOrder;
  const editable = !s && ["draft", "ready", "booking_failed"].includes(r.orderStatus);
  const go = (fn: () => void) => () => { m.close(); fn(); };
  return (
    <div ref={m.ref} className="oc-more">
      <button ref={m.btn} type="button" className="oc-dots" aria-label={`Actions for ${r.orderNumber}`} aria-haspopup="menu" aria-expanded={!!m.pos} onClick={m.toggle}><MoreHorizontal size={22} aria-hidden /></button>
      {m.pos && (
        <div className="ov-menu" role="menu" style={m.pos}>
          {editable
            ? <Link role="menuitem" href={`/portal/orders/new/?draft=${r.id}`}><Pencil size={14} aria-hidden /> Edit order</Link>
            : <button role="menuitem" type="button" disabled><Pencil size={14} aria-hidden /><span>Edit order<span className="why">Not possible after the courier is assigned</span></span></button>}
          <button role="menuitem" type="button" onClick={go(onClone)}><CopyPlus size={14} aria-hidden /> Clone order</button>
          {s?.awb && s.status !== "cancelled" && <button role="menuitem" type="button" onClick={go(() => { void openManifest({ shipmentId: s.id }).then((r) => { if (!r.ok) alertBox(r.message); }); })}><ClipboardList size={14} aria-hidden /> Download manifest</button>}
          {s && <a role="menuitem" href={`/api/portal/shipments/${s.id}/invoice`} target="_blank" rel="noopener" onClick={() => m.close()}><FileText size={14} aria-hidden /> Download invoice</a>}
          {s && <Link role="menuitem" href={`/portal/billing/shipment/${s.id}/`} onClick={() => m.close()}><Receipt size={14} aria-hidden /> Vishwaship GST invoice</Link>}
          <Link role="menuitem" href={`/portal/orders/${r.id}/`}><Eye size={14} aria-hidden /> View details</Link>
          {canCancel && <><div className="sep" /><button role="menuitem" type="button" className="danger" onClick={go(onCancel)}><XCircle size={14} aria-hidden /> {s ? "Cancel shipment" : "Cancel order"}</button></>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pagination

function Pager({ total, page, pages, pageSize, href, onSize }: { total: number; page: number; pages: number; pageSize: number; href: (p: Record<string, string | undefined>, keep?: boolean) => string; onSize: (n: number) => void }) {
  const nums = useMemo(() => {
    const s = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
    return [...s].sort((a, b) => a - b);
  }, [page, pages]);
  const link = (n: number) => href({ page: n === 1 ? undefined : String(n) }, true);
  return (
    <div className="ov-pager">
      <span className="small muted">{total.toLocaleString("en-IN")} result{total === 1 ? "" : "s"} · page {page} of {pages}</span>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label className="row small" style={{ gap: 8 }}>Data per page
          <select className="ov-field" style={{ height: 36 }} value={pageSize} onChange={(e) => onSize(Number(e.target.value))}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <nav aria-label="Pagination">
          <Link href={link(1)} className={page <= 1 ? "dis" : ""} aria-label="First page"><ChevronsLeft size={16} aria-hidden /></Link>
          <Link href={link(Math.max(1, page - 1))} className={page <= 1 ? "dis" : ""} aria-label="Previous page"><ChevronLeft size={16} aria-hidden /></Link>
          {nums.map((n, i) => (
            <span key={n} style={{ display: "contents" }}>
              {i > 0 && n - nums[i - 1] > 1 && <span aria-hidden>…</span>}
              {n === page ? <span className="cur" aria-current="page">{n}</span> : <Link href={link(n)} aria-label={`Page ${n}`}>{n}</Link>}
            </span>
          ))}
          <Link href={link(Math.min(pages, page + 1))} className={page >= pages ? "dis" : ""} aria-label="Next page"><ChevronRight size={16} aria-hidden /></Link>
          <Link href={link(pages)} className={page >= pages ? "dis" : ""} aria-label="Last page"><ChevronsRight size={16} aria-hidden /></Link>
        </nav>
      </div>
    </div>
  );
}

