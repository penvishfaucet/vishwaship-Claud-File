import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { OPTIONAL_COLUMNS, PAGE_SIZES } from "@/lib/order-view";

const Body = z.object({
  ordersHidden: z.array(z.enum(OPTIONAL_COLUMNS.map((c) => c.key) as unknown as [string, ...string[]])).max(10).optional(),
  ordersPageSize: z.number().int().refine((n) => (PAGE_SIZES as readonly number[]).includes(n), "Unsupported page size").optional(),
});

/** Save this user's Orders table preferences (hidden optional columns, page size). */
export async function PUT(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const db = await getDb();
  const [u] = await db.select({ prefs: schema.users.prefs }).from(schema.users).where(eq(schema.users.id, s.userId));
  const prefs = { ...((u?.prefs as Record<string, unknown>) ?? {}), ...p.data };
  await db.update(schema.users).set({ prefs }).where(eq(schema.users.id, s.userId));
  return NextResponse.json({ ok: true });
}
