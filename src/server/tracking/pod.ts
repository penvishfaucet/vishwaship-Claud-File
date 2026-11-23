import "server-only";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { enqueue } from "@/server/jobs/runner";
import { adapterFor, providerContext } from "@/server/providers/registry";
import type { PodResult } from "@/server/providers/types";
import { safeFetch } from "@/server/security/safe-fetch";
import { deliveryModeFromScans } from "@/lib/tracking-timeline";
import { getPrivate, putPrivate } from "@/server/storage";

/**
 * Proof of Delivery: copied from the courier into private storage when a shipment is delivered, so customers only ever
 * download our own copy (courier links expire and can name the aggregator). Couriers often publish the POD hours after
 * the delivery scan, so "pending" rows are retried with back-off for about a week, then marked "failed".
 * A courier without a documented POD API is "unsupported" — nothing is ever made up.
 */
export const POD_BACKOFF_MIN = [30, 120, 360, 720, 1440, 1440, 2880, 2880]; // ≈ 7 days in total
const MAX_BYTES = 8 * 1024 * 1024;

const MAGIC: Array<[string, string, number[]]> = [
  ["application/pdf", "pdf", [0x25, 0x50, 0x44, 0x46]], ["image/png", "png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", "jpg", [0xff, 0xd8, 0xff]],
  ["image/gif", "gif", [0x47, 0x49, 0x46, 0x38]],
];
/** File type by content (never by the courier's header). WEBP = "RIFF....WEBP". */
export function sniffPod(b: Uint8Array): { mime: string; ext: string } | null {
  if (!b.length || b.length > MAX_BYTES) return null;
  for (const [mime, ext, sig] of MAGIC) if (sig.every((x, i) => b[i] === x)) return { mime, ext };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

/** Courier file links (often S3) are https-only, private addresses refused; up to 2 redirects, each re-checked. */
export async function downloadPodFile(url: string, fetcher: typeof safeFetch = safeFetch): Promise<Uint8Array> {
  let at = url;
  for (let hop = 0; hop < 3; hop++) {
    const r = await fetcher(at, { timeoutMs: 25_000 });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { at = new URL(r.headers.get("location")!, at).toString(); continue; }
    if (!r.ok) throw new Error(`POD file download failed (HTTP ${r.status})`);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error("POD file is too large");
    return new Uint8Array(await r.arrayBuffer());
  }
  throw new Error("POD file link redirected too many times");
}

const nextRetry = (attempts: number, now: Date) => {
  const m = POD_BACKOFF_MIN[attempts - 1];
  return m === undefined ? null : new Date(now.getTime() + m * 60_000);
};

async function upsert(shipmentId: string, orgId: string, patch: Partial<typeof schema.shipmentPods.$inferInsert>) {
  const db = await getDb();
  await db.insert(schema.shipmentPods).values({ shipmentId, orgId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.shipmentPods.shipmentId, set: { ...patch, updatedAt: new Date() } });
}

/** "otp" / "pod" as stated in the shipment's own delivery scans. */
async function modeFromScans(shipmentId: string) {
  const db = await getDb();
  const ev = await db.select({ status: schema.shipmentEvents.status, rawStatus: schema.shipmentEvents.rawStatus, remark: schema.shipmentEvents.remark, occurredAt: schema.shipmentEvents.occurredAt })
    .from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, shipmentId));
  return deliveryModeFromScans(ev);
}

/** Called when a delivery scan arrives: open the POD row and try at once. */
export async function queuePodFetch(shipmentId: string) {
  await enqueue("pod.fetch", { shipmentId }, { dedupeKey: `pod:${shipmentId}:first` });
}

/**
 * One attempt. Returns the row's new state. Safe to call repeatedly (an "available" POD is never fetched again
 * unless `force`). Errors are recorded on the row, never thrown.
 */
