import "server-only";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { withLedger } from "@/server/ledger/db-store";
import { credit } from "@/server/ledger/wallet";
import { newId } from "@/server/util/ids";
import { formatINR } from "@/lib/money";
import { bpsLabel, manualQuote, normaliseUtr } from "@/lib/recharge";

type Db = Awaited<ReturnType<typeof getDb>>;
const OPEN_ONLINE = ["payment_pending", "failed", "expired", "cancelled"];
const OPEN_MANUAL = ["pending_verification", "info_required"];

export async function staffAlert(kind: string, title: string, href: string, perm = "finance.read") {
  const db = await getDb();
  await db.insert(schema.staffAlerts).values({ id: newId("sal"), kind, title: title.slice(0, 200), href, perm });
}

export async function rechargeEvent(rechargeId: string, action: string, actorKind: string, actorUserId: string | null, note?: string | null) {
  const db = await getDb();
  await db.insert(schema.rechargeEvents).values({ id: newId("rev"), rechargeId, action, actorKind, actorUserId, note: note?.slice(0, 1000) ?? null });
}

async function customerAlert(db: Db, orgId: string, title: string, href: string) {
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId, kind: "wallet", title: title.slice(0, 200), href });
}

/** RR100001, RR100002 … (retries on the rare collision). */
export async function nextRequestNumber(db: Db) {
  const [{ n }] = await db.select({ n: count() }).from(schema.recharges).where(sql`${schema.recharges.requestNumber} is not null`);
  return `RR${100001 + Number(n)}`;
}

async function creditWallet(db: Db, rc: typeof schema.recharges.$inferSelect, memo: string) {
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, rc.orgId));
  if (!wallet) throw new Error("Customer wallet not found");
  // One credit per recharge, whatever path (checkout, webhook, reconcile, double-click) gets here.
  return withLedger((s) => credit(s, { walletId: wallet.id, amount: rc.amountPaise, kind: "recharge_credit", idempotencyKey: `recharge:${rc.id}`, refType: "recharge", refId: rc.id, memo }));
}

/**
 * Settle an online (gateway) payment for a recharge. Called by the checkout callback, the webhook and
 * reconcile — any order, any number of times. Status is claimed with a conditional update, the ledger
 * credit is idempotent per recharge, so the wallet is credited exactly once.
 */
export async function settleOnline(rechargeId: string, p: { paymentId: string; amountPaise: number; currency: string; outcome: "success" | "failed" | "pending"; source: string }) {
  const db = await getDb();
  const [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, rechargeId));
  if (!rc) return { ok: false as const, reason: "unknown_recharge" };
  if (rc.status === "credited") return { ok: true as const, replayed: true, amountPaise: rc.amountPaise };
  const ref = rc.method === "razorpay" ? { razorpayPaymentId: p.paymentId } : { providerPaymentId: p.paymentId };
  if (p.outcome === "pending") return { ok: false as const, reason: "payment_pending" };
  if (p.outcome === "failed") {
    const upd = await db.update(schema.recharges).set({ status: "failed", updatedAt: new Date() }).where(and(eq(schema.recharges.id, rc.id), eq(schema.recharges.status, "payment_pending"))).returning({ id: schema.recharges.id });
    if (upd.length) await rechargeEvent(rc.id, "gateway_failed", "gateway", null, `${p.source}: payment ${p.paymentId} not successful`);
    return { ok: false as const, reason: "payment_failed" };
  }
  if (p.currency !== "INR" || p.amountPaise !== rc.amountPaise) {
    await db.update(schema.recharges).set({ status: "mismatch", ...ref, paidPaise: p.amountPaise, updatedAt: new Date() }).where(and(eq(schema.recharges.id, rc.id), inArray(schema.recharges.status, OPEN_ONLINE)));
    await rechargeEvent(rc.id, "gateway_mismatch", "gateway", null, `Expected ${rc.amountPaise}, got ${p.amountPaise} ${p.currency}`);
    await audit({ actorKind: "system", orgId: rc.orgId, action: "recharge.mismatch", targetType: "recharge", targetId: rc.id, details: { expected: rc.amountPaise, got: p.amountPaise, currency: p.currency } });
    await staffAlert("recharge_mismatch", `Recharge amount mismatch ${rc.requestNumber ?? rc.id}`, `/admin/recharges/?id=${rc.id}`);
    return { ok: false as const, reason: "amount_mismatch" };
  }
  const claimed = await db.update(schema.recharges).set({ status: "credited", ...ref, paidPaise: p.amountPaise, payablePaise: rc.amountPaise, decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.recharges.id, rc.id), inArray(schema.recharges.status, OPEN_ONLINE))).returning();
  if (!claimed.length) {
    const [now] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, rc.id));
    return now?.status === "credited" ? { ok: true as const, replayed: true, amountPaise: rc.amountPaise } : { ok: false as const, reason: `status_${now?.status}` };
  }
  try {
    await creditWallet(db, claimed[0], `Wallet recharge (${rc.method === "cashfree" ? "Cashfree" : rc.method === "razorpay" ? "Razorpay" : rc.method}) · ${p.paymentId}`);
  } catch (e) {
    await db.update(schema.recharges).set({ status: "payment_pending" }).where(eq(schema.recharges.id, rc.id));
    throw e;
  }
  await rechargeEvent(rc.id, "gateway_success", "gateway", null, `${p.source}: payment ${p.paymentId} · ${formatINR(p.amountPaise)}`);
  await customerAlert(db, rc.orgId, `Wallet recharged with ${formatINR(rc.amountPaise)}`, "/portal/billing/recharges/");
  await audit({ actorKind: "system", orgId: rc.orgId, action: "recharge.credited", targetType: "recharge", targetId: rc.id, details: { source: p.source, paymentId: p.paymentId, method: rc.method } });
  return { ok: true as const, replayed: false, amountPaise: rc.amountPaise };
}

