import {
  BadgeCheck, Calculator, CornerUpLeft, CreditCard, FileDown, Home, MapPin, MessageSquare, Package, Palette, Plug, Settings, Ticket, Truck, Upload, Wallet, Wrench,
} from "lucide-react";
import type { ModuleKey } from "@/lib/modules";

type Icon = typeof Home;
export type NavLink = { href: string; label: string; icon: Icon; module?: ModuleKey };
export type NavEntry = NavLink | { group: string; icon: Icon; items: NavLink[] };

/** Customer sidebar. Entries with `module` are hidden when Admin has that module off for the account. */
export const CUSTOMER_NAV_GROUPS: NavEntry[] = [
  { href: "/portal/", label: "Dashboard", icon: Home },
  { href: "/portal/orders/", label: "Orders", icon: Package },
  { href: "/portal/ndr/", label: "NDR & RTO", icon: CornerUpLeft },
  { group: "Billing", icon: CreditCard, items: [
    { href: "/portal/billing/", label: "Wallet & Billing", icon: Wallet },
  ] },
  { group: "Tools", icon: Wrench, items: [
    { href: "/portal/rates/", label: "Rate Calculator", icon: Calculator },
    { href: "/portal/track/", label: "Track Order", icon: Truck, module: "tracking" },
    { href: "/portal/orders/bulk/", label: "Bulk Upload", icon: Upload, module: "bulk_upload" },
  ] },
  { href: "/portal/reports/", label: "Reports", icon: FileDown, module: "reports" },
  { href: "/portal/addresses/", label: "Warehouse", icon: MapPin, module: "warehouses" },
  { group: "Settings", icon: Settings, items: [
    { href: "/portal/notifications/", label: "Shipping Notifications", icon: MessageSquare },
    { href: "/portal/notifications/cod/", label: "COD Confirmation", icon: BadgeCheck },
    { href: "/portal/settings/tracking-page/", label: "Tracking Page", icon: Palette, module: "branded_tracking" },
  ] },
  { href: "/portal/integrations/", label: "Integrations", icon: Plug },
  { href: "/portal/support/", label: "Support", icon: Ticket },
];

const isGroup = (e: NavEntry): e is Extract<NavEntry, { group: string }> => "group" in e;

/** Visible entries for an account's enabled modules (empty groups dropped). */
export function visibleNav(enabled: readonly string[]): NavEntry[] {
  const ok = (l: NavLink) => !l.module || enabled.includes(l.module);
  return CUSTOMER_NAV_GROUPS.flatMap((e): NavEntry[] => {
    if (!isGroup(e)) return ok(e) ? [e] : [];
    const items = e.items.filter(ok);
    return items.length ? [{ ...e, items }] : [];
  });
}

export const flatNav = (entries: NavEntry[]): NavLink[] => entries.flatMap((e) => (isGroup(e) ? e.items : [e]));
export { isGroup as isNavGroup };

/** Flat list kept for the mobile "More" page (all links; the page filters by module itself). */
export const CUSTOMER_NAV = flatNav(CUSTOMER_NAV_GROUPS);
