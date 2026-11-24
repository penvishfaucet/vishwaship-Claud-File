import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { activeService } from "@/server/integrations/services";
import { safeFetch } from "@/server/security/safe-fetch";
import { newId } from "@/server/util/ids";
import { codRowsFromMail, importCodReceipts } from "@/server/cod/receipts";
import { importWeightReport, parseCourierMails } from "./service";

/**
 * Courier weight-discrepancy e-mails, read automatically.
 *
 * Setup (once): the owner's mailbox forwards the courier's discrepancy mails (Gmail filter → forward) to the Resend
 * receiving address; Resend posts an "email.received" webhook here (signed, Svix scheme); we fetch the mail body from
 * the Resend Receiving API and raise the discrepancies exactly like Admin → Weight Disputes → paste e-mail.
 *
 * Safety: only mails whose original sender is the courier (delhivery.com) are acted on, and only when they match the
 * courier's discrepancy wording and an existing Vishwaship LR. Every inbound mail is logged (inbound_events,
 * provider "courier_mail") so Admin can see what came in — including the Gmail forwarding confirmation mail.
 */

/** The only address read: the owner's Gmail forwards courier mails here. Mail to other addresses (support@ …) is left alone. */
export const COURIER_INBOX = /^noreply@vishwaship\.(com|in)$/i;
export const TRUSTED_SENDER = /@([a-z0-9-]+\.)*delhivery\.com$/i;
const MAX_TEXT = 20_000;

/** Svix / Resend webhook signature: HMAC-SHA256(base64-decoded secret after "whsec_", `${id}.${timestamp}.${body}`), header "v1,<base64> …". */
export function verifyWebhookSignature(raw: string, h: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, now = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.replace(/^whsec_/, ""), "base64"); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${raw}`).digest();
  return h.signature.split(/\s+/).some((part) => {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** HTML mail → plain text good enough for the courier's tables (cells separated by spaces, rows by new lines). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#8377;|&#x20b9;/gi, "₹").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/** The mail's own From address. Text inside the body ("Forwarded message … From: …") is never trusted — anyone can type it. */
export function originalSender(from: string): string {
  return ((from.match(/<([^>]+)>/)?.[1] ?? from).trim()).toLowerCase();
}

export type InboundOutcome = { status: "raised" | "cod_recorded" | "no_match" | "ignored" | "error"; message: string; created?: number };

/** Act on one received mail (already authenticated as coming from Resend). */
export async function processCourierMail(m: { from: string; subject: string; text: string; dkimFailed?: boolean }): Promise<InboundOutcome> {
  const sender = originalSender(m.from);
  if (!TRUSTED_SENDER.test(sender)) return { status: "ignored", message: `Not from the courier (${sender || "unknown sender"})` };
  if (m.dkimFailed) return { status: "ignored", message: "Courier signature (DKIM) failed — not acted on; paste it manually if genuine" };
  if (!parseCourierMails(m.text).length) {
    // the courier's COD remittance mail: record what it paid per AWB (clients are paid from it in Admin → COD Remittance)
    const cod = codRowsFromMail(m.subject, m.text);
    if (cod.length) {
      const r = await importCodReceipts(cod, { source: "delhivery_mail", fileName: m.subject.slice(0, 200) || null, actorUserId: null, commit: true });
      return { status: "cod_recorded", message: `COD remittance: ${cod.length} AWB, ${r.matched} matched, ${r.flagged} to check, ₹${(r.totalPaise / 100).toFixed(2)}`, created: r.matched };
    }
    return { status: "ignored", message: "Not a weight-discrepancy or COD remittance mail" };
  }
  const r = await importWeightReport(m.text, { commit: true, actorUserId: null });
  if (r.error) return { status: "error", message: r.error };
  const notes = r.rows.map((x) => `LR ${x.ref}: ${x.status === "ok" ? "raised" : x.message ?? x.status}`).join("; ");
  return { status: r.created ? "raised" : "no_match", message: notes.slice(0, 900), created: r.created };
}

type Received = { from?: string; subject?: string; text?: string | null; html?: string | null; authentication?: Record<string, unknown> };

/** Resend "email.received" webhook body (raw, signature already checked). Dedupe on the email id. */
export async function handleReceivedWebhook(raw: string): Promise<{ ok: boolean; message: string }> {
  let evt: { type?: string; data?: { email_id?: string; from?: string; subject?: string; to?: unknown; received_for?: unknown } };
  try { evt = JSON.parse(raw); } catch { return { ok: false, message: "Body is not JSON" }; }
  if (evt.type !== "email.received" || !evt.data?.email_id) return { ok: true, message: "Ignored event" };
  const rcpts = [evt.data.to, evt.data.received_for].flat().filter((x): x is string => typeof x === "string").map((x) => originalSender(x));
  if (!rcpts.some((x) => COURIER_INBOX.test(x))) return { ok: true, message: "Not for the courier inbox" };
  const emailId = String(evt.data.email_id);
  const db = await getDb();
  const id = newId("ie");
  const ins = await db.insert(schema.inboundEvents).values({ id, provider: "courier_mail", dedupeKey: `courier_mail:${emailId}`, verified: true,
    payloadRedacted: { from: String(evt.data.from ?? "").slice(0, 200), subject: String(evt.data.subject ?? "").slice(0, 300) } }).onConflictDoNothing().returning({ id: schema.inboundEvents.id });
  if (!ins.length) return { ok: true, message: "Duplicate" };
  let outcome: InboundOutcome; let text = "";
  try {
    const mail = await fetchReceived(emailId);
    text = (mail.text?.trim() ? mail.text : htmlToText(mail.html ?? "")).slice(0, MAX_TEXT);
    const dkim = JSON.stringify(mail.authentication?.dkim ?? "");
    outcome = await processCourierMail({ from: mail.from ?? String(evt.data.from ?? ""), subject: mail.subject ?? "", text, dkimFailed: !!mail.authentication?.dkim && /fail/i.test(dkim) && !/pass/i.test(dkim) });
  } catch (e) { outcome = { status: "error", message: (e as Error).message.slice(0, 300) }; }
  await db.update(schema.inboundEvents).set({
    processedAt: new Date(), error: outcome.status === "error" ? outcome.message : null,
    payloadRedacted: { from: String(evt.data.from ?? "").slice(0, 200), subject: String(evt.data.subject ?? "").slice(0, 300), status: outcome.status, result: outcome.message, preview: text.slice(0, 1500) },
  }).where(eq(schema.inboundEvents.id, id));
  return { ok: true, message: outcome.message };
}

async function fetchReceived(emailId: string): Promise<Received> {
  const v = await activeService("resend");
  const key = (v?.inboundApiKey || v?.apiKey || process.env.RESEND_API_KEY || "").trim();
  if (!key) throw new Error("Resend is not set up (Admin → API Keys & Services)");
  const r = await safeFetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { allowedHosts: ["api.resend.com"], timeoutMs: 15_000, headers: { authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`Could not read the mail from Resend (HTTP ${r.status})${r.status === 401 || r.status === 403 ? " — the Resend key needs Full access" : ""}`);
  return (await r.json()) as Received;
}

export async function inboundSecret() {
  return ((await activeService("resend"))?.inboundSecret || process.env.RESEND_INBOUND_SECRET || "").trim();
}

/** Latest inbound courier mails for Admin (what came in and what was done). */
export async function recentCourierMails(limit = 15) {
  const db = await getDb();
  return db.select().from(schema.inboundEvents).where(eq(schema.inboundEvents.provider, "courier_mail")).orderBy(desc(schema.inboundEvents.createdAt)).limit(limit);
}
