import { NextResponse } from "next/server";
import { z } from "zod";
import { apiStaff } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { saveCourierMailSettings } from "@/server/weight/courier-dispute";

/** Admin: the courier's weight-dispute e-mail addresses (To + CC), saved once. */
export async function POST(req: Request) {
  const s = await apiStaff("finance.adjust");
  if (!s) return apiError(403, "forbidden", "You cannot change this setting");
  const p = await parseJson(req, z.object({ to: z.string().max(1000), cc: z.string().max(1000).default("") }));
  if (!p.ok) return p.res;
  const r = await saveCourierMailSettings(p.data, s.userId);
  return r.ok ? NextResponse.json(r) : apiError(422, "validation_error", r.message);
}
