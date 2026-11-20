import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

/** Store images (logo, banners, product photos). Ids are random and immutable: a new upload gets a new id. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^sm_[A-Za-z0-9]{8,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [m] = await db.select({ mime: schema.storeMedia.mime, data: schema.storeMedia.data }).from(schema.storeMedia).where(eq(schema.storeMedia.id, id));
  if (!m) return new Response("Not found", { status: 404 });
  const data = Buffer.from(m.data);
  return new Response(new Uint8Array(data), {
    headers: { "content-type": m.mime, "content-length": String(data.length), "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" },
  });
}
