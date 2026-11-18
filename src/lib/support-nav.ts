import { isTicketTab } from "./support";

/** Rebuild the Tickets list URL (tab + search) from a `back` query value — only known keys, never a free URL. */
export function safeTicketsBack(back?: string) {
  const p = new URLSearchParams(back ?? "");
  const out = new URLSearchParams();
  const tab = p.get("tab");
  if (isTicketTab(tab) && tab !== "open") out.set("tab", tab);
  const q = (p.get("q") ?? "").trim().slice(0, 60);
  if (q) out.set("q", q);
  const s = out.toString();
  return `/portal/support/${s ? `?${s}` : ""}`;
}
