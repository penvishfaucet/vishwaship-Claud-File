import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { isEmail } from "@/server/client-email";

/**
 * Admin → Weight Disputes: the courier's dispute e-mail addresses (saved once) and the one-click
 * "Send to Delhivery" that mails the client's dispute (LR, weights, reason, photo links) to the courier.
 */
const KEY = "weight_dispute_courier_mail";
export type CourierMailSettings = { to: string[]; cc: string[] };

const list = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

export async function courierMailSettings(): Promise<CourierMailSettings> {
  const db = await getDb();
  const [r] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, KEY));
  const v = (r?.value ?? {}) as Partial<CourierMailSettings>;
  return { to: list(v.to).filter(isEmail), cc: list(v.cc).filter(isEmail) };
}

export async function saveCourierMailSettings(input: { to: string; cc: string }, actorUserId: string): Promise<{ ok: boolean; message: string }> {
  const to = list(input.to), cc = list(input.cc);
  const bad = [...to, ...cc].filter((x) => !isEmail(x));
  if (bad.length) return { ok: false, message: `Not an email address: ${bad.join(", ")}` };
  if (!to.length) return { ok: false, message: "Enter at least one courier email address" };
  if (to.length + cc.length > 10) return { ok: false, message: "At most 10 addresses" };
  const value = { to, cc };
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: KEY, value }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorUserId, actorKind: "staff", action: "weight_dispute.courier_mail_saved", targetType: "setting", targetId: KEY, details: { to: to.length, cc: cc.length } });
  return { ok: true, message: "Saved" };
}

type Ev = { label?: string; by?: string; note?: string; claimedGrams?: number; urls?: string[]; at?: string; to?: string[] };

/** Mail the client's dispute to the courier (each saved address + CC). Recorded on the discrepancy; can be re-sent. */
export async function sendDisputeToCourier(id: string, actorUserId: string): Promise<{ ok: boolean; message: string }> {
  const db = await getDb();
  const [row] = await db.select({ d: schema.weightDisputes, s: schema.shipments }).from(schema.weightDisputes)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.weightDisputes.shipmentId)).where(eq(schema.weightDisputes.id, id));
  if (!row) return { ok: false, message: "Dispute not found" };
  const { d, s } = row;
  const cfg = await courierMailSettings();
  if (!cfg.to.length) return { ok: false, message: "Save the courier's dispute email address first (box above the table)" };
  const ev = (d.evidence as Ev[]) ?? [];
  const seller = [...ev].reverse().find((e) => e.by === "seller");
  const kg = (g?: number) => (g ? `${(g / 1000).toFixed(2)} kg` : "—");
  const lr = s.lrNumber ?? s.awb ?? "";
  const vars = {
    lr_number: lr, courier_name: s.carrierName,
    booked_weight: kg(d.bookedChargeableGrams ?? d.declaredGrams), courier_weight: kg(d.carrierGrams),
    claimed_weight: seller?.claimedGrams ? kg(seller.claimedGrams) : kg(d.bookedChargeableGrams ?? d.declaredGrams),
    reason: seller?.note ?? "The shipper confirms the booked weight and dimensions are correct.",
    photo_links: seller?.urls?.length ? seller.urls.join("\n") : "(photos available on request)",
  };
  const { sendEmail } = await import("@/server/email/service");
  const sent: string[] = [], failed: string[] = [];
  const stamp = Date.now();
  for (const to of [...cfg.to, ...cfg.cc]) {
    const r = await sendEmail({ event: "courier_weight_dispute", to, toKind: "courier", orgId: d.orgId, shipmentId: s.id, dedupeKey: `courier_weight_dispute:${id}:${to}:${stamp}`, vars, ignoreRule: true });
    (r.status === "sent" ? sent : failed).push(r.status === "sent" ? to : `${to} (${r.error ?? r.status})`);
  }
  if (!sent.length) return { ok: false, message: `Not sent: ${failed.join("; ")}` };
  await db.update(schema.weightDisputes).set({ evidence: [...ev, { label: `Sent to ${s.carrierName}`, by: "vishwaship", at: new Date().toISOString(), to: sent }] }).where(eq(schema.weightDisputes.id, id));
  await audit({ actorUserId, actorKind: "staff", orgId: d.orgId, action: "weight_dispute.sent_to_courier", targetType: "weight_dispute", targetId: id, details: { to: sent.length, failed: failed.length } });
  return { ok: true, message: `Sent to ${sent.length} address${sent.length > 1 ? "es" : ""}${failed.length ? ` · failed: ${failed.join("; ")}` : ""}` };
}

/** Sidebar badges: discrepancies awaiting the client (open) and disputes awaiting Vishwaship (disputed). */
export async function weightCounts(orgId?: string): Promise<{ open: number; disputed: number }> {
  const db = await getDb();
  const rows = await db.select({ status: schema.weightDisputes.status, n: count() }).from(schema.weightDisputes)
    .where(orgId ? and(eq(schema.weightDisputes.orgId, orgId), inArray(schema.weightDisputes.status, ["open", "disputed"])) : inArray(schema.weightDisputes.status, ["open", "disputed"]))
    .groupBy(schema.weightDisputes.status);
  const n = (k: string) => Number(rows.find((r) => r.status === k)?.n ?? 0);
  return { open: n("open"), disputed: n("disputed") };
}
