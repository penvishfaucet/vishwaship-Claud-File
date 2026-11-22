import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";

const Body = z.object({
  claimedGrams: z.number().int().min(10).max(5_000_000),
  reason: z.string().trim().min(10, "Explain the dispute in at least 10 characters").max(800),
  evidenceUrls: z.array(z.string().trim().url().max(300)).max(5).default([]),
});

/** Seller disputes a weight discrepancy before its deadline. Vishwaship ops resolve it (accept / waive / charge). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const { id } = await params;
  const db = await getDb();
  const [w] = await db.select().from(schema.weightDisputes).where(and(eq(schema.weightDisputes.id, id), eq(schema.weightDisputes.orgId, s.orgId)));
  if (!w) return apiError(404, "not_found", "Discrepancy not found");
  if (w.status !== "open") return apiError(409, "conflict", "This discrepancy is already disputed or resolved");
  if (w.deadlineAt < new Date()) return apiError(409, "conflict", "The dispute window for this shipment has closed");
  const evidence = [...(w.evidence as Array<Record<string, unknown>>), { label: "Seller dispute", by: "seller", claimedGrams: p.data.claimedGrams, note: p.data.reason, urls: p.data.evidenceUrls, at: new Date().toISOString() }];
  const upd = await db.update(schema.weightDisputes).set({ status: "disputed", evidence }).where(and(eq(schema.weightDisputes.id, id), eq(schema.weightDisputes.status, "open"))).returning({ id: schema.weightDisputes.id });
  if (!upd.length) return apiError(409, "conflict", "This discrepancy was just updated — refresh the page");
  {
    const [sh] = await db.select({ lr: schema.shipments.lrNumber, awb: schema.shipments.awb }).from(schema.shipments).where(eq(schema.shipments.id, w.shipmentId));
    const [o] = await db.select({ name: schema.orgs.businessName }).from(schema.orgs).where(eq(schema.orgs.id, s.orgId));
    await db.insert(schema.staffAlerts).values({ id: newId("sal"), kind: "weight_dispute", title: `Weight dispute raised by ${o?.name ?? "a client"} — LR ${sh?.lr ?? sh?.awb ?? ""}: says ${(p.data.claimedGrams / 1000).toFixed(2)} kg vs courier ${(w.carrierGrams / 1000).toFixed(2)} kg`.slice(0, 200), href: "/admin/disputes/", perm: "shipments.read" });
  }
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "weight.dispute", targetType: "shipment", targetId: w.shipmentId, details: { claimedGrams: p.data.claimedGrams } });
  return NextResponse.json({ ok: true, status: "disputed" });
}