export async function fetchPod(shipmentId: string, opts: { now?: Date; force?: boolean; download?: (url: string) => Promise<Uint8Array> } = {}): Promise<string> {
  const now = opts.now ?? new Date();
  const db = await getDb();
  const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (!sh) return "missing";
  const [row] = await db.select().from(schema.shipmentPods).where(eq(schema.shipmentPods.shipmentId, shipmentId));
  if (row && !opts.force && (row.state === "available" || row.state === "unsupported")) return row.state;
  if (sh.status !== "delivered" || !sh.awb) return row?.state ?? "not_delivered";
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, sh.providerAccountId));
  const ad = acct ? adapterFor(acct) : null;
  if (!ad?.pod || !ad.implemented.includes("pod")) {
    await upsert(shipmentId, sh.orgId, { state: "unsupported", nextAttemptAt: null, lastError: null, deliveredAt: sh.deliveredAt, deliveryMode: await modeFromScans(shipmentId) });
    return "unsupported";
  }
  const attempts = (row?.attempts ?? 0) + 1;
  const scanMode = await modeFromScans(shipmentId);
  let saidMode: "otp" | "pod" | null = null;
  const retry = async (message: string) => {
    const at = nextRetry(attempts, now);
    await upsert(shipmentId, sh.orgId, { state: at ? "pending" : "failed", attempts, nextAttemptAt: at, lastError: message.slice(0, 300), deliveredAt: sh.deliveredAt, deliveryMode: saidMode ?? scanMode ?? row?.deliveryMode ?? null });
    return at ? "pending" : "failed";
  };
  let res;
  try { res = await ad.pod(await providerContext(acct), { awb: sh.awb, providerOrderRef: sh.providerOrderRef ?? "", lrNumber: sh.lrNumber }); }
  catch (e) { return retry((e as Error).message); }
  if (!res.ok) {
    if (res.error.category === "unsupported") { await upsert(shipmentId, sh.orgId, { state: "unsupported", nextAttemptAt: null, deliveredAt: sh.deliveredAt }); return "unsupported"; }
    return retry(res.error.message);
  }
  saidMode = res.value.deliveryMode ?? null;
  if (!res.value.ready || !res.value.files.length) return retry(saidMode === "otp" || scanMode === "otp" ? "OTP-based delivery: the courier has not shared a POD document" : "Courier has not published the POD yet");
  try {
    const saved = await storePodFiles(sh.orgId, shipmentId, res.value, opts.download ?? ((u) => downloadPodFile(u)));
    if (!saved.fileKey && !saved.signatureKey) return retry("Courier POD file could not be read (not a PDF or image)");
    await upsert(shipmentId, sh.orgId, {
      state: "available", attempts, nextAttemptAt: null, lastError: null, fetchedAt: now, ...saved,
      receiverName: res.value.receiverName ?? null, receiverRelation: res.value.receiverRelation ?? null,
      deliveryMode: res.value.deliveryMode === "otp" || scanMode === "otp" ? "otp" : "pod",
      deliveredAt: res.value.deliveredAt ? new Date(res.value.deliveredAt) : sh.deliveredAt,
    });
    return "available";
  } catch (e) { return retry((e as Error).message); }
}

/** Download / validate / encrypt-store each courier file. A signature alone still counts as the POD document. */
export async function storePodFiles(orgId: string, shipmentId: string, pod: PodResult, download: (url: string) => Promise<Uint8Array>) {
  const out: { fileKey?: string; fileMime?: string; signatureKey?: string; signatureMime?: string } = {};
  for (const f of pod.files) {
    if ((f.kind === "pod" && out.fileKey) || (f.kind === "signature" && out.signatureKey)) continue;
    const bytes = f.data ?? (f.url ? await download(f.url) : null);
    const type = bytes ? sniffPod(bytes) : null;
    if (!bytes || !type) continue;
    const key = `pods/${orgId}/${shipmentId}-${f.kind}.${type.ext}`.toLowerCase();
    await putPrivate(key, Buffer.from(bytes));
    if (f.kind === "pod") { out.fileKey = key; out.fileMime = type.mime; } else { out.signatureKey = key; out.signatureMime = type.mime; }
  }
  if (!out.fileKey && out.signatureKey) { out.fileKey = out.signatureKey; out.fileMime = out.signatureMime; delete out.signatureKey; delete out.signatureMime; }
  return out;
}

/** Sweep (every few minutes): open rows for delivered shipments (last 30 days) and queue the due retries. */
export async function sweepPods(now = new Date()) {
  const db = await getDb();
  const since = new Date(now.getTime() - 30 * 86400_000);
  const missing = await db.select({ id: schema.shipments.id }).from(schema.shipments)
    .leftJoin(schema.shipmentPods, eq(schema.shipmentPods.shipmentId, schema.shipments.id))
    .where(and(eq(schema.shipments.status, "delivered"), gte(schema.shipments.deliveredAt, since), isNull(schema.shipmentPods.shipmentId))).limit(100);
  const due = await db.select({ id: schema.shipmentPods.shipmentId, attempts: schema.shipmentPods.attempts }).from(schema.shipmentPods)
    .where(and(eq(schema.shipmentPods.state, "pending"), or(isNull(schema.shipmentPods.nextAttemptAt), lte(schema.shipmentPods.nextAttemptAt, now)))).limit(100);
  for (const s of missing) await enqueue("pod.fetch", { shipmentId: s.id }, { dedupeKey: `pod:${s.id}:first` });
  for (const s of due) await enqueue("pod.fetch", { shipmentId: s.id }, { dedupeKey: `pod:${s.id}:${s.attempts}` });
  return { opened: missing.length, retried: due.length };
}

