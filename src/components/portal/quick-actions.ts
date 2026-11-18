import { Calculator, CalendarClock, LifeBuoy, MapPin, MessageCircleMore, PlusCircle, Truck, Upload, Wallet } from "lucide-react";
import type { ModuleState } from "./nav";

export type QuickAction = { id: string; label: string; icon: typeof PlusCircle; href?: string; action?: "chat"; primary?: boolean };

/** Event that opens the Support Chat sheet from anywhere in the portal. */
export const OPEN_CHAT_EVENT = "vs:open-support-chat";

/**
 * One list of shortcuts for the desktop header menu and the mobile Quick Actions sheet.
 * Entries tied to a module appear only when that module is enabled for the account.
 * (There is no separate "Record Order" flow — Add Order covers it.)
 */
export function quickActions(mods: ModuleState): QuickAction[] {
  const on = (k: string) => !mods[k] || mods[k].enabled;
  const all: Array<QuickAction & { module?: string }> = [
    { id: "add", label: "Add Order", icon: PlusCircle, href: "/portal/orders/new/", primary: true },
    { id: "rates", label: "Rate Calculator", icon: Calculator, href: "/portal/rates/", primary: true },
    { id: "bulk", label: "Bulk Upload Orders", icon: Upload, href: "/portal/orders/bulk/" },
    { id: "track", label: "Track Shipment", icon: Truck, href: "/portal/track/", module: "tracking" },
    { id: "pickup", label: "Schedule Pickup", icon: CalendarClock, href: "/portal/pickups/" },
    { id: "recharge", label: "Wallet Recharge", icon: Wallet, href: "/portal/billing/passbook/?recharge=1" },
    { id: "warehouse", label: "Add Warehouse", icon: MapPin, href: "/portal/addresses/?add=1", module: "warehouses" },
    { id: "ticket", label: "Raise Ticket", icon: LifeBuoy, href: "/portal/support/new/" },
    { id: "chat", label: "Support Chat", icon: MessageCircleMore, action: "chat" },
  ];
  return all.filter((a) => !a.module || on(a.module));
}
