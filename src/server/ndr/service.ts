import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { enqueue } from "@/server/jobs/runner";
import { adapterFor, providerContext } from "@/server/providers/registry";
import { getSetting } from "@/server/quotes/service";
import { newId } from "@/server/util/ids";
import { hideProviders } from "@/server/customer-safe";
import { creditPrice } from "@/server/notifications/credits";

/**
 * NDR (failed delivery) handling.
 * - A case opens automatically whenever a shipment moves to NDR (one case per failed attempt).
 * - The client, or the AI call (ndr/ai-call.ts), decides: re-attempt, new address, or return (RTO).
 * - The decision goes to the courier's NDR API where one exists; otherwise it waits in the Vishwaship
 *   operations queue (Admin → NDR / RTO → "Push to courier") and the team passes it on. Never lost, never silent.
 */
export type NdrKind = "reattempt" | "update_address" | "rto";
export type AiCall = {
  state: "queued" | "calling" | "completed" | "no_answer" | "failed" | "skipped";
  attempts: number; executionId?: string; outcome?: "reattempt" | "rto" | "unclear"; preferredDate?: string; newAddress?: string;
  note?: string; durationSec?: number; credits?: number; chargedKey?: string; updatedAt: string;
};
export type CasePayload = { line1?: string; mobile?: string; source?: "client" | "ai_call" | "admin"; manual?: boolean; pushedAt?: string; aiCall?: AiCall };

export type NdrCallSettings = { pricePaise: number; maxAttempts: number; retryMinutes: number };
export const NDR_CALL_DEFAULTS: NdrCallSettings = { pricePaise: 800, maxAttempts: 2, retryMinutes: 120 };
export const ndrCallSettings = async (): Promise<NdrCallSettings> => ({ ...NDR_CALL_DEFAULTS, ...(await getSetting<Partial<NdrCallSettings>>("ndr_ai_call", NDR_CALL_DEFAULTS)).value });
/** Credits one connected AI call costs (₹ price ÷ price of one credit, rounded up). */
export async function ndrCallCredits() {
  const [s, p] = await Promise.all([ndrCallSettings(), creditPrice()]);
  return Math.ceil(s.pricePaise / p.paisePerCredit);
}

/**
 * Is AI NDR calling switched on for this client? ON by default (owner 2026-11-26) once a caller is set up — the
 * client's own Bolna or Vishwaship's. A client who switches it off keeps it off.
 */
export async function aiCallingEnabled(orgId: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.notificationSettings).where(and(eq(schema.notificationSettings.orgId, orgId), eq(schema.notificationSettings.channel, "voice"), eq(schema.notificationSettings.event, "ndr_ai_call")));
  if (row) return row.enabled;
  if (await (await import("@/server/own-providers")).ownCalling(orgId)) return true;
  return !!(await (await import("./ai-call")).bolnaAccount());
}

/** Shipment moved to NDR: open a case for this attempt, tell the client, and start the AI call if switched on. */
export async function openNdrCase(shipmentId: string) {
  const db = await getDb();
  const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (!sh) return null;
  const [open] = await db.select({ id: schema.ndrCases.id }).from(schema.ndrCases).where(and(eq(schema.ndrCases.shipmentId, shipmentId), eq(schema.ndrCases.kind, "ndr"), eq(schema.ndrCases.status, "open")));
  if (open) return open.id; // the same failed attempt reported twice
  const [{ n }] = await db.select({ n: count() }).from(schema.ndrCases).where(and(eq(schema.ndrCases.shipmentId, shipmentId), eq(schema.ndrCases.kind, "ndr")));
  const [ev] = await db.select({ raw: schema.shipmentEvents.rawStatus, remark: schema.shipmentEvents.remark }).from(schema.shipmentEvents)
    .where(and(eq(schema.shipmentEvents.shipmentId, shipmentId), eq(schema.shipmentEvents.status, "ndr"))).orderBy(desc(schema.shipmentEvents.occurredAt)).limit(1);
  const id = newId("ndr");
  await db.insert(schema.ndrCases).values({ id, orgId: sh.orgId, shipmentId, kind: "ndr", reason: (ev?.remark || ev?.raw || "Delivery attempt failed").slice(0, 200), attempt: Number(n) + 1, deadlineAt: new Date(Date.now() + 36 * 3600_000) });
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: sh.orgId, kind: "ndr", title: `Delivery failed for AWB ${sh.awb ?? ""} — choose re-attempt or return`, href: "/portal/ndr/" });
  if (await aiCallingEnabled(sh.orgId)) await enqueue("ndr.ai_call", { caseId: id }, { dedupeKey: `ndr.ai_call:${id}:1` });
  return id;
}

