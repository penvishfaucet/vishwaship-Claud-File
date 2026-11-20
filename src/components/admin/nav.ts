import {
  Activity, AlertTriangle, BadgeIndianRupee, Banknote, Bell, CreditCard, Boxes, FileSpreadsheet, Truck as TruckIcon, FileText, Layers, Mail, MapPin, MessageCircle, Palette, KeyRound, CornerUpLeft, FileDown, Home, Package, Plug, Scale, ScrollText, ShieldCheck, Store, Tags, Ticket, Truck, Users, Wallet, TrendingUp,
} from "lucide-react";
import type { Permission } from "@/server/auth/rbac";

export const ADMIN_NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: typeof Home; perm: Permission }> }> = [
  { group: "OPERATIONS", items: [
    { href: "/admin/", label: "Dashboard", icon: Home, perm: "shipments.read" },
    { href: "/admin/shipments/", label: "All Shipments", icon: Package, perm: "shipments.read" },
    { href: "/admin/pickups/", label: "Pickups", icon: Truck, perm: "shipments.read" },
    { href: "/admin/ndr/", label: "NDR / RTO", icon: CornerUpLeft, perm: "shipments.read" },
    { href: "/admin/disputes/", label: "Weight Disputes", icon: Scale, perm: "shipments.read" },
    { href: "/admin/order-exceptions/", label: "Order Exceptions", icon: AlertTriangle, perm: "shipments.read" },
    { href: "/admin/tickets/", label: "Tickets", icon: Ticket, perm: "tickets.read" },
  ] },
  { group: "CUSTOMERS", items: [
    { href: "/admin/customers/", label: "Customers", icon: Users, perm: "customers.read" },
    { href: "/admin/kyc/", label: "KYC", icon: ShieldCheck, perm: "kyc.review" },
    { href: "/admin/plans/", label: "Plans & Features", icon: Layers, perm: "customers.read" },
    { href: "/admin/warehouses/", label: "Warehouses", icon: MapPin, perm: "customers.read" },
    { href: "/admin/tracking-pages/", label: "Tracking Pages", icon: Palette, perm: "customers.read" },
    { href: "/admin/online-stores/", label: "Online Stores", icon: Store, perm: "customers.read" },
  ] },
  { group: "FINANCE", items: [
    { href: "/admin/pricing/", label: "Pricing", icon: Tags, perm: "pricing.read" },
    { href: "/admin/pnl/", label: "Profit & Loss", icon: TrendingUp, perm: "shipments.cost.read" },
    { href: "/admin/finance/", label: "Wallets", icon: Wallet, perm: "finance.read" },
    { href: "/admin/recharges/", label: "Wallet Recharges", icon: Banknote, perm: "finance.read" },
    { href: "/admin/cod-remittance/", label: "COD & Early COD", icon: BadgeIndianRupee, perm: "finance.read" },
    { href: "/admin/billing-documents/", label: "Invoices & Notes", icon: FileSpreadsheet, perm: "finance.read" },
    { href: "/admin/couriers/", label: "Couriers & Rate Cards", icon: TruckIcon, perm: "pricing.read" },
    { href: "/admin/reports/", label: "Reports", icon: FileDown, perm: "reports.export" },
  ] },
  { group: "SETTINGS", items: [
    { href: "/admin/services/", label: "API Keys & Services", icon: KeyRound, perm: "integrations.read" },
    { href: "/admin/integrations/", label: "Integrations", icon: Plug, perm: "integrations.read" },
    { href: "/admin/payments/", label: "Payment Settings", icon: CreditCard, perm: "integrations.read" },
    { href: "/admin/carriers/", label: "Courier Integrations", icon: TruckIcon, perm: "integrations.read" },
    { href: "/admin/oms/", label: "OMS Requests", icon: Boxes, perm: "integrations.read" },
    { href: "/admin/notifications/", label: "Notifications", icon: Bell, perm: "notifications.read" },
    { href: "/admin/whatsapp/", label: "WhatsApp Ops", icon: MessageCircle, perm: "notifications.read" },
    { href: "/admin/settings/email/", label: "Email & Sign-in", icon: Mail, perm: "notifications.read" },
    { href: "/admin/website/", label: "Website Content", icon: Palette, perm: "customers.read" },
    { href: "/admin/content/", label: "Portal Text", icon: FileText, perm: "customers.read" },
    { href: "/admin/api-credentials/", label: "API Credentials", icon: KeyRound, perm: "api_keys.manage" },
    { href: "/admin/staff/", label: "Staff & Roles", icon: Activity, perm: "staff.manage" },
    { href: "/admin/audit/", label: "Audit Log", icon: ScrollText, perm: "audit.read" },
  ] },
];
