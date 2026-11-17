import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

/**
 * Fixed-window limiter backed by Postgres so it holds across instances (Redis can replace it
 * later without changing callers). Returns false when the caller is over the limit.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter: number }> {
  const db = await getDb();
  const rows = await db.execute(sql`
    insert into ${schema.rateLimits} (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when ${schema.rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then 1 else ${schema.rateLimits.count} + 1 end,
      window_start = case when ${schema.rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then now() else ${schema.rateLimits.windowStart} end
    returning count, extract(epoch from (window_start + make_interval(secs => ${windowSec}) - now()))::int as retry_after`);
  const r = (rows as unknown as { rows: Array<{ count: number; retry_after: number }> }).rows[0];
  return { ok: r.count <= limit, retryAfter: Math.max(1, r.retry_after) };
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  return (xf?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}
