import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { getPrivate, newKey, putPrivate } from "@/server/storage";
import { sniffTicketFile } from "@/server/support/tickets";

type Signed = { key: string; name: string; mime: string; size: number; uploadedAt: string };
const MAX = 10 * 1024 * 1024;

/** A manifest of this account (or any account when orgId is null — staff). */
export async function findManifest(id: string, orgId: string | null) {
  const db = await getDb();
  const [m] = await db.select().from(schema.manifests).where(orgId ? and(eq(schema.manifests.id, id), eq(schema.manifests.orgId, orgId)) : eq(schema.manifests.id, id));
  return m ?? null;
}

export async function servePdf(m: typeof schema.manifests.$inferSelect) {
  const buf = await getPrivate(m.pdfKey);
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="manifest-${m.manifestNo}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

export async function serveSigned(m: typeof schema.manifests.$inferSelect) {
  const s = m.signedCopy as Signed | null;
  if (!s) return apiError(404, "not_found", "No signed copy uploaded for this manifest");
  const buf = await getPrivate(s.key);
  return new Response(new Uint8Array(buf), { headers: { "content-type": s.mime, "content-disposition": `inline; filename="${s.name.replace(/"/g, "")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } });
}

/** Signed copy: a photo (JPG / PNG / WEBP) or a PDF scan, up to 10 MB. Replaces an earlier upload. */
export async function storeSigned(m: typeof schema.manifests.$inferSelect, file: File) {
  if (file.size > MAX) return { ok: false as const, message: "The signed copy can be up to 10 MB" };
  const buf = Buffer.from(await file.arrayBuffer());
  const t = sniffTicketFile(buf, file.name);
  if (!t || !(t.kind === "image" || t.mime === "application/pdf")) return { ok: false as const, message: "Upload a photo (JPG, PNG, WEBP) or a PDF scan of the signed manifest" };
  const key = newKey(`manifests/${m.orgId.replace(/[^a-z0-9_-]/gi, "").toLowerCase()}/signed`, t.ext);
  await putPrivate(key, buf);
  const signed: Signed = { key, name: (file.name || `signed-${m.manifestNo}.${t.ext}`).replace(/[^\w.\- ()]/g, "_").slice(0, 120), mime: t.mime, size: buf.length, uploadedAt: new Date().toISOString() };
  const db = await getDb();
  await db.update(schema.manifests).set({ signedCopy: signed }).where(eq(schema.manifests.id, m.id));
  return { ok: true as const, signed };
}
