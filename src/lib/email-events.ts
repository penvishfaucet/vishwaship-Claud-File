/**
 * Transactional email events: default subject/body, placeholders and default recipients.
 * Admin → Settings → Email can change template, sender, recipients and ON/OFF per event without a deploy.
 * Bodies are plain text with {{placeholders}}; the server wraps them in the branded layout (logo + button).
 */
export type EmailEventKey =
  | "signup_otp" | "password_reset_otp" | "shipment_picked_up" | "shipment_in_transit" | "shipment_out_for_delivery" | "shipment_delivered" | "shipment_rto" | "weight_discrepancy" | "courier_weight_dispute";

export type EmailEventDef = {
  key: EmailEventKey; label: string; audience: "signup" | "shipment";
  placeholders: string[]; secret?: string[]; subject: string; body: string;
  defaults: { enabled: boolean; toClient: boolean; toRecipient: boolean };
  /** Shipment status that triggers this email (confirmed courier tracking). */
  status?: string; button?: string;
};

const SHIP = ["customer_name", "order_id", "awb_number", "courier_name", "pickup_time", "status", "tracking_link"];
const shipBody = (line: string) => `Hello {{customer_name}},

${line}

Order ID: {{order_id}}
AWB number: {{awb_number}}
Courier partner: {{courier_name}}
Status: {{status}}

Track your shipment with the button below.

Team Vishwaship`;

export const EMAIL_EVENTS: EmailEventDef[] = [
  {
    key: "signup_otp", label: "Signup verification code (OTP)", audience: "signup", placeholders: ["customer_name", "otp", "otp_validity"], secret: ["otp"],
    subject: "{{otp}} is your Vishwaship verification code",
    body: `Hello,

Your Vishwaship verification code is:

{{otp}}

It is valid for {{otp_validity}}. Do not share this code with anyone — Vishwaship will never ask for it.

If you did not try to create a Vishwaship account, you can ignore this email.

Team Vishwaship`,
    defaults: { enabled: true, toClient: true, toRecipient: false },
  },
  {
    key: "password_reset_otp", label: "Forgot password code (OTP)", audience: "signup", placeholders: ["customer_name", "otp", "otp_validity"], secret: ["otp"],
    subject: "{{otp}} is your Vishwaship password reset code",
    body: `Hello {{customer_name}},

Use this code to reset your Vishwaship password:

{{otp}}

It is valid for {{otp_validity}}. Do not share this code with anyone — Vishwaship will never ask for it.

If you did not ask to reset your password, you can ignore this email; your password stays the same.

Team Vishwaship`,
    defaults: { enabled: true, toClient: true, toRecipient: false },
  },
  { key: "shipment_picked_up", label: "Shipment Picked Up", audience: "shipment", placeholders: SHIP, status: "picked_up", button: "Track Shipment",
    subject: "Picked up: order {{order_id}} (AWB {{awb_number}})", body: shipBody("Your shipment has been picked up by {{courier_name}} on {{pickup_time}}."),
    defaults: { enabled: true, toClient: true, toRecipient: false } },
  { key: "shipment_in_transit", label: "Shipment In Transit", audience: "shipment", placeholders: SHIP, status: "in_transit", button: "Track Shipment",
    subject: "In transit: order {{order_id}} (AWB {{awb_number}})", body: shipBody("Your shipment is on its way."),
    defaults: { enabled: false, toClient: true, toRecipient: false } },
  { key: "shipment_out_for_delivery", label: "Out for Delivery", audience: "shipment", placeholders: SHIP, status: "out_for_delivery", button: "Track Shipment",
    subject: "Out for delivery: order {{order_id}}", body: shipBody("Your shipment is out for delivery today."),
    defaults: { enabled: false, toClient: true, toRecipient: false } },
  { key: "shipment_delivered", label: "Delivered", audience: "shipment", placeholders: SHIP, status: "delivered", button: "View Shipment",
    subject: "Delivered: order {{order_id}}", body: shipBody("Your shipment has been delivered."),
    defaults: { enabled: false, toClient: true, toRecipient: false } },
  { key: "shipment_rto", label: "Returning to origin (RTO)", audience: "shipment", placeholders: SHIP, status: "rto_initiated", button: "Track Shipment",
    subject: "Return to origin: order {{order_id}}", body: shipBody("Your shipment could not be delivered and is returning to the pickup address."),
    defaults: { enabled: false, toClient: true, toRecipient: false } },
  { key: "weight_discrepancy", label: "Weight discrepancy (courier weight higher)", audience: "shipment", button: "View details / dispute",
    placeholders: ["customer_name", "order_id", "awb_number", "courier_name", "booked_weight", "courier_weight", "charge_details", "dispute_by", "tracking_link"],
    subject: "Weight discrepancy: order {{order_id}} (AWB {{awb_number}})",
    body: `Hello {{customer_name}},

The courier re-weighed your shipment and its charged weight is higher than the weight it was booked with.

Order ID: {{order_id}}
AWB number: {{awb_number}}
Courier partner: {{courier_name}}
Booked chargeable weight: {{booked_weight}}
Courier charged weight: {{courier_weight}}

{{charge_details}}

Team Vishwaship`,
    defaults: { enabled: true, toClient: true, toRecipient: false } },
  { key: "courier_weight_dispute", label: "Weight dispute sent to the courier (Admin → Weight Disputes → Send)", audience: "shipment",
    placeholders: ["lr_number", "courier_name", "booked_weight", "courier_weight", "claimed_weight", "reason", "photo_links"],
    subject: "Weight dispute — LR {{lr_number}}",
    body: `Dear {{courier_name}} team,

We dispute the revised charged weight for the shipment below and request that the original charged weight be restored.

LR number: {{lr_number}}
Charged weight at manifest: {{booked_weight}}
Revised charged weight (your re-weigh): {{courier_weight}}
Correct weight as per the shipper: {{claimed_weight}}

Shipper's remarks: {{reason}}

Photos / videos of the packed shipment (on a weighing scale, with dimensions):
{{photo_links}}

Please review and confirm.

Regards,
Team Vishwaship`,
    defaults: { enabled: true, toClient: false, toRecipient: false } },
];
export const eventDef = (k: string) => EMAIL_EVENTS.find((e) => e.key === k);
export const eventForStatus = (status: string) => EMAIL_EVENTS.find((e) => e.status === status || (e.key === "shipment_rto" && /^rto_/.test(status) && status !== "rto_delivered"));

