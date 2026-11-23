/**
 * Shipment tracking view model (pure; shared by the customer portal, admin and the public tracking pages).
 * Input: stored carrier scans (shipment_events). Output: a milestone stepper (Manifested → In-transit → Out for delivery
 * → Delivered, plus NDR / RTO / cancelled / lost when they happen) and the full scan list, oldest first.
 */
export type ScanInput = { status: string; rawStatus?: string | null; location?: string | null; remark?: string | null; occurredAt: Date | string };
export type Milestone = { key: string; label: string; at: string | null; done: boolean; tone: "ok" | "warn" | "bad" };
export type ScanLine = { at: string; when: string; text: string; status: string };

const IST_MS = 5.5 * 3600_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "15 Nov, 04:26am" in India time (same on server and browser, no locale differences). */
export function fmtScanTime(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + IST_MS);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

const DELIVERED = new Set(["delivered", "reverse_delivered"]);
const TRANSIT = new Set(["picked_up", "in_transit", "at_delivery_center", "reverse_in_transit"]);
const RTO = new Set(["rto_initiated", "rto_in_transit", "rto_delivered"]);

const NICE: Record<string, string> = {
  booked: "Manifested", pickup_pending: "Pickup pending", picked_up: "Picked up", in_transit: "In transit", at_delivery_center: "At delivery centre",
  out_for_delivery: "Out for delivery", delivered: "Delivered", ndr: "Delivery attempted", cancelled: "Cancelled", rto_initiated: "RTO initiated",
  rto_in_transit: "RTO in transit", rto_delivered: "Returned to origin", lost: "Under investigation", reverse_in_transit: "Return pickup in transit", reverse_delivered: "Return delivered",
};

/** One readable line per scan: the courier's activity text, then "at <location>" (unless the text already names it). */
export function scanText(e: ScanInput, clean: (s: string) => string = (s) => s): string {
  const remark = (e.remark ?? "").trim(), raw = (e.rawStatus ?? "").trim();
  // Delhivery stores "Scan — Instructions"; the instruction is the useful sentence. Others: remark is the longer activity.
  let activity = remark && remark.length >= 4 ? remark : raw.split(" — ").pop()!.trim() || raw;
  if (!activity) activity = NICE[e.status] ?? e.status.replace(/_/g, " ");
  activity = clean(activity).replace(/\s+/g, " ").trim();
  const loc = clean((e.location ?? "").trim()).replace(/\s+/g, " ");
  if (!loc || activity.toLowerCase().includes(loc.toLowerCase())) return activity;
  return `${activity} at ${loc}`;
}

const firstAt = (ev: ScanInput[], pred: (s: string) => boolean) => ev.find((e) => pred(e.status));
const lastAt = (ev: ScanInput[], pred: (s: string) => boolean) => [...ev].reverse().find((e) => pred(e.status));
const iso = (e?: ScanInput) => (e ? new Date(e.occurredAt).toISOString() : null);

/**
 * Milestones in the order they happen. A step is "done" when it has its own scan or a later step is done
 * (a carrier that skips the "manifested" scan still shows the step as passed, like the reference design).
 */
