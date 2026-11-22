import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWeightDispute } from "@/server/admin/disputes";
import { sendDisputeToCourier } from "@/server/weight/courier-dispute";
import { apiStaff } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("finance.adjust");
  if (!s) return apiError(403, "forbidden", "You cannot resolve weight disputes");
  const p = await parseJson(req, z.object({ op: z.enum(["charge", "waive", "send_courier"]) }));
  if (!p.ok) return p.res;
  const { id } = await params;
  const r = p.data.op === "send_courier" ? await sendDisputeToCourier(id, s.userId) : await resolveWeightDispute(id, p.data.op, s.userId);
  return r.ok ? NextResponse.json(r) : apiError(409, "conflict", r.message);
}