// ---------------------------------------------------------------- manual UPI

export interface ManualSubmit {
  orgId: string; userId: string; rechargePaise: number; discountBps: number;
  reportedPaidPaise: number; utr: string; paidAt: Date; remarks: string;
  proof: { key: string; name: string; mime: string };
}

/** Create the Pending Verification request + linked ticket + Admin alert. Never credits anything. */
export async function submitManual(a: ManualSubmit) {
  const db = await getDb();
  const q = manualQuote(a.rechargePaise, a.discountBps);
  const utr = normaliseUtr(a.utr);
  const dup = await db.select({ id: schema.recharges.id, n: schema.recharges.requestNumber, status: schema.recharges.status }).from(schema.recharges)
    .where(and(eq(schema.recharges.utr, utr), ne(schema.recharges.status, "rejected")));
  const id = newId("rch");
  let number = "";
  for (let i = 0; i < 5 && !number; i++) {
    const candidate = await nextRequestNumber(db);
    const ins = await db.insert(schema.recharges).values({
      id, orgId: a.orgId, amountPaise: q.creditPaise, method: "manual", requestNumber: candidate, status: "pending_verification",
      discountBps: q.discountBps, discountPaise: q.discountPaise, payablePaise: q.payablePaise, paidPaise: a.reportedPaidPaise,
      utr, utrDuplicate: dup.length > 0, paidAt: a.paidAt, proofKey: a.proof.key, proofName: a.proof.name.slice(0, 120), proofMime: a.proof.mime,
      remarks: a.remarks.slice(0, 500) || null,
    }).onConflictDoNothing().returning({ id: schema.recharges.id });
    if (ins.length) number = candidate;
  }
  if (!number) throw new Error("Could not create the request — please try again");

  // linked support ticket
  const [{ n }] = await db.select({ n: count() }).from(schema.tickets);
  const ticketId = newId("tkt");
  const ticketNumber = `VT${10001 + Number(n)}`;
  await db.insert(schema.tickets).values({ id: ticketId, orgId: a.orgId, number: ticketNumber, category: "wallet_recharge", subject: `Manual wallet recharge ${number}` });
  const body = [
    `Manual UPI recharge request ${number}`,
    `Wallet recharge requested: ${formatINR(q.creditPaise)}`,
    `Discount (${bpsLabel(q.discountBps)}): ${formatINR(q.discountPaise)}`,
    `Amount to pay: ${formatINR(q.payablePaise)}`,
    `Amount paid (reported): ${formatINR(a.reportedPaidPaise)}`,
    `UTR / reference: ${utr}`,
    `Paid on: ${a.paidAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    a.remarks ? `Remarks: ${a.remarks}` : "",
    "Payment screenshot attached to the request.",
  ].filter(Boolean).join("\n");
  await db.insert(schema.ticketMessages).values({ id: newId("tm"), ticketId, authorUserId: a.userId, authorKind: "customer", body, attachments: [{ kind: "recharge_proof", rechargeId: id, name: a.proof.name }] });
  await db.update(schema.recharges).set({ ticketId }).where(eq(schema.recharges.id, id));

  await rechargeEvent(id, "submitted", "customer", a.userId, `UTR ${utr}`);
  if (dup.length) {
    await rechargeEvent(id, "flagged_duplicate_utr", "system", null, `Same UTR used on ${dup.map((d) => `${d.n ?? d.id} (${d.status})`).join(", ")}`);
    await db.update(schema.recharges).set({ utrDuplicate: true }).where(inArray(schema.recharges.id, dup.map((d) => d.id)));
  }
  const [org] = await db.select({ name: schema.orgs.businessName }).from(schema.orgs).where(eq(schema.orgs.id, a.orgId));
  await staffAlert("manual_recharge", `${dup.length ? "⚠ Duplicate UTR · " : ""}Manual recharge ${number}: ${formatINR(q.payablePaise)} paid by ${org?.name ?? a.orgId}`, `/admin/recharges/?id=${id}`, "finance.read");
  await customerAlert(db, a.orgId, `Recharge request ${number} submitted — pending verification`, `/portal/billing/recharges/${id}/`);
  await audit({ actorUserId: a.userId, actorKind: "customer", orgId: a.orgId, action: "recharge.manual_submitted", targetType: "recharge", targetId: id, details: { number, creditPaise: q.creditPaise, payablePaise: q.payablePaise, utrDuplicate: dup.length > 0 } });
  return { id, number, ticketId, ticketNumber, ...q, utrDuplicate: dup.length > 0 };
}

export type DecisionOutcome = { ok: true; message: string } | { ok: false; message: string };

/** Approve and credit: safe against double clicks and two admins (conditional claim + idempotent ledger key). */
export async function approveManual(id: string, staffUserId: string, note?: string): Promise<DecisionOutcome> {
  const db = await getDb();
  const [rc] = await db.select().from(schema.recharges).where(and(eq(schema.recharges.id, id), eq(schema.recharges.method, "manual")));
  if (!rc) return { ok: false, message: "Request not found" };
  if (rc.status === "credited") return { ok: false, message: `Already approved — the wallet was credited once (${rc.requestNumber}).` };
  if (!OPEN_MANUAL.includes(rc.status)) return { ok: false, message: `This request is ${rc.status.replace(/_/g, " ")} and cannot be approved.` };
  if (rc.utr) {
    const [used] = await db.select({ n: schema.recharges.requestNumber }).from(schema.recharges)
      .where(and(eq(schema.recharges.utr, rc.utr), eq(schema.recharges.status, "credited"), ne(schema.recharges.id, rc.id)));
    if (used) return { ok: false, message: `UTR ${rc.utr} was already used for approved request ${used.n}. Verify the payment before approving.` };
  }
  let claimed: Array<typeof schema.recharges.$inferSelect>;
  try {
    claimed = await db.update(schema.recharges).set({ status: "credited", decidedBy: staffUserId, decidedAt: new Date(), decisionNote: note?.slice(0, 500) || null, updatedAt: new Date() })
      .where(and(eq(schema.recharges.id, id), inArray(schema.recharges.status, OPEN_MANUAL))).returning();
  } catch (e) {
    if (/unique|duplicate/i.test((e as Error).message)) return { ok: false, message: `UTR ${rc.utr} is already used by another approved recharge.` };
    throw e;
  }
  if (!claimed.length) return { ok: false, message: "Another admin has already handled this request." };
  try {
    await creditWallet(db, claimed[0], `Wallet recharge (Manual UPI) ${rc.requestNumber} · UTR ${rc.utr} · paid ${formatINR(rc.payablePaise ?? rc.amountPaise)} + discount ${formatINR(rc.discountPaise)}`);
  } catch (e) {
    await db.update(schema.recharges).set({ status: rc.status, decidedBy: null, decidedAt: null }).where(eq(schema.recharges.id, id));
    return { ok: false, message: `Wallet credit failed: ${(e as Error).message}` };
  }
  await rechargeEvent(id, "approved", "staff", staffUserId, note);
  await ticketUpdate(db, rc, staffUserId, `Payment verified. ${formatINR(rc.amountPaise)} has been credited to your wallet (you paid ${formatINR(rc.payablePaise ?? rc.amountPaise)} with a ${formatINR(rc.discountPaise)} manual payment discount).`, "resolved");
  await customerAlert(db, rc.orgId, `Recharge ${rc.requestNumber} approved — ${formatINR(rc.amountPaise)} credited`, `/portal/billing/recharges/${id}/`);
  await audit({ actorUserId: staffUserId, actorKind: "staff", orgId: rc.orgId, action: "recharge.manual_approved", targetType: "recharge", targetId: id, details: { creditPaise: rc.amountPaise, payablePaise: rc.payablePaise, discountPaise: rc.discountPaise, utr: rc.utr } });
  return { ok: true, message: `Approved — ${formatINR(rc.amountPaise)} credited to the customer's wallet.` };
}

export async function rejectManual(id: string, staffUserId: string, reason: string): Promise<DecisionOutcome> {
  const db = await getDb();
  const r = reason.trim();
  if (r.length < 5) return { ok: false, message: "Enter the reason for rejection (shown to the customer)." };
  const upd = await db.update(schema.recharges).set({ status: "rejected", decidedBy: staffUserId, decidedAt: new Date(), decisionNote: r.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(schema.recharges.id, id), eq(schema.recharges.method, "manual"), inArray(schema.recharges.status, OPEN_MANUAL))).returning();
  if (!upd.length) return { ok: false, message: "This request was already handled." };
  const rc = upd[0];
  await rechargeEvent(id, "rejected", "staff", staffUserId, r);
  await ticketUpdate(db, rc, staffUserId, `Your recharge request ${rc.requestNumber} was rejected. Reason: ${r}`, "resolved");
  await customerAlert(db, rc.orgId, `Recharge ${rc.requestNumber} rejected: ${r}`, `/portal/billing/recharges/${id}/`);
  await audit({ actorUserId: staffUserId, actorKind: "staff", orgId: rc.orgId, action: "recharge.manual_rejected", targetType: "recharge", targetId: id, details: { reason: r } });
  return { ok: true, message: "Rejected — the customer has been notified." };
}

export async function requestInfo(id: string, staffUserId: string, message: string): Promise<DecisionOutcome> {
  const db = await getDb();
  const m = message.trim();
  if (m.length < 5) return { ok: false, message: "Describe what the customer should provide." };
  const upd = await db.update(schema.recharges).set({ status: "info_required", decisionNote: m.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(schema.recharges.id, id), eq(schema.recharges.method, "manual"), inArray(schema.recharges.status, OPEN_MANUAL))).returning();
  if (!upd.length) return { ok: false, message: "This request was already handled." };
  const rc = upd[0];
  await rechargeEvent(id, "info_requested", "staff", staffUserId, m);
  await ticketUpdate(db, rc, staffUserId, `More information is needed for recharge ${rc.requestNumber}: ${m}`, "awaiting_customer");
  await customerAlert(db, rc.orgId, `Recharge ${rc.requestNumber}: more information required`, `/portal/billing/recharges/${id}/`);
  await audit({ actorUserId: staffUserId, actorKind: "staff", orgId: rc.orgId, action: "recharge.manual_info_requested", targetType: "recharge", targetId: id });
  return { ok: true, message: "Information requested — the customer has been notified." };
}

/** Customer answers an information request (text and optionally a new screenshot); back to Pending Verification. */
export async function provideInfo(a: { id: string; orgId: string; userId: string; message: string; proof?: { key: string; name: string; mime: string } }): Promise<DecisionOutcome> {
  const db = await getDb();
  const [rc] = await db.select().from(schema.recharges).where(and(eq(schema.recharges.id, a.id), eq(schema.recharges.orgId, a.orgId), eq(schema.recharges.method, "manual")));
  if (!rc) return { ok: false, message: "Request not found" };
  if (!OPEN_MANUAL.includes(rc.status)) return { ok: false, message: "This request is already closed." };
  const msg = a.message.trim();
  if (msg.length < 2 && !a.proof) return { ok: false, message: "Add a message or a new screenshot." };
  await db.update(schema.recharges).set({ status: "pending_verification", ...(a.proof ? { proofKey: a.proof.key, proofName: a.proof.name.slice(0, 120), proofMime: a.proof.mime } : {}), updatedAt: new Date() }).where(eq(schema.recharges.id, rc.id));
  if (rc.ticketId) {
    await db.insert(schema.ticketMessages).values({ id: newId("tm"), ticketId: rc.ticketId, authorUserId: a.userId, authorKind: "customer", body: (msg || "Uploaded a new payment screenshot.") + (a.proof ? "\n(New payment screenshot attached to the request.)" : ""), attachments: a.proof ? [{ kind: "recharge_proof", rechargeId: rc.id, name: a.proof.name }] : [] });
    await db.update(schema.tickets).set({ status: "open" }).where(eq(schema.tickets.id, rc.ticketId));
  }
  await rechargeEvent(rc.id, "info_provided", "customer", a.userId, msg || "New screenshot");
  await staffAlert("recharge_info", `Customer replied on recharge ${rc.requestNumber}`, `/admin/recharges/?id=${rc.id}`);
  return { ok: true, message: "Sent — the request is back in verification." };
}

async function ticketUpdate(db: Db, rc: typeof schema.recharges.$inferSelect, staffUserId: string, body: string, status: string) {
  if (!rc.ticketId) return;
  await db.insert(schema.ticketMessages).values({ id: newId("tm"), ticketId: rc.ticketId, authorUserId: staffUserId, authorKind: "staff", body });
  await db.update(schema.tickets).set({ status }).where(eq(schema.tickets.id, rc.ticketId));
}

/** Pending manual requests (Admin badge). */
export async function pendingManualCount() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.recharges).where(and(eq(schema.recharges.method, "manual"), inArray(schema.recharges.status, OPEN_MANUAL)));
  return Number(n);
}