export function buildMilestones(events: ScanInput[], current: string, bookedAt?: Date | string | null): Milestone[] {
  const ev = [...events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const has = (s: string) => ev.some((e) => e.status === s) || current === s;
  const steps: Array<{ key: string; label: string; e?: ScanInput; reached: boolean; tone?: Milestone["tone"]; fallbackAt?: string | null }> = [];
  const manifest = firstAt(ev, (s) => s === "booked" || s === "pickup_pending");
  steps.push({ key: "manifested", label: "Manifested", e: manifest, reached: true, fallbackAt: bookedAt ? new Date(bookedAt).toISOString() : null });
  if (current === "cancelled" || (has("cancelled") && !ev.some((e) => TRANSIT.has(e.status)))) {
    steps.push({ key: "cancelled", label: "Cancelled", e: lastAt(ev, (s) => s === "cancelled"), reached: true, tone: "bad" });
    return finish(steps);
  }
  const transit = firstAt(ev, (s) => TRANSIT.has(s));
  const ofd = lastAt(ev, (s) => s === "out_for_delivery");
  const ndr = lastAt(ev, (s) => s === "ndr");
  const isRto = RTO.has(current) || ev.some((e) => RTO.has(e.status));
  const delivered = firstAt(ev, (s) => DELIVERED.has(s)); // first delivery scan (later "POD uploaded" scans keep the status)
  steps.push({ key: "in_transit", label: "In-transit", e: transit, reached: !!transit || TRANSIT.has(current) });
  if (isRto) {
    if (ofd) steps.push({ key: "out_for_delivery", label: "Out for delivery", e: ofd, reached: true });
    if (ndr) steps.push({ key: "ndr", label: "Delivery attempted", e: ndr, reached: true, tone: "warn" });
    steps.push({ key: "rto_initiated", label: "RTO initiated", e: firstAt(ev, (s) => s === "rto_initiated"), reached: true, tone: "warn" });
    steps.push({ key: "rto_in_transit", label: "RTO in transit", e: firstAt(ev, (s) => s === "rto_in_transit"), reached: has("rto_in_transit") || has("rto_delivered"), tone: "warn" });
    steps.push({ key: "rto_delivered", label: "RTO delivered", e: lastAt(ev, (s) => s === "rto_delivered"), reached: has("rto_delivered"), tone: "warn" });
    return finish(steps);
  }
  // NDR is shown only while it matters: before delivery, or when it happened at all (history stays visible)
  if (ndr && (!ofd || new Date(ndr.occurredAt) < new Date(ofd.occurredAt))) steps.push({ key: "ndr", label: "Delivery attempted", e: ndr, reached: true, tone: "warn" });
  steps.push({ key: "out_for_delivery", label: "Out for delivery", e: ofd, reached: !!ofd || current === "out_for_delivery" });
  if (ndr && ofd && new Date(ndr.occurredAt) >= new Date(ofd.occurredAt)) steps.push({ key: "ndr", label: "Delivery attempted", e: ndr, reached: true, tone: "warn" });
  if (current === "lost" || has("lost")) steps.push({ key: "lost", label: "Under investigation", e: lastAt(ev, (s) => s === "lost"), reached: true, tone: "bad" });
  else steps.push({ key: "delivered", label: "Delivered", e: delivered, reached: !!delivered || DELIVERED.has(current) });
  return finish(steps);
}

function finish(steps: Array<{ key: string; label: string; e?: ScanInput; reached: boolean; tone?: Milestone["tone"]; fallbackAt?: string | null }>): Milestone[] {
  let laterDone = false;
  const out: Milestone[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    const done = s.reached || !!s.e || laterDone;
    if (done) laterDone = true;
    out.unshift({ key: s.key, label: s.label, at: iso(s.e) ?? (s.key === "manifested" ? s.fallbackAt ?? null : null), done, tone: s.tone ?? "ok" });
  }
  return out;
}

/** Every scan, oldest first, as display lines. `clean` hides internal partner names for customers. */
export function buildScans(events: ScanInput[], clean?: (s: string) => string): ScanLine[] {
  return [...events]
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
    .map((e) => ({ at: new Date(e.occurredAt).toISOString(), when: fmtScanTime(e.occurredAt), text: scanText(e, clean), status: e.status }));
}

/** Public pages: also mask mobile numbers a courier may put in a scan remark (delivery executive, receiver). */
const PHONE = new RegExp(String.raw`(?:\+91[-\s]?)?\b[6-9]\d{9}\b`, "g");
export const maskPhones = (t: string) => t.replace(PHONE, "••••••••••");

/**
 * How the courier proved the delivery, read from its own words (scan text / POD reply): "otp" when the buyer's OTP was
 * verified, "pod" when a POD (signed copy / photo / e-POD) was taken or uploaded. null = the courier did not say.
 * OTP wins when both appear on the delivery scan ("OTP verified … POD uploaded" still means OTP-based delivery).
 */
export function deliveryModeFromText(...texts: Array<string | null | undefined>): "otp" | "pod" | null {
  const t = texts.filter(Boolean).join(" ").toLowerCase();
  if (!t) return null;
  if (/\botp\b|one[\s-]?time[\s-]?password/.test(t)) return "otp";
  if (/\be-?pod\b|\bpod\b|proof of delivery|signature|signed|lm[_\s]?pod/.test(t)) return "pod";
  return null;
}

/** Delivery mode from a shipment's scans: only scans at / after the first delivery scan count. */
export function deliveryModeFromScans(events: ScanInput[]): "otp" | "pod" | null {
  const ev = [...events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const i = ev.findIndex((e) => DELIVERED.has(e.status));
  if (i < 0) return null;
  const after = ev.slice(i);
  return deliveryModeFromText(...after.flatMap((e) => [e.rawStatus, e.remark])) ;
}
