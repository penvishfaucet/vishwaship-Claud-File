import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { enqueue } from "@/server/jobs/runner";
import { providerContext } from "@/server/providers/registry";
import { newId } from "@/server/util/ids";
import { type AiCall, type CasePayload, ndrCallCredits, ndrCallSettings, requestNdrAction } from "./service";

/**
 * AI NDR calling through Bolna (bolna.ai): pay-as-you-go voice AI for Indian languages.
 * Admin → API Keys & Services → Bolna: API key, the agent ID (a Bolna agent set up for NDR) and a webhook token.
 * Flow: NDR case opens → credits held → POST https://api.bolna.ai/call → Bolna posts the call result to
 * /api/webhooks/bolna → the buyer's answer becomes a re-attempt / return request (service.requestNdrAction).
 * A call that does not connect gives the credits back and is tried again once (settings: maxAttempts, retryMinutes).
 */
const BOLNA = "https://api.bolna.ai/call";

export async function bolnaAccount() {
  const db = await getDb();
  const [a] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, "bolna"), eq(schema.providerAccounts.status, "enabled")));
  return a ?? null;
}

// ---------------------------------------------------------------- credits (held per call, given back if not connected)
async function holdCredits(orgId: string, key: string, n: number) {
  if (n <= 0) return true;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [done] = await tx.select({ id: schema.creditEntries.id }).from(schema.creditEntries).where(eq(schema.creditEntries.idempotencyKey, `ndr:charge:${key}`));
    if (done) return true;
    const upd = await tx.update(schema.creditBalances).set({ credits: sql`${schema.creditBalances.credits} - ${n}` })
      .where(and(eq(schema.creditBalances.orgId, orgId), sql`${schema.creditBalances.credits} >= ${n}`)).returning({ c: schema.creditBalances.credits });
    if (!upd.length) return false;
    await tx.insert(schema.creditEntries).values({ id: newId("ce"), orgId, kind: "settle", credits: -n, idempotencyKey: `ndr:charge:${key}`, refType: "ndr_ai_call", refId: key });
    return true;
  });
}
async function returnCredits(orgId: string, key: string, n: number) {
  if (n <= 0) return;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const ins = await tx.insert(schema.creditEntries).values({ id: newId("ce"), orgId, kind: "release", credits: n, idempotencyKey: `ndr:refund:${key}`, refType: "ndr_ai_call", refId: key }).onConflictDoNothing().returning({ id: schema.creditEntries.id });
    if (ins.length) await tx.update(schema.creditBalances).set({ credits: sql`${schema.creditBalances.credits} + ${n}` }).where(eq(schema.creditBalances.orgId, orgId));
  });
}

async function saveCall(caseId: string, call: AiCall) {
  const db = await getDb();
  const [c] = await db.select().from(schema.ndrCases).where(eq(schema.ndrCases.id, caseId));
  if (!c) return;
  await db.update(schema.ndrCases).set({ requestPayload: { ...((c.requestPayload as CasePayload) ?? {}), aiCall: { ...call, updatedAt: new Date().toISOString() } } }).where(eq(schema.ndrCases.id, caseId));
}

