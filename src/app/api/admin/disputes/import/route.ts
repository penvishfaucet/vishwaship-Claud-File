import { NextResponse } from "next/server";
import { z } from "zod";
import { apiStaff } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { importWeightReport } from "@/server/weight/service";

/** Courier weight report (CSV): preview first (commit = false writes nothing), then raise the discrepancies. */
export async function POST(req: Request) {
  const s = await apiStaff("finance.adjust");
  if (!s) return apiError(403, "forbidden", "You cannot raise weight discrepancies");
  const p = await parseJson(req, z.object({ csv: z.string().min(1).max(3_000_000), commit: z.boolean() }));
  if (!p.ok) return p.res;
  const r = await importWeightReport(p.data.csv, { commit: p.data.commit, actorUserId: s.userId });
  if (r.error) return apiError(400, "validation_error", r.error);
  return NextResponse.json(r);
}
