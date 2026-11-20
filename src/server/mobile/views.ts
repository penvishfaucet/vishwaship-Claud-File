import "server-only";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { resolveFeatures } from "@/server/features";
import { onboardingState, ACTIVATION_MESSAGE } from "@/server/onboarding";
import { KYC_DOCS } from "@/lib/kyc";
import { listOrderRows, parseOrderFilters, tabCounts } from "@/server/orders/view";
import { passbookHistory, type PassbookType } from "@/server/passbook";
import { codOverview, rechargesOf } from "@/server/billing";
import { getPaymentSettings, usableGateways } from "@/server/payments/settings";
import { manualQuote } from "@/lib/recharge";

/**
 * JSON views for the Android app. They call the same server functions the website's pages render from, so both
 * channels show identical numbers. Every function takes the orgId from the session — never from the request.
 */

export async function meView(userId: string, orgId: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  const [credits] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.orgId, orgId));
  const [{ unread }] = await db.select({ unread: count() }).from(schema.inAppAlerts).where(and(eq(schema.inAppAlerts.orgId, orgId), isNull(schema.inAppAlerts.readAt)));
  const [{ openTickets }] = await db.select({ openTickets: count() }).from(schema.tickets).where(and(eq(schema.tickets.orgId, orgId), eq(schema.tickets.status, "open")));
  const ob = await onboardingState(orgId);
  const f = await resolveFeatures(orgId);
  return {
    user: { id: u.id, name: u.name, email: u.email, mobile: u.mobile, emailVerified: !!u.emailVerifiedAt, mobileVerified: !!u.mobileVerifiedAt },
    org: { id: org.id, name: org.name, businessName: org.businessName, gstin: org.gstin, kycStatus: org.kycStatus, profileComplete: !!org.profileCompletedAt },
    onboarding: { step: ob.step, reasons: ob.reasons, message: ob.step === "active" ? null : ACTIVATION_MESSAGE[ob.step] },
    wallet: { availablePaise: wallet ? wallet.postedPaise - wallet.reservedPaise : 0, postedPaise: wallet?.postedPaise ?? 0, reservedPaise: wallet?.reservedPaise ?? 0 },
    credits: credits?.credits ?? 0,
    unreadAlerts: Number(unread),
    openTickets: Number(openTickets),
    /** Module switches resolved exactly as the portal sidebar does (plan → customer override → global → default). */
    modules: Object.fromEntries(Object.entries(f.modules).map(([k, v]) => [k, v.enabled])),
    plan: f.plan ? { id: f.plan.id, name: f.plan.name } : null,
  };
}

export async function homeView(orgId: string, sp: Record<string, string | undefined>) {
  const f = parseOrderFilters(sp);
  const [counts, recent] = await Promise.all([tabCounts(orgId, f), listOrderRows(orgId, { ...f, tab: "all" }, { limit: 5, offset: 0 })]);
  return { range: { from: f.from, to: f.to }, counts, recent: recent.rows };
}

export async function ordersView(orgId: string, sp: Record<string, string | undefined>) {
  const f = parseOrderFilters(sp);
  const [list, counts] = await Promise.all([listOrderRows(orgId, f), tabCounts(orgId, f)]);
  return { ...list, counts, filters: f };
}

/** One order with the same row shape as the list, plus its tracking timeline (tenant-scoped). */
export async function orderDetail(orgId: string, orderId: string) {
  const db = await getDb();
  const [o] = await db.select({ id: schema.orders.id, direction: schema.orders.direction, archivedAt: schema.orders.archivedAt })
    .from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.orgId, orgId)));
  if (!o) return null;
  const f = { ...parseOrderFilters({}), orderId: o.id, direction: o.direction as "forward" | "reverse", tab: o.archivedAt ? "archive" as const : "all" as const };
  const { rows } = await listOrderRows(orgId, f, { limit: 1, offset: 0 });
  const row = rows[0];
  if (!row) return null;
  const events = row.shipment
    ? await db.select({ status: schema.shipmentEvents.status, raw: schema.shipmentEvents.rawStatus, location: schema.shipmentEvents.location, at: schema.shipmentEvents.occurredAt, remark: schema.shipmentEvents.remark })
      .from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, row.shipment.id)).orderBy(desc(schema.shipmentEvents.occurredAt)).limit(200)
    : [];
  // NDR / RTO case the customer can act on (reattempt, address correction, RTO) — same rules as the web NDR page
  const [ndr] = row.shipment
    ? await db.select().from(schema.ndrCases).where(and(eq(schema.ndrCases.shipmentId, row.shipment.id), eq(schema.ndrCases.orgId, orgId))).orderBy(desc(schema.ndrCases.createdAt)).limit(1)
    : [];
  return {
    order: row,
    timeline: events.map((e) => ({ ...e, at: e.at.toISOString() })),
    ndr: ndr ? { id: ndr.id, kind: ndr.kind, reason: ndr.reason, attempt: ndr.attempt, deadlineAt: ndr.deadlineAt?.toISOString() ?? null, status: ndr.status, requestedAction: ndr.requestedAction } : null,
  };
}

