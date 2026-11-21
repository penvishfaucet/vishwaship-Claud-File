import {
  Activity, BadgeCheck, BadgeIndianRupee, Bell, Boxes, Calculator, ClipboardList, CornerUpLeft, CreditCard, Download, FileMinus, FilePlus, FileSpreadsheet, FileText,
  Home, Layers, LayoutGrid, ListOrdered, MapPin, Package, Palette, Plug, Printer, Receipt, ReceiptText, Scale, Settings, ShoppingBag, Store, Tag, Timer, Truck,
  Users, Wallet, Webhook, Wrench, Zap, BookOpen, Globe, Link2, FileBarChart, Gauge, CalendarClock, MessagesSquare, Megaphone,
} from "lucide-react";
import type { ModuleKey } from "@/lib/modules";

type Icon = typeof Home;
/** `id` is also the CMS key (`nav.<id>`) Admin uses to rename the entry. */
export type NavLink = { id: string; href: string; label: string; icon: Icon; module?: ModuleKey };
export type NavGroup = { id: string; group: string; icon: Icon; items: NavLink[] };
export type NavEntry = NavLink | NavGroup;

/**
 * Customer sidebar — exact order of the reference screenshots (10 main items, 35 sub-items).
 * Order never changes when a feature is locked; locked plan features show a lock instead.
 */
export const CUSTOMER_NAV_GROUPS: NavEntry[] = [
  { id: "dashboard", href: "/portal/", label: "Dashboard", icon: Home },
  { id: "orders", href: "/portal/orders/", label: "Orders", icon: Package },
  { id: "pickups", href: "/portal/pickups/", label: "Pickups", icon: CalendarClock },
  { id: "ndr", href: "/portal/ndr/", label: "NDR", icon: CornerUpLeft },
  { id: "store", group: "Online Store", icon: Globe, items: [
    { id: "store.overview", href: "/portal/store/", label: "Store Overview", icon: Store, module: "online_store" },
    { id: "store.orders", href: "/portal/store/orders/", label: "Store Orders", icon: ClipboardList, module: "online_store" },
    { id: "store.theme", href: "/portal/store/theme/", label: "Theme Editor", icon: Palette, module: "online_store" },
    { id: "store.products", href: "/portal/store/products/", label: "Store Products", icon: ShoppingBag, module: "online_store" },
    { id: "store.analytics", href: "/portal/store/analytics/", label: "Store Analytics", icon: FileBarChart, module: "online_store" },
    { id: "store.marketing", href: "/portal/store/marketing/", label: "Meta & Google", icon: Zap, module: "online_store" },
    { id: "store.managed_ads", href: "/portal/store/managed-ads/", label: "Managed Meta Ads", icon: Megaphone, module: "online_store" },
    { id: "store.coupons", href: "/portal/store/coupons/", label: "Coupons", icon: Tag, module: "online_store" },
    { id: "store.payments", href: "/portal/store/payments/", label: "Online Payments", icon: CreditCard, module: "online_store" },
    { id: "store.pages", href: "/portal/store/pages/", label: "Pages & SEO", icon: FileText, module: "online_store" },
    { id: "store.domains", href: "/portal/store/domains/", label: "Domains", icon: Link2, module: "online_store" },
    { id: "store.plan", href: "/portal/store/plan/", label: "Store Plan", icon: BadgeIndianRupee, module: "online_store" },
  ] },
  { id: "billing", group: "Billing", icon: CreditCard, items: [
    { id: "billing.passbook", href: "/portal/billing/passbook/", label: "Passbook", icon: BookOpen },
    { id: "billing.cod", href: "/portal/billing/cod-remittance/", label: "COD Remittance", icon: BadgeIndianRupee },
    { id: "billing.charges", href: "/portal/billing/shipping-charges/", label: "Shipping Charges", icon: Receipt },
    { id: "billing.recharges", href: "/portal/billing/recharges/", label: "All Recharges", icon: Wallet },
    { id: "billing.invoices", href: "/portal/billing/invoices/", label: "Invoices", icon: FileText },
    { id: "billing.credit_notes", href: "/portal/billing/credit-notes/", label: "Credit Notes", icon: FilePlus },
    { id: "billing.debit_notes", href: "/portal/billing/debit-notes/", label: "Debit Notes", icon: FileMinus },
    { id: "billing.ledgers", href: "/portal/billing/ledgers/", label: "Ledgers", icon: ReceiptText },
    { id: "billing.credits", href: "/portal/billing/notification-credits/", label: "Notification Credit History", icon: Bell },
  ] },
  { id: "tools", group: "Tools", icon: Wrench, items: [
    { id: "tools.rates", href: "/portal/rates/", label: "Rate Calculator", icon: Calculator },
    { id: "tools.price_list", href: "/portal/tools/price-list/", label: "Shipment Price List", icon: ListOrdered },
    { id: "tools.activity", href: "/portal/tools/activity/", label: "Activity logs", icon: Activity },
    { id: "tools.couriers", href: "/portal/tools/couriers/", label: "Manage Courier", icon: Truck },
    { id: "tools.downloads", href: "/portal/tools/downloads/", label: "Report Download", icon: Download, module: "reports" },
    { id: "tools.track", href: "/portal/track/", label: "Track Order", icon: Gauge, module: "tracking" },
    { id: "tools.weight", href: "/portal/tools/weight-discrepancy/", label: "Weight Discrepancy", icon: Scale },
  ] },
  { id: "reports", group: "Reports", icon: FileBarChart, items: [
    { id: "reports.shipments", href: "/portal/reports/shipments/", label: "Shipment Report", icon: FileSpreadsheet, module: "reports" },
    { id: "reports.orders", href: "/portal/reports/orders/", label: "Orders Reports", icon: ClipboardList, module: "reports" },
    { id: "reports.ndr", href: "/portal/reports/ndr/", label: "NDR Reports", icon: CornerUpLeft, module: "reports" },
    { id: "reports.custom", href: "/portal/reports/custom/", label: "Custom Report", icon: Layers, module: "reports" },
  ] },
  { id: "settings", group: "Settings", icon: Settings, items: [
    { id: "settings.tracking", href: "/portal/settings/tracking-page/", label: "Branded Tracking Page", icon: Palette, module: "branded_tracking" },
    { id: "settings.label", href: "/portal/settings/label/", label: "Label Setting", icon: Printer },
    { id: "settings.invoice", href: "/portal/settings/invoice/", label: "Invoice settings", icon: FileText },
    { id: "settings.auto_assign", href: "/portal/settings/auto-assign/", label: "Auto-Assign Rule", icon: Zap, module: "auto_assign" },
    { id: "settings.notifications", href: "/portal/notifications/", label: "Shipping Notification", icon: Bell },
    { id: "settings.cod", href: "/portal/notifications/cod/", label: "COD Confirmation", icon: BadgeCheck },
    { id: "settings.early_cod", href: "/portal/settings/early-cod/", label: "Early COD Subscription", icon: Timer, module: "early_cod" },
  ] },
  { id: "warehouse", href: "/portal/addresses/", label: "Warehouse", icon: MapPin, module: "warehouses" },
  { id: "integrations", group: "Integrations", icon: Plug, items: [
    { id: "integrations.channels", href: "/portal/integrations/", label: "Order Channels", icon: Store, module: "store_channels" },
    { id: "integrations.oms", href: "/portal/integrations/oms/", label: "OMS", icon: LayoutGrid, module: "oms" },
    { id: "integrations.edd", href: "/portal/integrations/edd-widget/", label: "EDD Widget", icon: CalendarClock, module: "edd_widget" },
    { id: "integrations.api", href: "/portal/integrations/api/", label: "API Integration", icon: Webhook, module: "api_integration" },
    { id: "integrations.own", href: "/portal/integrations/own-apis/", label: "Own WhatsApp & AI calls", icon: MessagesSquare },
  ] },
  { id: "others", group: "Others", icon: Boxes, items: [
    { id: "others.customers", href: "/portal/others/customers/", label: "Customers", icon: Users },
    { id: "others.products", href: "/portal/others/products/", label: "Products", icon: ShoppingBag },
    { id: "others.packaging", href: "/portal/others/packaging/", label: "Packaging", icon: Package },
    { id: "others.tags", href: "/portal/others/tags/", label: "Order Tags", icon: Tag },
  ] },
];

