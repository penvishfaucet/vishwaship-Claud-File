import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

/** Public website media uploaded in Admin → Website Content. Immutable (a new upload gets a new id). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^sa_[A-Za-z0-9]{8,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [a] = await db.select().from(schema.siteAssets).where(eq(schema.siteAssets.id, id));
  if (!a) return new Response("Not found", { status: 404 });
  const data = Buffer.from(a.data);
  const headers: Record<string, string> = {
    "content-type": a.mime,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
  // Videos need byte ranges for seeking/iOS playback.
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    const size = data.length;
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "content-length": String(data.length) } });
}
