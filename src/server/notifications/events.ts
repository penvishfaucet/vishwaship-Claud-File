/** Buyer-facing shipment events + template variable allowlist (spec section 8). */
export const NOTIFY_EVENTS = [
  { key: "pickup_pending", label: "Pickup pending" },
  { key: "picked_up", label: "Pickup completed" },
  { key: "in_transit", label: "In transit" },
  { key: "at_delivery_center", label: "At delivery center" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
  { key: "ndr", label: "Undelivered / NDR" },
  { key: "cancelled", label: "Cancelled" },
  { key: "rto_initiated", label: "RTO started" },
  { key: "rto_delivered", label: "RTO delivered" },
] as const;

export const CHANNELS = ["email", "sms", "whatsapp", "webhook"] as const;
export type Channel = (typeof CHANNELS)[number];

export const TEMPLATE_VARS = ["merchant_name", "order_id", "awb", "carrier", "status", "tracking_link", "buyer_name", "cod_amount"] as const;

export const DEFAULT_TEMPLATE = (event: string) =>
  `Hi, your order {{order_id}} from {{merchant_name}} is now "${event}". Courier: {{carrier}}, AWB {{awb}}. Track: {{tracking_link}}`;

/** Reject templates that reference variables outside the allowlist. */
export function validateTemplate(body: string): string | null {
  const used = [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  const bad = used.filter((v) => !(TEMPLATE_VARS as readonly string[]).includes(v));
  return bad.length ? `Unknown variable(s): ${[...new Set(bad)].join(", ")}` : null;
}

export function renderTemplate(body: string, vars: Partial<Record<(typeof TEMPLATE_VARS)[number], string>>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars as Record<string, string>)[k] ?? "");
}
