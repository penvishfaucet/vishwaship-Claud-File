import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";

/** Exact match on the signed-in account's saved Customers by mobile (+91 / 0 / spaces normalised). */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const raw = new URL(req.url).searchParams.get("mobile") ?? "";
  const mobile = raw.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
  if (!/^[6-9]\d{9}$/.test(mobile)) return apiError(422, "validation_error", "Enter a 10-digit mobile number");
  if (!(await rateLimit(`buyer:${s.userId}`, 120, 60)).ok) return apiError(429, "rate_limited", "Too many lookups");
  const db = await getDb();
  const [b] = await db.select().from(schema.buyers).where(and(eq(schema.buyers.orgId, s.orgId), eq(schema.buyers.mobile, mobile)));
  if (!b) return NextResponse.json({ match: null });
  return NextResponse.json({ match: { id: b.id, name: b.name, mobile: b.mobile, email: b.email ?? "", addresses: b.addresses } });
}
