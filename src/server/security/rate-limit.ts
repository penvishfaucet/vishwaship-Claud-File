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

/**
 * The visitor's IP for rate limits. Hostinger's proxy SETS x-real-ip to the real client address (a value sent by the
 * client is overwritten — verified on live 2026-11-26), while the FIRST x-forwarded-for entry is whatever the client
 * sent and was used to bypass every per-IP limit. Fallback: the LAST x-forwarded-for entry (added by the proxy).
 * IPv6 is grouped by its /64 network, since one connection can rotate through a whole /64.
 */
export function clientIp(req: Request): string {
  return ipFromHeaders(req.headers);
}

/** Same as clientIp, for server components / actions that have headers() instead of a Request. */
export function ipFromHeaders(h: { get(name: string): string | null }): string {
  const real = h.get("x-real-ip")?.trim();
  const xf = h.get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean);
  return ipKey(real || xf?.[xf.length - 1] || "local");
}

/** IPv4 as is; IPv6 reduced to its first four groups (the /64 network). */
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
