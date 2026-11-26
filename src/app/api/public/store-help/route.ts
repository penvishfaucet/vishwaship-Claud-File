import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { readSession } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { rateLimit, ipFromHeaders } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";

const Input = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  email: z.string().trim().max(120).email("Enter a valid email").or(z.literal("")).default(""),
  message: z.string().max(1000).default(""),
  website: z.string().max(200).default(""),
});

/** "Request help" on the Create Your Online Store page. Shows up in Admin → Online Stores. */
export async function POST(req: Request) {
  const ip = ipFromHeaders(req.headers);
  if (!(await rateLimit(`store-help:${ip}`, 5, 3600)).ok) return apiError(429, "rate_limited", "Too many requests. Please try again later.");
  const p = await parseJson(req, Input); if (!p.ok) return p.res;
  if (p.data.website) return NextResponse.json({ ok: true }); // bot filled the honeypot
  const s = await readSession("customer").catch(() => null);
  const db = await getDb();
  await db.insert(schema.storeHelpRequests).values({ id: newId("shr"), name: p.data.name, mobile: p.data.mobile, email: p.data.email || null, message: p.data.message || null, orgId: s?.orgId ?? null });
  return NextResponse.json({ ok: true });
}
