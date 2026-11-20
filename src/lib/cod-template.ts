/**
 * WhatsApp COD confirmation message: one default template (English / Hindi) with named variables, used for
 * the client's live preview, the Admin template text (copy or submit to Meta) and the values sent to the provider.
 * WhatsApp templates must be approved before use, so clients edit the parts that are variables
 * (store name, support number, note, language) — the approved wording itself stays the same.
 */
export const COD_VARS = ["buyer_name", "store_name", "order_id", "cod_amount", "delivery_address", "expected_delivery", "store_note", "support_phone"] as const;
export type CodVar = (typeof COD_VARS)[number];

export const COD_BUTTONS = { confirm: "Confirm Order", cancel: "Cancel Order" } as const;

export const COD_TEMPLATE: Record<"en" | "hi", string> = {
  en: [
    "Hello {{buyer_name}},",
    "Thank you for shopping with {{store_name}}.",
    "",
    "Order ID: {{order_id}}",
    "Amount to pay on delivery (COD): {{cod_amount}}",
    "Delivery address: {{delivery_address}}",
    "Expected delivery: {{expected_delivery}}",
    "",
    "{{store_note}}",
    "",
    "Please confirm the order and address so we can ship it. Tap Confirm Order or Cancel Order below.",
    "Help: {{support_phone}}",
  ].join("\n"),
  hi: [
    "नमस्ते {{buyer_name}},",
    "{{store_name}} से खरीदारी के लिए धन्यवाद।",
    "",
    "ऑर्डर ID: {{order_id}}",
    "डिलीवरी पर देने की राशि (COD): {{cod_amount}}",
    "डिलीवरी पता: {{delivery_address}}",
    "संभावित डिलीवरी: {{expected_delivery}}",
    "",
    "{{store_note}}",
    "",
    "कृपया ऑर्डर और पता कन्फर्म करें ताकि हम इसे भेज सकें। नीचे Confirm Order या Cancel Order दबाएँ।",
    "मदद: {{support_phone}}",
  ].join("\n"),
};

/** Same template with numbered variables ({{1}} …), for WATI / AiSensy dashboards that number them. */
export function numbered(body: string) {
  const order: string[] = [];
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, n: string) => { if (!order.includes(n)) order.push(n); return `{{${order.indexOf(n) + 1}}}`; });
  return { text, order };
}

/** Fill a template body with values (preview / plain text). */
export const fillTemplate = (body: string, v: Partial<Record<string, string>>) => body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, n: string) => v[n] ?? "");

/** Sample values for previews. */
export const COD_SAMPLE: Record<CodVar, string> = {
  buyer_name: "Ravi", store_name: "Your Store", order_id: "VS1001", cod_amount: "₹1,499",
  delivery_address: "12 MG Road, Indiranagar, Bengaluru, Karnataka 560038", expected_delivery: "Tue, 25 Nov",
  store_note: "Thank you for your trust in us.", support_phone: "+91 90000 00000",
};

/** Delivery estimate before a courier is chosen: same state 3 days, other states 5 days (Sundays skipped). */
export function roughDelivery(fromState: string | undefined, toState: string | undefined, now = new Date()) {
  const days = fromState && toState && fromState.trim().toLowerCase() === toState.trim().toLowerCase() ? 3 : 5;
  const d = new Date(now.getTime());
  let left = days;
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (new Date(d.getTime() + 5.5 * 3600_000).getUTCDay() !== 0) left--; }
  return d;
}
