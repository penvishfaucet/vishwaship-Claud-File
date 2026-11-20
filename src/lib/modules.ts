/**
 * Feature modules that Admin can switch on/off globally, per plan, or per customer.
 * `default` = enabled when no plan/override says otherwise.
 * `needsPlan` = only available through an active subscription plan (or an explicit customer override).
 */
export const MODULES = [
  { key: "warehouses", label: "Warehouses & pickup addresses", default: true, needsPlan: false },
  { key: "reports", label: "Reports & downloads", default: true, needsPlan: false },
  { key: "tracking", label: "Shipment tracking", default: true, needsPlan: false },
  { key: "branded_tracking", label: "Branded tracking page", default: true, needsPlan: false },
  { key: "bulk_upload", label: "Bulk order upload", default: true, needsPlan: false },
  { key: "store_channels", label: "Store channels (Shopify / WooCommerce)", default: true, needsPlan: false },
  { key: "api_integration", label: "API integration", default: true, needsPlan: false },
  { key: "whatsapp_notifications", label: "WhatsApp notifications", default: false, needsPlan: true },
  { key: "early_cod", label: "Early COD remittance", default: true, needsPlan: false },
  { key: "auto_assign", label: "Courier auto-assign rules", default: true, needsPlan: false },
  { key: "oms", label: "OMS connections", default: true, needsPlan: false },
  { key: "edd_widget", label: "EDD widget", default: true, needsPlan: false },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];

/** Notification events a plan can include. */
export const NOTIFICATION_EVENTS = [
  { key: "whatsapp:out_for_delivery", label: "WhatsApp — Out for Delivery", module: "whatsapp_notifications" },
  { key: "whatsapp:cod_confirmation", label: "WhatsApp — COD Confirmation (Confirm / Cancel)", module: "whatsapp_notifications" },
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];

export const moduleLabel = (k: string) => MODULES.find((m) => m.key === k)?.label ?? k;
