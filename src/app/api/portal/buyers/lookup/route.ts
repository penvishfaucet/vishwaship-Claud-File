import { NextResponse } from "next/server";
import { and, eq, ilike } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";

/**
 * Saved Customers of the signed-in account only.
 * ?mobile= exact 10-digit match (+91 / 0 / spaces normalised) → { match } (kept for older callers) and { matches }.
 * ?name=   name contains (≥ 2 characters)                     → { matches } (up to 8).
 */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await rateLimit(`buyer:${s.userId}`, 120, 60)).ok) return apiError(429, "rate_limited", "Too many lookups");
  const u = new URL(req.url);
  const db = await getDb();
  const shape = (b: typeof schema.buyers.$inferSelect) => ({ id: b.id, name: b.name, mobile: b.mobile, email: b.email ?? "", addresses: b.addresses });
  const name = (u.searchParams.get("name") ?? "").trim();
  if (name) {
    if (name.length < 2) return apiError(422, "validation_error", "Type at least 2 letters");
    const rows = await db.select().from(schema.buyers).where(and(eq(schema.buyers.orgId, s.orgId), ilike(schema.buyers.name, `%${name.replace(/[%_\\]/g, "")}%`))).limit(8);
    return NextResponse.json({ matches: rows.map(shape) });
  }
  const mobile = (u.searchParams.get("mobile") ?? "").replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
  if (!/^[6-9]\d{9}$/.test(mobile)) return apiError(422, "validation_error", "Enter a 10-digit mobile number");
  const rows = await db.select().from(schema.buyers).where(and(eq(schema.buyers.orgId, s.orgId), eq(schema.buyers.mobile, mobile)));
  return NextResponse.json({ match: rows[0] ? shape(rows[0]) : null, matches: rows.map(shape) });
}
