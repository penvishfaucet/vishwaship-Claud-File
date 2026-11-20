import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { requestNdrAction } from "@/server/ndr/service";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reattempt") }),
  z.object({ action: z.literal("rto") }),
  z.object({ action: z.literal("update_address"), line1: z.string().trim().min(5).max(200), mobile: z.string().max(15).optional() }),
]);

/** NDR action: courier NDR API where available, else queued for the Vishwaship team to pass on (never a dead end). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const payload = p.data.action === "update_address" ? { line1: p.data.line1, mobile: p.data.mobile } : undefined;
  const r = await requestNdrAction({ caseId: id, orgId: s.orgId, kind: p.data.action, payload, source: "client", actorUserId: s.userId });
  if (!r.ok) return apiError(r.message.includes("not found") ? 404 : 409, r.message.includes("not found") ? "not_found" : "conflict", r.message);
  return NextResponse.json({ ok: true, status: r.status, message: r.message });
}
