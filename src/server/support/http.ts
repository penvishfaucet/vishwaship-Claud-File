import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { getPrivate } from "@/server/storage";
import type { TicketAttachment } from "@/lib/support";
import { TicketError } from "./tickets";

export const ticketErrorResponse = (e: unknown) =>
  e instanceof TicketError ? apiError(e.status, e.status === 404 ? "not_found" : e.status === 409 ? "conflict" : "validation_error", e.message) : null;

/** Read one form field as text. */
export const field = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
export const fileField = (fd: FormData, k: string) => { const v = fd.get(k); return v && typeof v === "object" && "arrayBuffer" in v && (v as File).size > 0 ? (v as File) : null; };

/**
 * Stream one attachment of a ticket message. The caller has already checked who may read the ticket;
 * here we only make sure the message belongs to that ticket.
 */
export async function serveAttachment(ticketId: string, url: URL) {
  const m = url.searchParams.get("m") ?? "", i = Number(url.searchParams.get("i") ?? "0");
  const db = await getDb();
  const [msg] = await db.select({ a: schema.ticketMessages.attachments }).from(schema.ticketMessages).where(and(eq(schema.ticketMessages.id, m), eq(schema.ticketMessages.ticketId, ticketId)));
  const att = (msg?.a as TicketAttachment[] | undefined)?.[i];
  if (!att) return apiError(404, "not_found", "File not found");
  const buf = await getPrivate(att.key);
  const inline = att.kind !== "document" || att.mime === "application/pdf";
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": att.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${att.name.replace(/"/g, "")}"`,
      "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
