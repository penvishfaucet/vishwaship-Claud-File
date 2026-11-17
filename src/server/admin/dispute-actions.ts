"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { withLedger } from "@/server/ledger/db-store";
import { credit, debit } from "@/server/ledger/wallet";

/** charge: posts the validated discrepancy exactly once (key wd-charge:<id>). waive after charge: compensating credit (wd-waive:<id>). */
export async function resolveDispute(fd: FormData) {
  const s = await requireStaff("finance.adjust");
  const id = String(fd.get("id")), op = String(fd.get("op"));
  const db = await getDb();
  const [d] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.id, id));
  if (!d) redirect("/admin/disputes/?err=notfound");
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, d.orgId));
  if (op === "charge" && (d.status === "open" || d.status === "accepted")) {
    await withLedger((st) => debit(st, { walletId: w.id, amount: d.chargePaise, kind: "weight_charge", idempotencyKey: `wd-charge:${id}`, refType: "weight_dispute", refId: id, memo: "Weight discrepancy charge", allowNegative: true }));
    await db.update(schema.weightDisputes).set({ status: "charged", resolution: "Charged per carrier re-weigh" }).where(eq(schema.weightDisputes.id, id));
  } else if (op === "waive" && d.status !== "waived") {
    if (d.status === "charged") {
      await withLedger((st) => credit(st, { walletId: w.id, amount: d.chargePaise, kind: "weight_reversal", idempotencyKey: `wd-waive:${id}`, refType: "weight_dispute", refId: id, memo: "Weight discrepancy waived (reversal)" }));
    }
    await db.update(schema.weightDisputes).set({ status: "waived", resolution: "Waived after review" }).where(eq(schema.weightDisputes.id, id));
  } else redirect("/admin/disputes/?err=state");
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId: d.orgId, action: `weight_dispute.${op}`, targetType: "weight_dispute", targetId: id });
  redirect("/admin/disputes/");
}
