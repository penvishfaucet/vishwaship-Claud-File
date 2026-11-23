import { NextResponse } from "next/server";
import { storeGuard } from "@/server/store/api";
import { pendingAcceptance } from "@/server/store/orders";

export const dynamic = "force-dynamic";

/** Dashboard card: store orders waiting to be accepted (polled every few seconds). */
export async function GET() {
  const g = await storeGuard(); if (g.err) return g.err;
  return NextResponse.json(await pendingAcceptance(g.s.orgId), { headers: { "cache-control": "no-store" } });
}
