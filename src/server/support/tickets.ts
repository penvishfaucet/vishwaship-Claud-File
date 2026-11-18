import "server-only";
import { and, count, eq, or, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { newKey, putPrivate } from "@/server/storage";
import { newId } from "@/server/util/ids";
import {
  CATEGORY_KEYS, COMMENT_MAX, FILE_LIMITS, type FileKind, MESSAGE_MAX, type TicketAttachment, categoryLabel, categoryNeedsRef,
} from "@/lib/support";

export class TicketError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const isUnique = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string }; message?: string };
  return x?.code === "23505" || x?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(x?.message ?? "");
};

// ------------------------------------------------------------------ attachments

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, at: number, s: string) => b.subarray(at, at + s.length).toString("latin1") === s;

/** Decide the file kind and type from its content (magic bytes), never from the browser-supplied type. */
export function sniffTicketFile(buf: Buffer, name: string): { kind: FileKind; mime: string; ext: string } | null {
  const ext = (name.toLowerCase().split(".").pop() ?? "").replace(/[^a-z0-9]/g, "");
  if (buf.length === 0) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png", ext: "png" };
  if (ascii(buf, 0, "GIF8")) return { kind: "image", mime: "image/gif", ext: "gif" };
  if (ascii(buf, 0, "RIFF") && ascii(buf, 8, "WEBP")) return { kind: "image", mime: "image/webp", ext: "webp" };
  if (ascii(buf, 0, "RIFF") && ascii(buf, 8, "WAVE")) return { kind: "audio", mime: "audio/wav", ext: "wav" };
  if (ascii(buf, 0, "%PDF")) return { kind: "document", mime: "application/pdf", ext: "pdf" };
  if (ascii(buf, 0, "OggS")) return { kind: "audio", mime: "audio/ogg", ext: "ogg" };
  if (ascii(buf, 0, "ID3") || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0)) return { kind: "audio", mime: "audio/mpeg", ext: "mp3" };
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return { kind: "audio", mime: "audio/aac", ext: "aac" };
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: "video", mime: "video/webm", ext: "webm" };
  if (ascii(buf, 4, "ftyp")) {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (ext === "m4a" || brand.startsWith("M4A")) return { kind: "audio", mime: "audio/mp4", ext: "m4a" };
    if (brand.startsWith("qt")) return { kind: "video", mime: "video/quicktime", ext: "mov" };
    if (brand.startsWith("3g")) return { kind: "video", mime: "video/3gpp", ext: "3gp" };
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "docx") return { kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
    if (ext === "xlsx") return { kind: "document", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    return null;
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0])) {
    if (ext === "doc") return { kind: "document", mime: "application/msword", ext: "doc" };
    if (ext === "xls") return { kind: "document", mime: "application/vnd.ms-excel", ext: "xls" };
    return null;
  }
  if (ext === "csv" || ext === "txt") {
    const head = buf.subarray(0, 8192);
    if (head.includes(0)) return null;
    try { new TextDecoder("utf-8", { fatal: true }).decode(head); } catch { return null; }
    return { kind: "document", mime: ext === "csv" ? "text/csv" : "text/plain", ext };
  }
  return null;
}

const MAX_ANY = Math.max(...Object.values(FILE_LIMITS));

/** Validate (type + per-kind size) and store one uploaded file, encrypted, under the ticket. */
export async function storeTicketFile(ticketId: string, file: File): Promise<TicketAttachment> {
  if (file.size > MAX_ANY) throw new TicketError(413, "Files can be up to 5 MB (images up to 2 MB).");
  const buf = Buffer.from(await file.arrayBuffer());
  const t = sniffTicketFile(buf, file.name);
  if (!t) throw new TicketError(415, "This file type is not allowed. Use an image, audio, video, PDF, Word, Excel, CSV or text file.");
  if (buf.length > FILE_LIMITS[t.kind]) throw new TicketError(413, `${t.kind[0].toUpperCase()}${t.kind.slice(1)} files can be up to ${FILE_LIMITS[t.kind] / 1024 / 1024} MB.`);
  const key = newKey(`tickets/${ticketId.replace(/[^a-z0-9_-]/gi, "")}`.toLowerCase(), t.ext);
  await putPrivate(key, buf);
  const name = (file.name || `attachment.${t.ext}`).replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  return { key, name, mime: t.mime, size: buf.length, kind: t.kind };
}

// ------------------------------------------------------------------ shipment reference

/** Order ID, AWB or LR → the customer's own order / shipment (null when it is not theirs or does not exist). */
export async function resolveRef(orgId: string, raw: string) {
  const ref = raw.trim();
  if (!ref) return null;
  const db = await getDb();
  const up = ref.toUpperCase();
  const [s] = await db.select({ id: schema.shipments.id, awb: schema.shipments.awb, orderId: schema.shipments.orderId }).from(schema.shipments)
    .where(and(eq(schema.shipments.orgId, orgId), or(eq(schema.shipments.awb, up), eq(schema.shipments.awb, ref), eq(schema.shipments.lrNumber, up), eq(schema.shipments.lrNumber, ref)))).limit(1);
  if (s) {
    const [o] = await db.select({ id: schema.orders.id, n: schema.orders.orderNumber }).from(schema.orders).where(and(eq(schema.orders.id, s.orderId), eq(schema.orders.orgId, orgId)));
    return { orderId: o?.id ?? null, orderNumber: o?.n ?? null, shipmentId: s.id, awb: s.awb };
  }
  const [o] = await db.select({ id: schema.orders.id, n: schema.orders.orderNumber }).from(schema.orders)
    .where(and(eq(schema.orders.orgId, orgId), or(eq(schema.orders.orderNumber, up), eq(schema.orders.orderNumber, ref), eq(schema.orders.externalOrderId, ref)))).limit(1);
  if (!o) return null;
  const [sh] = await db.select({ id: schema.shipments.id, awb: schema.shipments.awb }).from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, o.id), eq(schema.shipments.orgId, orgId))).orderBy(sql`${schema.shipments.createdAt} desc`).limit(1);
  return { orderId: o.id, orderNumber: o.n, shipmentId: sh?.id ?? null, awb: sh?.awb ?? null };
}

