/** CRM Leads: labels and helpers shared by the admin pages, the API and the server. */

export const LEAD_STATUSES = ["new", "contacted", "follow_up", "interested", "signed_up", "not_interested", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const CLOSED_STATUSES = ["signed_up", "not_interested", "lost"] as const;
export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", follow_up: "Follow-up", interested: "Interested", signed_up: "Signed up", not_interested: "Not interested", lost: "Lost",
};
export const isLeadStatus = (s: unknown): s is LeadStatus => LEAD_STATUSES.includes(s as LeadStatus);

export const LEAD_SOURCES = ["meta_form", "whatsapp", "instagram", "website", "call", "referral", "manual"] as const;
export const SOURCE_LABEL: Record<string, string> = {
  meta_form: "Meta ad form", whatsapp: "WhatsApp", instagram: "Instagram DM", website: "Website", call: "Phone call", referral: "Referral", manual: "Other",
};

export const ACTIVITY_LABEL: Record<string, string> = {
  created: "Lead added", note: "Note", call: "Call", whatsapp: "WhatsApp", status: "Status", assign: "Assigned", follow_up: "Follow-up", form: "Ad form",
  wa_out: "WhatsApp sent", wa_in: "WhatsApp reply",
};

/**
 * What happened on a call. `status` moves the lead (only forward from New / Contacted / Follow-up);
 * `retryDays` sets the next follow-up when none was given (no answer → try again tomorrow).
 */
export const CALL_OUTCOMES = [
  { key: "interested", label: "Baat hui — interested", status: "interested", retryDays: 0 },
  { key: "callback", label: "Baat hui — baad me call karo", status: "follow_up", retryDays: 1 },
  { key: "info_sent", label: "Baat hui — details bhejni hain", status: "contacted", retryDays: 1 },
  { key: "no_answer", label: "Phone nahi uthaya", status: "contacted", retryDays: 1 },
  { key: "busy", label: "Busy / call cut", status: "contacted", retryDays: 1 },
  { key: "switched_off", label: "Switched off / not reachable", status: "contacted", retryDays: 1 },
  { key: "not_interested", label: "Not interested", status: "not_interested", retryDays: 0 },
  { key: "wrong_number", label: "Wrong number", status: "lost", retryDays: 0 },
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number]["key"];
export const callOutcome = (k: string | null | undefined) => CALL_OUTCOMES.find((o) => o.key === k);

/** 10-digit Indian mobile when it is one (drops +91 / 91 / 0), else just the digits. */
export function normMobile(raw: string): string {
  const d = String(raw).replace(/\D/g, "");
  const m = d.replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
  return /^[6-9]\d{9}$/.test(m) ? m : d;
}

/** wa.me link: opens a chat with this number in the WhatsApp installed on the phone / laptop (WhatsApp Web or Desktop). */
export function waLink(mobile: string, text = "") {
  const m = normMobile(mobile);
  const num = /^[6-9]\d{9}$/.test(m) ? `91${m}` : m;
  return `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
export const telLink = (mobile: string) => { const m = normMobile(mobile); return `tel:${/^[6-9]\d{9}$/.test(m) ? `+91${m}` : m}`; };

/** Ready WhatsApp messages; {name} becomes the lead's first name. */
export const WA_TEMPLATES: Array<{ key: string; label: string; text: string }> = [
  { key: "intro", label: "Pehla message (seller)", text: "Namaste {name} ji 🙏\nMain Vishwaship se baat kar raha hoon. Aapne hamare ad par details bheji thi — dhanyavaad!\nVishwaship pe: ₹28 se shipping*, WhatsApp COD confirmation (fake orders band), NDR calling aur COD D+5.\nAap mahine me kitne orders bhejte ho, aur abhi kaunsa courier use karte ho?" },
  { key: "b2b", label: "B2B cargo", text: "Namaste {name} ji 🙏\nVishwaship se — aapne B2B cargo ke liye enquiry ki thi. Cargo ₹8/kg se* shuru hota hai, poore India me, godown se pickup.\nPickup PIN code, approx weight aur delivery city bata dijiye, main aapko exact rate bhejta hoon." },
  { key: "signup", label: "Signup link", text: "{name} ji, free account yahan 2 minute me ban jayega 👉 https://vishwaship.in/signup/\nKoi dikkat aaye to isi number pe message kar dijiye, hum help karenge." },
  { key: "followup", label: "Follow-up", text: "Namaste {name} ji, Vishwaship se follow-up 🙏 Aapse shipping ke baare me baat hui thi — kya aaj 5 minute baat ho sakti hai? Aapke liye sahi time bata dijiye." },
  { key: "blank", label: "Khaali (apna message)", text: "" },
];
export const fillTemplate = (t: string, name: string) => t.replace(/\{name\}/g, (name || "").trim().split(/\s+/)[0] || "");

/** "28 Nov, 7:30 PM" in IST. */
export const istShort = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
/** Value for <input type="datetime-local"> in IST. */
export const istInput = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16);
/** "2026-11-28T19:30" typed in IST → Date. */
export const fromIstInput = (s: string) => { const d = new Date(`${s}:00+05:30`); return isNaN(+d) ? null : d; };