/** Sample values for Admin preview / test email — never a real code or customer data. */
export const SAMPLE_VARS: Record<string, string> = {
  customer_name: "Asha Traders", otp: "123456", otp_validity: "10 minutes", order_id: "VSMWN9IO35EA", awb_number: "1234567890123",
  courier_name: "Delhivery", pickup_time: "19 Nov 2026, 04:30 pm", status: "Picked up", tracking_link: "https://vishwaship.in/track/?awb=1234567890123",
  booked_weight: "30.00 kg", courier_weight: "41.00 kg", dispute_by: "29 Nov 2026", lr_number: "323198958", claimed_weight: "30.00 kg",
  reason: "Box was 34 × 26 × 11 cm, 30 kg on our scale.", photo_links: "https://example.com/photo-1.jpg",
  charge_details: "Extra shipping charge for you: ₹177.87 (incl. GST). It will be debited from your Vishwaship wallet on 29 Nov 2026 unless you raise a dispute before then.\n\nIf you believe the courier weight is wrong, raise a dispute with photos of the packed box (on a weighing scale, with dimensions) before 29 Nov 2026 using the button below.",
};

/** Replace {{placeholders}}; unknown ones become empty. */
export function fillPlaceholders(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

export type AuthSettings = { googleEnabled: boolean; otpValidityMin: number; otpCooldownSec: number; otpMaxAttempts: number };
export const AUTH_DEFAULTS: AuthSettings = { googleEnabled: true, otpValidityMin: 10, otpCooldownSec: 60, otpMaxAttempts: 5 };
export const DEFAULT_SENDER = { email: "contact@vishwaship.in", displayName: "Vishwaship" };
