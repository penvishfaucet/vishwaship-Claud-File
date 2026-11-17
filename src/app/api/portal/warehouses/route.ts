import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";

const Body = z.object({
  label: z.string().trim().min(2).max(60), contactName: z.string().trim().min(2).max(80),
  mobile: z.string().transform((s) => s.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile")),
  line1: z.string().trim().min(5).max(200), line2: z.string().trim().max(200).optional(),
  pincode: z.string().regex(/^[1-9]\d{5}$/, "PIN code must be 6 digits"), city: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60),
});

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const db = await getDb();
  const existing = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(eq(schema.warehouses.orgId, s.orgId));
  const id = newId("wh");
  await db.insert(schema.warehouses).values({ id, orgId: s.orgId, ...p.data, line2: p.data.line2 || null, isDefault: existing.length === 0 });
  return NextResponse.json({ id }, { status: 201 });
}
