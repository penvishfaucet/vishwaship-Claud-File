import "server-only";
import { eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { issueAutoNote } from "@/server/billing";
import { getDb, schema } from "@/server/db/client";
import { withLedger } from "@/server/ledger/db-store";
import { credit, debit } from "@/server/ledger/wallet";

/**
 * charge: posts the validated discrepancy exactly once (ledger key wd-charge:<id>) + debit note.
 * actorUserId null = system (undisputed discrepancy charged automatically when its dispute window closes).
 * waive after charge: compensating credit (wd-waive:<id>) + credit note. Both notes are idempotent.
 */
export async function resolveWeightDispute(id: string, op: "charge" | "waive", actorUserId: string | null): Promise<{ ok: boolean; message: string }> {
  const db = await getDb();
  const [d] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.id, id));
  if (!d) return { ok: false, message: "Dispute not found" };
  // FoD (nothing charged to the wallet): "charge" = the courier weight stands (receiver pays it at delivery).
  if (op === "charge" && !(d.chargePaise > 0)) {
    if (!["open", "disputed"].includes(d.status)) return { ok: false, message: `Cannot close a discrepancy that is ${d.status}` };
    await db.update(schema.weightDisputes).set({ status: "accepted", resolution: d.status === "disputed" ? "Dispute reviewed — courier weight upheld; the receiver pays the updated freight at delivery (FoD)" : "FoD — the receiver pays the updated freight at delivery. No wallet charge." }).where(eq(schema.weightDisputes.id, id));
    await audit({ actorUserId, actorKind: actorUserId ? "staff" : "system", orgId: d.orgId, action: "weight_dispute.uphold_fod", targetType: "weight_dispute", targetId: id });
    return { ok: true, message: "Courier weight upheld (FoD — no wallet charge)" };
  }
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, d.orgId));
  if (op === "charge" && ["open", "accepted", "disputed"].includes(d.status)) {
    await withLedger((st) => debit(st, { walletId: w.id, amount: d.chargePaise, kind: "weight_charge", idempotencyKey: `wd-charge:${id}`, refType: "weight_dispute", refId: id, memo: "Weight discrepancy charge", allowNegative: true }));
    await db.update(schema.weightDisputes).set({ status: "charged", chargedAt: new Date(), resolution: d.status === "disputed" ? "Dispute reviewed — carrier weight upheld" : actorUserId ? "Charged per carrier re-weigh" : "Not disputed within the window — charged per carrier re-weigh" }).where(eq(schema.weightDisputes.id, id));
    await issueAutoNote({ orgId: d.orgId, kind: "debit_note", totalPaise: d.chargePaise, reason: "Weight discrepancy — carrier-measured weight higher than booked", refType: "dispute", refId: id, actor: actorUserId ?? undefined });
  } else if (op === "waive" && d.status !== "waived") {
    if (d.status === "charged") {
      await withLedger((st) => credit(st, { walletId: w.id, amount: d.chargePaise, kind: "weight_reversal", idempotencyKey: `wd-waive:${id}`, refType: "weight_dispute", refId: id, memo: "Weight discrepancy waived (reversal)" }));
      await issueAutoNote({ orgId: d.orgId, kind: "credit_note", totalPaise: d.chargePaise, reason: "Weight discrepancy waived — charge reversed", refType: "dispute", refId: id, actor: actorUserId ?? undefined });
    }
    await db.update(schema.weightDisputes).set({ status: "waived", resolution: d.status === "disputed" ? "Dispute accepted — no charge" : "Waived after review" }).where(eq(schema.weightDisputes.id, id));
    // FoD: the courier accepted the dispute, so the receiver pays the original freight again.
    const c = d.calc as { fod?: boolean; receiverBeforePaise?: number; receiverAfterPaise?: number } | null;
    if (c?.fod && c.receiverBeforePaise != null) {
      const [sh] = await db.select({ r: schema.shipments.receiverFreightPaise }).from(schema.shipments).where(eq(schema.shipments.id, d.shipmentId));
      if (sh && sh.r === c.receiverAfterPaise) await db.update(schema.shipments).set({ receiverFreightPaise: c.receiverBeforePaise }).where(eq(schema.shipments.id, d.shipmentId));
    }
  } else return { ok: false, message: `Cannot ${op} a dispute that is ${d.status}` };
  await audit({ actorUserId, actorKind: actorUserId ? "staff" : "system", orgId: d.orgId, action: `weight_dispute.${op}`, targetType: "weight_dispute", targetId: id });
  return { ok: true, message: op === "charge" ? "Charged and debit note issued" : "Waived" };
}
