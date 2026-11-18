/** Support tickets: categories, customer-facing statuses and attachment rules (shared by client and server). */

export const TICKET_CATEGORIES = [
  { key: "shipment", label: "Shipment Related Issue", needsRef: true },
  { key: "pickup", label: "Pickup Related Issue", needsRef: true },
  { key: "tech", label: "Tech Related Issue", needsRef: false },
  { key: "billing", label: "Billing & Remittance", needsRef: false },
  { key: "reattempt", label: "Reattempt shipment", needsRef: true },
  { key: "return", label: "Return shipment", needsRef: true },
  { key: "edit_order", label: "Edit Order Information", needsRef: true },
  { key: "pod", label: "Proof of Delivery", needsRef: true },
  { key: "recharge", label: "Recharge issue", needsRef: false },
  { key: "lost_damage", label: "Lost/Damage/Wrong", needsRef: true },
  { key: "account", label: "Panel/Account Related", needsRef: false },
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = TICKET_CATEGORIES.map((c) => c.key) as [TicketCategory, ...TicketCategory[]];

/** Older tickets used other category keys — show them readably. */
const LEGACY: Record<string, string> = {
  chat: "Support Chat", wallet_recharge: "Recharge issue", pickup_issue: "Pickup Related Issue", delivery_delay: "Shipment Related Issue",
  ndr_rto: "Reattempt shipment", weight_dispute: "Billing & Remittance", damaged_lost: "Lost/Damage/Wrong", cod_remittance: "Billing & Remittance",
  kyc: "Panel/Account Related", other: "Other",
};
export const categoryLabel = (k: string) => TICKET_CATEGORIES.find((c) => c.key === k)?.label ?? LEGACY[k] ?? k.replace(/_/g, " ");
export const categoryNeedsRef = (k: string) => TICKET_CATEGORIES.find((c) => c.key === k)?.needsRef ?? false;

/** Customer tabs. Any status that is not resolved / closed counts as Open. */
export const TICKET_TABS = ["open", "resolved", "closed", "all"] as const;
export type TicketTab = (typeof TICKET_TABS)[number];
export const isTicketTab = (v: unknown): v is TicketTab => typeof v === "string" && (TICKET_TABS as readonly string[]).includes(v);
export const customerStatus = (s: string): "open" | "resolved" | "closed" => (s === "resolved" ? "resolved" : s === "closed" ? "closed" : "open");
export const STATUS_LABEL = { open: "Open", resolved: "Resolved", closed: "Closed" } as const;

export const COMMENT_MAX = 500;
export const MESSAGE_MAX = 2000;

export type FileKind = "image" | "audio" | "video" | "document";
export const FILE_LIMITS: Record<FileKind, number> = { image: 2 * 1024 * 1024, audio: 5 * 1024 * 1024, video: 5 * 1024 * 1024, document: 5 * 1024 * 1024 };
export const FILE_HINT = "Max file size: Image - 2MB, Audio - 5MB, Video - 5MB, Document - 5MB";
export const FILE_ACCEPT = "image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";

/** Client-side pre-check (the server checks again by content). */
export function kindFromName(name: string, type = ""): FileKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  if (type.startsWith("audio/") || ["mp3", "m4a", "wav", "ogg", "aac", "opus"].includes(ext)) return "audio";
  if (type.startsWith("video/") || ["mp4", "webm", "mov", "3gp", "mkv"].includes(ext)) return "video";
  if (["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"].includes(ext)) return "document";
  return null;
}
export function checkFileClient(f: File): string | null {
  const k = kindFromName(f.name, f.type);
  if (!k) return "This file type is not allowed. Use an image, audio, video, PDF, Word, Excel, CSV or text file.";
  if (f.size > FILE_LIMITS[k]) return `${k[0].toUpperCase()}${k.slice(1)} files can be up to ${FILE_LIMITS[k] / 1024 / 1024} MB.`;
  return null;
}

export type TicketAttachment = { key: string; name: string; mime: string; size: number; kind: FileKind };
