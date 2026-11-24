import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { readSettings } from "@/lib/store-themes";
import { getDb, schema } from "@/server/db/client";
import type { StoreOrderView } from "./orders";

/**
 * Buyer return / exchange requests (phase 7b). The buyer asks from My Account or the order page within the store's
 * return window (days after delivery, Store setup → Checkout). The merchant approves or rejects, then marks it
 * completed once the goods are back (returned goods are counted on the Inventory page, refunds stay the merchant's
 * own action at the payment gateway / bank, nothing is refunded automatically).
 */
export const RETURN_REASONS = ["Damaged or defective", "Wrong item received", "Size or fit issue", "Not as described", "Missing parts", "Changed my mind", "Other"] as const;
export type ReturnStatus = "requested" | "approved" | "rejected" | "completed";
export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = { requested: "Requested — waiting for the store", approved: "Approved", rejected: "Not approved", completed: "Completed" };
export type ReturnRequest = {
  type: "return" | "exchange"; reason: string; note: string;
  lines: Array<{ index: number; qty: number }>;
  status: ReturnStatus; requestedAt: string; decidedAt?: string; merchantNote?: string;
  history: Array<{ at: string; status: ReturnStatus; by: "buyer" | "merchant"; note?: string }>;
};

export class ReturnError extends Error {}

export const ReturnInput = z.object({
  type: z.enum(["return", "exchange"]),
  reason: z.enum(RETURN_REASONS),
  note: z.string().trim().max(1000).default(""),
  lines: z.array(z.object({ index: z.number().int().min(0).max(200), qty: z.number().int().min(1).max(100) })).min(1, "Choose at least one item").max(50),
}).superRefine((v, ctx) => { if (v.reason === "Other" && v.note.length < 5) ctx.addIssue({ code: "custom", path: ["note"], message: "Tell the store what is wrong" }); });

/** Can the buyer ask for a return / exchange on this order now? */
export function returnWindow(o: Pick<StoreOrderView, "status" | "fulfilment" | "deliveredAt" | "returnRequest">, settingsRaw: unknown, now = Date.now()) {
  const ck = readSettings(settingsRaw).checkout;
  if (o.returnRequest) return { allowed: false as const, why: "A request is already open for this order" };
  if (ck.returnDays <= 0) return { allowed: false as const, why: "This store does not take return requests online. Please contact the store." };
  if (o.status !== "placed" || o.fulfilment !== "delivered" || !o.deliveredAt) return { allowed: false as const, why: "You can ask for a return once the order is delivered" };
  const until = new Date(new Date(o.deliveredAt).getTime() + ck.returnDays * 86400_000);
  if (until.getTime() < now) return { allowed: false as const, why: `The ${ck.returnDays}-day return window ended on ${until.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}` };
  return { allowed: true as const, until, exchange: ck.exchangeEnabled, days: ck.returnDays };
}

export async function requestReturn(store: { id: string; settings: unknown }, o: StoreOrderView, raw: unknown) {
  const input = ReturnInput.parse(raw);
  const w = returnWindow(o, store.settings);
  if (!w.allowed) throw new ReturnError(w.why);
  if (input.type === "exchange" && !w.exchange) throw new ReturnError("This store does not offer exchanges. Choose a return instead.");
  for (const l of input.lines) {
    const line = o.lines[l.index];
    if (!line || l.qty > line.qty) throw new ReturnError("Choose items and quantities from this order");
  }
  const now = new Date().toISOString();
  const req: ReturnRequest = { ...input, status: "requested", requestedAt: now, history: [{ at: now, status: "requested", by: "buyer", note: input.note || undefined }] };
  const db = await getDb();
  // only one request per order: the update applies only while none exists (two taps / two tabs make one request)
  const done = await db.update(schema.storeOrders).set({ returnRequest: req })
    .where(and(eq(schema.storeOrders.id, o.id), eq(schema.storeOrders.storeId, store.id), isNull(schema.storeOrders.returnRequest))).returning({ id: schema.storeOrders.id });
  if (!done.length) throw new ReturnError("A request is already open for this order");
  return req;
}

const NEXT: Record<"approve" | "reject" | "complete", { from: ReturnStatus[]; to: ReturnStatus }> = {
  approve: { from: ["requested"], to: "approved" },
  reject: { from: ["requested"], to: "rejected" },
  complete: { from: ["approved"], to: "completed" },
};

/** Merchant decision. Rejecting needs a short reason the buyer will see. Emails the buyer when they gave an email. */
export async function decideReturn(orgId: string, orderId: string, action: keyof typeof NEXT, note: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, orderId), eq(schema.storeOrders.orgId, orgId)));
  const cur = o?.returnRequest as ReturnRequest | null;
  if (!o || !cur) throw new ReturnError("No return request on this order");
  const step = NEXT[action];
  if (!step.from.includes(cur.status)) throw new ReturnError(`This request is already ${RETURN_STATUS_LABEL[cur.status].toLowerCase()}`);
  if (action === "reject" && note.trim().length < 3) throw new ReturnError("Give the buyer a reason");
  const at = new Date().toISOString();
  const next: ReturnRequest = { ...cur, status: step.to, decidedAt: action === "complete" ? cur.decidedAt : at, merchantNote: note.trim() || cur.merchantNote,
    history: [...cur.history, { at, status: step.to, by: "merchant" as const, note: note.trim() || undefined }].slice(-20) };
  await db.update(schema.storeOrders).set({ returnRequest: next }).where(eq(schema.storeOrders.id, o.id));
  const b = o.buyer as { name: string; email?: string };
  if (b.email) {
    const [st] = await db.select({ name: schema.stores.name, slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, o.storeId));
    const app = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const { sendEmail } = await import("@/server/email/service");
    await sendEmail({ event: "store_return_update", to: b.email, toKind: "recipient", orgId: o.orgId, dedupeKey: `store_return:${o.id}:${step.to}`,
      vars: { customer_name: b.name, order_id: o.number, store_name: st?.name ?? "", request_type: cur.type, status: RETURN_STATUS_LABEL[step.to],
        note: action === "approve" ? `${note.trim() ? `${note.trim()}\n\n` : ""}The store will tell you how to send the item back.` : note.trim(),
        tracking_link: `${app}/s/${st?.slug ?? ""}/account/` } }).catch(() => null);
  }
  return next;
}
