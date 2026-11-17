import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWeightDispute } from "@/server/admin/disputes";
import { apiStaff } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("finance.adjust");
  if (!s) return apiError(403, "forbidden", "You cannot resolve weight disputes");
  const p = await parseJson(req, z.object({ op: z.enum(["charge", "waive"]) }));
  if (!p.ok) return p.res;
  const { id } = await params;
  const r = await resolveWeightDispute(id, p.data.op, s.userId);
  return r.ok ? NextResponse.json(r) : apiError(409, "conflict", r.message);
}