export type PodView = {
  state: "available" | "pending" | "unsupported" | "failed" | "not_delivered";
  receiverName: string | null; receiverRelation: string | null; deliveredAt: string | null;
  mime: string | null; hasSignature: boolean; signatureMime: string | null;
  /** How the delivery was proved: buyer OTP, or a POD (signed copy / photo). null = the courier did not say. */
  deliveryMode: "otp" | "pod" | null;
};

/** POD card data. `orgId` null = Admin (caller already checked staff permission). Other orgs' shipments → null. */
export async function podView(shipmentId: string, orgId: string | null): Promise<PodView | null> {
  const db = await getDb();
  const [sh] = await db.select({ status: schema.shipments.status, orgId: schema.shipments.orgId, deliveredAt: schema.shipments.deliveredAt, provider: schema.shipments.provider, acct: schema.shipments.providerAccountId })
    .from(schema.shipments).where(and(eq(schema.shipments.id, shipmentId), orgId ? eq(schema.shipments.orgId, orgId) : undefined));
  if (!sh) return null;
  const [row] = await db.select().from(schema.shipmentPods).where(eq(schema.shipmentPods.shipmentId, shipmentId));
  const mode = (row?.deliveryMode as "otp" | "pod" | null | undefined) ?? (sh.status === "delivered" ? await modeFromScans(shipmentId) : null) ?? (row?.state === "available" ? "pod" : null);
  const base = { deliveryMode: mode, receiverName: row?.receiverName ?? null, receiverRelation: row?.receiverRelation ?? null, deliveredAt: (row?.deliveredAt ?? sh.deliveredAt)?.toISOString() ?? null, mime: row?.fileMime ?? null, hasSignature: !!row?.signatureKey, signatureMime: row?.signatureMime ?? null };
  if (row?.state === "available" && row.fileKey) return { state: "available", ...base };
  if (sh.status !== "delivered") return { state: "not_delivered", ...base };
  if (row?.state === "unsupported" || row?.state === "failed") return { state: row.state, ...base };
  if (!row) {
    // not tried yet: answer from the adapter so a courier without POD support never shows "fetching"
    const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, sh.acct));
    const ad = acct ? adapterFor(acct) : null;
    if (!ad?.pod || !ad.implemented.includes("pod")) return { state: "unsupported", ...base };
  }
  return { state: "pending", ...base };
}

/** The stored file for an authorised viewer. `orgId` null = Admin. */
export async function podFile(shipmentId: string, orgId: string | null, part: "pod" | "signature") {
  const db = await getDb();
  const [row] = await db.select({ p: schema.shipmentPods, awb: schema.shipments.awb }).from(schema.shipmentPods)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentPods.shipmentId))
    .where(and(eq(schema.shipmentPods.shipmentId, shipmentId), eq(schema.shipmentPods.state, "available"), orgId ? eq(schema.shipments.orgId, orgId) : undefined));
  if (!row) return null;
  const key = part === "signature" ? row.p.signatureKey : row.p.fileKey;
  const mime = part === "signature" ? row.p.signatureMime : row.p.fileMime;
  if (!key || !mime) return null;
  let data: Buffer;
  try { data = await getPrivate(key); } catch (e) { console.error("[pod] stored file unreadable", shipmentId, (e as Error).message); return null; }
  return { data, mime, name: `POD-${row.awb ?? shipmentId}${part === "signature" ? "-signature" : ""}.${key.split(".").pop()}` };
}

/** Available PODs for a list of shipments of one org (bulk ZIP). */
export async function podFilesForOrg(orgId: string | null, shipmentIds: string[]) {
  if (!shipmentIds.length) return [];
  const db = await getDb();
  const rows = await db.select({ id: schema.shipmentPods.shipmentId }).from(schema.shipmentPods)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentPods.shipmentId))
    .where(and(inArray(schema.shipmentPods.shipmentId, shipmentIds.slice(0, 200)), eq(schema.shipmentPods.state, "available"), orgId ? eq(schema.shipments.orgId, orgId) : undefined));
  const out: Array<{ name: string; data: Buffer }> = [];
  for (const r of rows) { const f = await podFile(r.id, orgId, "pod"); if (f) out.push({ name: f.name, data: f.data }); }
  return out;
}

/** POD state per shipment for list pages (one query). */
export async function podStates(shipmentIds: string[]) {
  if (!shipmentIds.length) return new Map<string, string>();
  const db = await getDb();
  const rows = await db.select({ id: schema.shipmentPods.shipmentId, state: schema.shipmentPods.state }).from(schema.shipmentPods).where(inArray(schema.shipmentPods.shipmentId, shipmentIds));
  return new Map(rows.map((r) => [r.id, r.state]));
}