/**
 * Apply a decision to an open case: courier API first; if the courier has no NDR API (or refuses), the request
 * waits for the Vishwaship operations team, who push it to the courier. Returns what happened, in client words.
 */
export async function requestNdrAction(a: { caseId: string; orgId?: string; kind: NdrKind; payload?: { line1?: string; mobile?: string }; source: "client" | "ai_call" | "admin"; actorUserId?: string }): Promise<{ ok: boolean; status: "acknowledged" | "queued" | "error"; message: string }> {
  const db = await getDb();
  const [row] = await db.select({ c: schema.ndrCases, sh: schema.shipments }).from(schema.ndrCases)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.ndrCases.shipmentId))
    .where(and(eq(schema.ndrCases.id, a.caseId), a.orgId ? eq(schema.ndrCases.orgId, a.orgId) : undefined));
  if (!row) return { ok: false, status: "error", message: "NDR case not found" };
  if (row.c.status !== "open") return { ok: false, status: "error", message: "An action was already requested for this attempt" };
  const prev = (row.c.requestPayload ?? {}) as CasePayload;
  const base: CasePayload = { ...prev, ...(a.payload ?? {}), source: a.source };
  // claim the case first, so a client click and an AI answer can never both act
  const claimed = await db.update(schema.ndrCases).set({ status: "action_requested", requestedAction: a.kind, requestPayload: base })
    .where(and(eq(schema.ndrCases.id, a.caseId), eq(schema.ndrCases.status, "open"))).returning({ id: schema.ndrCases.id });
  if (!claimed.length) return { ok: false, status: "error", message: "An action was already requested for this attempt" };
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, row.sh.providerAccountId));
  const adapter = acct ? adapterFor(acct) : null;
  let r: Awaited<ReturnType<NonNullable<typeof adapter>["ndrAction"]>> | null = null;
  if (adapter && row.sh.awb) {
    try { r = await adapter.ndrAction(await providerContext(acct!), { awb: row.sh.awb }, { kind: a.kind, payload: a.payload }); } catch (e) { r = { ok: false, error: { category: "upstream", message: (e as Error).message, retryable: true } }; }
  }
  await audit({ actorUserId: a.actorUserId, actorKind: a.source === "client" ? "customer" : a.source === "admin" ? "staff" : "system", orgId: row.c.orgId, action: `ndr.${a.kind}`, targetType: "ndr_case", targetId: a.caseId, details: { source: a.source, api: r ? r.ok : null } });
  if (r?.ok && r.value.acknowledged) {
    await db.update(schema.ndrCases).set({ status: "acknowledged", requestPayload: { ...base, pushedAt: new Date().toISOString() } }).where(eq(schema.ndrCases.id, a.caseId));
    return { ok: true, status: "acknowledged", message: a.kind === "reattempt" ? "Re-attempt requested with the courier" : a.kind === "rto" ? "Return requested with the courier" : "New address sent to the courier" };
  }
  // no API / refused: the operations team passes it on
  await db.update(schema.ndrCases).set({ requestPayload: { ...base, manual: true, ...(r && !r.ok && r.error.category !== "unsupported" ? { note: hideProviders(r.error.message).slice(0, 200) } : {}) } }).where(eq(schema.ndrCases.id, a.caseId));
  await db.insert(schema.staffAlerts).values({ id: newId("sal"), kind: "ndr_push", title: `NDR ${a.kind.replace("_", " ")} to push to the courier — AWB ${row.sh.awb ?? ""}${a.source === "ai_call" ? " (buyer said so on the AI call)" : ""}`.slice(0, 200), href: "/admin/ndr/?queue=push", perm: "shipments.read" });
  return { ok: true, status: "queued", message: a.kind === "reattempt" ? "Re-attempt request received — Vishwaship is passing it to the courier" : a.kind === "rto" ? "Return request received — Vishwaship is passing it to the courier" : "New address received — Vishwaship is passing it to the courier" };
}

/** Admin: the team has passed a queued request to the courier. */
export async function markPushed(caseId: string, staffUserId: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.ndrCases).where(eq(schema.ndrCases.id, caseId));
  if (!c || c.status !== "action_requested") return false;
  await db.update(schema.ndrCases).set({ status: "acknowledged", requestPayload: { ...((c.requestPayload as object) ?? {}), manual: true, pushedAt: new Date().toISOString() } }).where(eq(schema.ndrCases.id, caseId));
  await audit({ actorUserId: staffUserId, actorKind: "staff", orgId: c.orgId, action: "ndr.pushed_to_courier", targetType: "ndr_case", targetId: caseId });
  return true;
}

/** Cases whose request waits for the operations team (oldest first). */
export const pushQueueCondition = () => and(eq(schema.ndrCases.status, "action_requested"), sql`(${schema.ndrCases.requestPayload}->>'manual')::boolean is true`);