// ------------------------------------------------------------------ create / reply

async function nextNumber() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.tickets);
  return Number(n);
}

/**
 * Raise a ticket: one Open ticket with the comment as its first message.
 * `idemKey` (from the form) makes retries and double clicks return the same ticket.
 */
export async function createTicket(a: { orgId: string; userId: string; category: string; ref?: string; comment: string; file?: File | null; idemKey: string }) {
  const db = await getDb();
  const idem = a.idemKey.slice(0, 64);
  const existing = async () => (await db.select({ id: schema.tickets.id }).from(schema.tickets).where(and(eq(schema.tickets.orgId, a.orgId), eq(schema.tickets.idemKey, idem))))[0];
  const done = await existing();
  if (done) return { id: done.id, replay: true };

  if (!(CATEGORY_KEYS as string[]).includes(a.category)) throw new TicketError(400, "Select a category.");
  const comment = a.comment.trim();
  if (!comment) throw new TicketError(400, "Write a comment.");
  if (comment.length > COMMENT_MAX) throw new TicketError(400, `Comment can be up to ${COMMENT_MAX} characters.`);
  const refText = (a.ref ?? "").trim().slice(0, 60);
  if (categoryNeedsRef(a.category) && !refText) throw new TicketError(400, `Enter the Order ID or AWB number for “${categoryLabel(a.category)}”.`);
  const ref = refText ? await resolveRef(a.orgId, refText) : null;
  if (refText && !ref) throw new TicketError(400, `We could not find “${refText}” in your orders. Check the Order ID or AWB number.`);

  const id = newId("tkt");
  const attachments = a.file && a.file.size > 0 ? [await storeTicketFile(id, a.file)] : [];
  const base = await nextNumber();
  for (let i = 0; i < 5; i++) {
    try {
      await db.insert(schema.tickets).values({
        id, orgId: a.orgId, number: `VT${10001 + base + i}`, category: a.category, subject: comment.slice(0, 80), status: "open", idemKey: idem,
        shipmentId: ref?.shipmentId ?? null, awb: ref?.awb ?? null, orderId: ref?.orderId ?? null, orderNumber: ref?.orderNumber ?? null,
      });
      break;
    } catch (e) {
      if (!isUnique(e)) throw e;
      const again = await existing(); // the same submission arrived twice
      if (again) return { id: again.id, replay: true };
      if (i === 4) throw new TicketError(409, "Could not create the ticket, please try again.");
    }
  }
  await db.insert(schema.ticketMessages).values({ id: newId("tm"), ticketId: id, authorUserId: a.userId, authorKind: "customer", body: comment, attachments, clientId: idem });
  await audit({ actorUserId: a.userId, actorKind: "customer", orgId: a.orgId, action: "ticket.create", targetType: "ticket", targetId: id, details: { category: a.category, ref: !!ref, files: attachments.length } });
  return { id, replay: false };
}

/** Add a message (customer or staff) to a ticket. `clientId` makes a retried send idempotent. */
export async function addMessage(a: { ticketId: string; userId: string; authorKind: "customer" | "staff"; body: string; file?: File | null; clientId: string; status?: "open" | "resolved" | "closed" }) {
  const db = await getDb();
  const clientId = a.clientId.slice(0, 64);
  const [dup] = await db.select({ id: schema.ticketMessages.id }).from(schema.ticketMessages).where(and(eq(schema.ticketMessages.ticketId, a.ticketId), eq(schema.ticketMessages.clientId, clientId)));
  if (dup) return { id: dup.id, replay: true };
  const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, a.ticketId));
  if (!t) throw new TicketError(404, "Ticket not found");
  if (a.authorKind === "customer" && t.status === "closed") throw new TicketError(409, "This ticket is closed. Raise a new ticket if you still need help.");
  const body = a.body.trim();
  if (body.length > MESSAGE_MAX) throw new TicketError(400, `Messages can be up to ${MESSAGE_MAX} characters.`);
  const hasFile = !!a.file && a.file.size > 0;
  if (!body && !hasFile && !a.status) throw new TicketError(400, "Type a message or attach a file.");
  const attachments = hasFile ? [await storeTicketFile(t.id, a.file!)] : [];
  let msgId: string | null = null;
  if (body || attachments.length) {
    msgId = newId("tm");
    try {
      await db.insert(schema.ticketMessages).values({ id: msgId, ticketId: t.id, authorUserId: a.userId, authorKind: a.authorKind, body, attachments, clientId });
    } catch (e) {
      if (!isUnique(e)) throw e;
      const [again] = await db.select({ id: schema.ticketMessages.id }).from(schema.ticketMessages).where(and(eq(schema.ticketMessages.ticketId, t.id), eq(schema.ticketMessages.clientId, clientId)));
      return { id: again?.id ?? null, replay: true };
    }
  }
  // customer reply re-opens a resolved ticket; staff sets the status explicitly
  const status = a.authorKind === "staff" ? (a.status ?? (t.status === "closed" || t.status === "resolved" ? t.status : "open")) : t.status === "resolved" ? "open" : t.status;
  await db.update(schema.tickets).set({ status, updatedAt: new Date() }).where(eq(schema.tickets.id, t.id));
  return { id: msgId, replay: false, status, orgId: t.orgId, number: t.number };
}