export const isNavGroup = (e: NavEntry): e is NavGroup => "group" in e;
export const flatNav = (entries: NavEntry[]): NavLink[] => entries.flatMap((e) => (isNavGroup(e) ? e.items : [e]));
export const CUSTOMER_NAV = flatNav(CUSTOMER_NAV_GROUPS);

/** Every label Admin can rename (id → default label), groups included. */
export const NAV_LABEL_DEFAULTS: Record<string, string> = Object.fromEntries(
  CUSTOMER_NAV_GROUPS.flatMap((e) => (isNavGroup(e) ? [[e.id, e.group], ...e.items.map((i) => [i.id, i.label])] : [[e.id, e.label]])),
);

export type ModuleState = Record<string, { enabled: boolean; lockable: boolean }>;

/**
 * Apply feature access: enabled → normal; disabled plan feature → shown locked (upgrade);
 * disabled by Admin otherwise → hidden. Empty groups are dropped. Labels come from the CMS.
 */
export function visibleNav(mods: ModuleState, labels: Record<string, string>): Array<NavEntry & { locked?: boolean }> {
  const map = (l: NavLink): (NavLink & { locked?: boolean }) | null => {
    const label = labels[l.id] ?? l.label;
    if (!l.module) return { ...l, label };
    const m = mods[l.module];
    if (!m || m.enabled) return { ...l, label };
    return m.lockable ? { ...l, label, locked: true, href: `/portal/upgrade/?module=${l.module}` } : null;
  };
  return CUSTOMER_NAV_GROUPS.flatMap((e): Array<NavEntry & { locked?: boolean }> => {
    if (!isNavGroup(e)) { const x = map(e); return x ? [x] : []; }
    const items = e.items.map(map).filter((x): x is NavLink & { locked?: boolean } => !!x);
    return items.length ? [{ ...e, group: labels[e.id] ?? e.group, items }] : [];
  });
}