/** Job ndr.ai_call: place one call for an open case. */
export async function placeNdrCall(caseId: string): Promise<{ done: true } | { retryInSec: number; error?: string }> {
  const db = await getDb();
  const [row] = await db.select({ c: schema.ndrCases, sh: schema.shipments, o: schema.orders, org: schema.orgs }).from(schema.ndrCases)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.ndrCases.shipmentId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.ndrCases.orgId))
    .where(eq(schema.ndrCases.id, caseId));
  if (!row || row.c.status !== "open") return { done: true }; // the client already decided
  const prev = ((row.c.requestPayload as CasePayload) ?? {}).aiCall;
  const attempts = (prev?.attempts ?? 0) + 1;
  const cfg = await ndrCallSettings();
  if (attempts > cfg.maxAttempts) return { done: true };
  const consignee = row.o.consignee as { name?: string; mobile?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
  const digits = String(consignee.mobile ?? "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(digits)) { await saveCall(caseId, { state: "skipped", attempts, note: "Buyer mobile number is missing or invalid", updatedAt: "" }); return { done: true }; }
  const own = await (await import("@/server/own-providers")).ownCalling(row.c.orgId);
  const acct = own ? null : await bolnaAccount();
  if (!own && !acct) { await saveCall(caseId, { state: "skipped", attempts, note: "AI calling is being set up by Vishwaship", updatedAt: "" }); return { done: true }; }
  // the client's own Bolna, or the free first month: no Vishwaship charge
  const credits = own || (await (await import("@/server/free-trial")).orgInFreeTrial(row.c.orgId)) ? 0 : await ndrCallCredits();
  const key = `${caseId}:${attempts}`;
  if (!(await holdCredits(row.c.orgId, key, credits))) {
    await saveCall(caseId, { state: "skipped", attempts, note: "Not enough notification credits", updatedAt: "" });
    await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: row.c.orgId, kind: "ndr", title: `AI NDR call not made for AWB ${row.sh.awb ?? ""}: no credits. Buy credits or act on the NDR yourself.`, href: "/portal/billing/notification-credits/" });
    return { done: true };
  }
  const ctx = own ? own.ctx : await providerContext(acct!);
  const userData = {
    buyer_name: String(consignee.name ?? "Customer").split(" ")[0], store_name: row.org.businessName, order_id: row.o.orderNumber, awb: row.sh.awb ?? "",
    courier: row.sh.carrierName, cod_amount: row.o.codAmountPaise > 0 ? `₹${(row.o.codAmountPaise / 100).toLocaleString("en-IN")}` : "prepaid",
    delivery_address: [consignee.line1, consignee.line2, consignee.city, consignee.pincode].filter(Boolean).join(", ").slice(0, 250), failure_reason: row.c.reason ?? "",
    attempt: String(row.c.attempt), case_id: caseId,
  };
  let execId = "", err = "";
  try {
    const r = await ctx.fetch(BOLNA, { method: "POST", timeoutMs: 20_000, headers: { authorization: `Bearer ${ctx.secrets.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ agent_id: ctx.secrets.agentId, recipient_phone_number: `+91${digits}`, user_data: userData }) });
    const j = (await r.json().catch(() => ({}))) as { execution_id?: string; id?: string; message?: string; detail?: string };
    if (r.ok && (j.execution_id || j.id)) execId = String(j.execution_id ?? j.id);
    else err = `Bolna: ${j.message ?? j.detail ?? `HTTP ${r.status}`}`.slice(0, 200);
    if (!execId && (r.status === 429 || r.status >= 500)) { await returnCredits(row.c.orgId, key, credits); return { retryInSec: 300, error: err }; }
  } catch (e) { await returnCredits(row.c.orgId, key, credits); return { retryInSec: 300, error: (e as Error).message }; }
  if (!execId) {
    await returnCredits(row.c.orgId, key, credits);
    await saveCall(caseId, { state: "failed", attempts, note: err || "Call could not be placed", updatedAt: "" });
    return { done: true };
  }
  await saveCall(caseId, { state: "calling", attempts, executionId: execId, credits, chargedKey: key, updatedAt: "" });
  await audit({ actorKind: "system", orgId: row.c.orgId, action: "ndr.ai_call_placed", targetType: "ndr_case", targetId: caseId, details: { attempt: attempts } });
  return { done: true };
}

// ---------------------------------------------------------------- webhook
/** Find the first value at any of these keys, searching nested objects (Bolna payloads vary by version). */
function deep(o: unknown, keys: string[], depth = 0): unknown {
  if (!o || typeof o !== "object" || depth > 5) return undefined;
  const r = o as Record<string, unknown>;
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  for (const v of Object.values(r)) if (v && typeof v === "object") { const x = deep(v, keys, depth + 1); if (x !== undefined) return x; }
  return undefined;
}

/** The buyer's answer from the agent's extracted data (or, failing that, the summary / transcript). */
export function decisionOf(body: Record<string, unknown>): { outcome: "reattempt" | "rto" | "unclear"; preferredDate?: string; newAddress?: string } {
  const ex = (deep(body, ["extracted_data", "extraction", "extracted"]) ?? {}) as Record<string, unknown>;
  const flat = JSON.stringify(ex).toLowerCase();
  const val = String(deep(ex, ["ndr_decision", "decision", "wants_delivery", "customer_decision", "intent", "outcome", "answer"]) ?? "").toLowerCase();
  const pick = (s: string) => /(re-?attempt|deliver|yes|haan|han|ha\b|true|accept|want)/.test(s) && !/(not|no\b|nahi|cancel|return|rto|refuse|false|don)/.test(s) ? "reattempt"
    : /(rto|return|cancel|no\b|nahi|refuse|false|reject|don'?t)/.test(s) ? "rto" : null;
  const summary = String(deep(body, ["summary", "transcript"]) ?? "").toLowerCase();
  const outcome = (val && pick(val)) || pick(flat) || (summary && pick(summary)) || "unclear";
  const preferredDate = deep(ex, ["preferred_date", "delivery_date", "date", "reschedule_date"]);
  const newAddress = deep(ex, ["new_address", "address_update", "updated_address", "address"]);
  return { outcome: outcome as "reattempt" | "rto" | "unclear", preferredDate: preferredDate ? String(preferredDate).slice(0, 60) : undefined, newAddress: newAddress ? String(newAddress).slice(0, 250) : undefined };
}

const CONNECTED = /completed|call-disconnected|disconnected|ended|finished|success/;
const NOT_CONNECTED = /no-answer|no_answer|busy|failed|canceled|cancelled|error|unanswered|not-connected/;

/** Bolna webhook (token already verified). Idempotent per execution and status. */
export async function handleBolnaWebhook(body: Record<string, unknown>): Promise<{ result: string }> {
  const execId = String(deep(body, ["execution_id", "id", "call_id"]) ?? "");
  const status = String(deep(body, ["status", "call_status"]) ?? "").toLowerCase();
  if (!execId) return { result: "ignored:no_id" };
  const db = await getDb();
  const ins = await db.insert(schema.inboundEvents).values({ id: newId("ie"), provider: "bolna", dedupeKey: `bolna:${execId}:${status}`, verified: true, payloadRedacted: { status, execId } }).onConflictDoNothing().returning({ id: schema.inboundEvents.id });
  if (!ins.length) return { result: "duplicate" };
  const [c] = await db.select().from(schema.ndrCases).where(sql`${schema.ndrCases.requestPayload}->'aiCall'->>'executionId' = ${execId}`);
  if (!c) return { result: "unmatched" };
  const call = ((c.requestPayload as CasePayload) ?? {}).aiCall;
  if (!call || ["completed", "no_answer", "failed"].includes(call.state)) return { result: "ignored:closed" };
  const duration = Number(deep(body, ["conversation_duration", "duration", "call_duration", "total_duration"]) ?? 0) || 0;
  if (!CONNECTED.test(status) && !NOT_CONNECTED.test(status)) return { result: `ok:progress:${status || "unknown"}` };
  // connected = the call ended normally and someone spoke (a duration, or at least a transcript)
  const connected = CONNECTED.test(status) && !NOT_CONNECTED.test(status) && (duration > 0 || !!deep(body, ["transcript"]));
  if (!connected) {
    if (call.chargedKey) await returnCredits(c.orgId, call.chargedKey, call.credits ?? 0);
    await saveCall(c.id, { ...call, state: "no_answer", durationSec: duration, credits: 0, note: "Buyer did not pick up" });
    const cfg = await ndrCallSettings();
    if (c.status === "open" && call.attempts < cfg.maxAttempts) {
      await enqueue("ndr.ai_call", { caseId: c.id }, { dedupeKey: `ndr.ai_call:${c.id}:${call.attempts + 1}`, runAt: new Date(Date.now() + cfg.retryMinutes * 60_000) });
    } else if (c.status === "open") {
      await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: c.orgId, kind: "ndr", title: "AI call: buyer did not answer. Please choose re-attempt or return on the NDR page.", href: "/portal/ndr/" });
    }
    return { result: "ok:no_answer" };
  }
  const d = decisionOf(body);
  await saveCall(c.id, { ...call, state: "completed", durationSec: duration, outcome: d.outcome, preferredDate: d.preferredDate, newAddress: d.newAddress });
  if (c.status !== "open") return { result: "ok:already_decided" };
  if (d.outcome === "unclear") {
    await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: c.orgId, kind: "ndr", title: "AI call done but the buyer’s answer was unclear — please decide on the NDR page.", href: "/portal/ndr/" });
    return { result: "ok:unclear" };
  }
  const r = await requestNdrAction({ caseId: c.id, kind: d.outcome, source: "ai_call" });
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: c.orgId, kind: "ndr", title: d.outcome === "reattempt" ? `Buyer wants the parcel — ${r.message.toLowerCase()}.` : `Buyer does not want the parcel — ${r.message.toLowerCase()}.`, href: "/portal/ndr/" });
  return { result: `ok:${d.outcome}:${r.status}` };
}

/** Admin list helper: cases with a call in flight that never heard back (for support). */
export const callsInFlight = () => and(inArray(schema.ndrCases.status, ["open"]), sql`${schema.ndrCases.requestPayload}->'aiCall'->>'state' = 'calling'`);