export async function walletView(orgId: string, sp: { from?: string; to?: string; type?: string }) {
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? new Date(`${sp.to}T23:59:59.999+05:30`) : new Date();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? new Date(`${sp.from}T00:00:00+05:30`) : new Date(to.getTime() - 90 * 86400_000);
  const type = (["recharge", "shipment", "refund", "adjustment", "other"].includes(sp.type ?? "") ? sp.type : "all") as PassbookType | "all";
  const db = await getDb();
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  const [passbook, recharges, pay, gateways] = await Promise.all([
    passbookHistory(orgId, { from, to, type, limit: 300 }), rechargesOf(orgId), getPaymentSettings(), usableGateways(),
  ]);
  return {
    balance: { availablePaise: wallet ? wallet.postedPaise - wallet.reservedPaise : 0, postedPaise: wallet?.postedPaise ?? 0, reservedPaise: wallet?.reservedPaise ?? 0 },
    passbook: passbook.map((p) => ({ ...p, at: p.at.toISOString() })),
    recharges: recharges.slice(0, 100).map((r) => ({
      id: r.id, method: r.method, status: r.status, amountPaise: r.amountPaise, payablePaise: r.payablePaise, paidPaise: r.paidPaise,
      utr: r.utr ?? null, createdAt: r.createdAt.toISOString(), walletCredited: r.walletCredited,
    })),
    /** Same list the website's Recharge dialog shows: every gateway Admin enabled with keys saved, preferred first. */
    recharge: {
      gateways: gateways.map((g) => ({ gateway: g.gateway, mode: g.acct.mode })),
      onlineMinPaise: pay.onlineMinPaise, onlineMaxPaise: pay.onlineMaxPaise,
      manual: pay.manual.enabled ? {
        upiId: pay.manual.upiId, payeeName: pay.manual.payeeName, instructions: pay.manual.instructions,
        discountBps: pay.manual.discountBps, minPaise: pay.manual.minPaise, maxPaise: pay.manual.maxPaise, hasQr: !!pay.manual.qrKey,
        example: manualQuote(100_000, pay.manual.discountBps),
      } : null,
    },
  };
}

export async function codView(orgId: string) {
  const c = await codOverview(orgId);
  return {
    totals: c.totals,
    batches: c.batches.map((b) => ({ id: b.id, status: b.status, reference: b.reference, netPaise: b.netPaise, deductionsPaise: b.deductionsPaise, cycleDate: b.cycleDate, paidAt: b.paidAt })),
    rows: c.rows.slice(0, 300).map(({ item: _item, ...r }) => r),
  };
}

export async function kycView(orgId: string) {
  const db = await getDb();
  const docs = await db.select().from(schema.kycDocuments).where(eq(schema.kycDocuments.orgId, orgId)).orderBy(desc(schema.kycDocuments.createdAt));
  const [org] = await db.select({ kyc: schema.orgs.kycStatus }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  return {
    status: org?.kyc ?? "not_started",
    documents: KYC_DOCS.map((d) => {
      const latest = docs.find((x) => x.docType === d.type);
      return { ...d, latest: latest ? { id: latest.id, status: latest.status, maskedNumber: latest.maskedNumber, reason: latest.reviewReason, uploadedAt: latest.createdAt.toISOString(), reviewedAt: latest.reviewedAt?.toISOString() ?? null } : null };
    }),
  };
}
