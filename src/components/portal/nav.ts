import {
  Calculator, CornerUpLeft, FileDown, Home, MapPin, MessageSquare, Package, Plug, Ticket, Truck, Wallet,
} from "lucide-react";

export const CUSTOMER_NAV = [
  { href: "/portal/", label: "Dashboard", icon: Home },
  { href: "/portal/orders/", label: "Orders", icon: Package },
  { href: "/portal/ndr/", label: "NDR & RTO", icon: CornerUpLeft },
  { href: "/portal/billing/", label: "Wallet & Billing", icon: Wallet },
  { href: "/portal/rates/", label: "Rate Calculator", icon: Calculator },
  { href: "/portal/track/", label: "Track Shipment", icon: Truck },
  { href: "/portal/addresses/", label: "Pickup Addresses", icon: MapPin },
  { href: "/portal/notifications/", label: "Shipping Notifications", icon: MessageSquare },
  { href: "/portal/integrations/", label: "Integrations", icon: Plug },
  { href: "/portal/reports/", label: "Reports", icon: FileDown },
  { href: "/portal/support/", label: "Support", icon: Ticket },
];
