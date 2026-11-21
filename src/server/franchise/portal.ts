import "server-only";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { revokeAllSessions } from "@/server/auth/session";
import { randomToken, newId } from "@/server/util/ids";
import { hashPassword, sha256 } from "@/server/security/crypto";
import { FranchiseError, getFranchise } from "./service";

/**
 * Franchise phase 2: the franchise's own login, its customers (referral or admin link) and the read-only data its
 * dashboard shows. Every customer query is scoped by orgs.franchise_id = the signed-in franchise.
 * The franchise sees what its customers pay (incl. GST), never Vishwaship's courier cost or provider details.
 */
export const SETUP_HOURS = 72;

// ---------------- login account (admin) ----------------
/** Create the franchise login (or re-issue a set-password link). Returns the one-time token; the link is shown once to the admin. */
export async function issueLoginLink(actor: string, franchiseId: string) {
  const f = await getFranchise(franchiseId);
  if (!f) throw new FranchiseError("Franchise not found");
  if (f.status === "terminated") throw new FranchiseError("A terminated franchise cannot log in");
  const db = await getDb();
  let userId = f.userId;
  if (!userId) {
    const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "franchise"), eq(schema.users.email, f.email)));
    if (taken) throw new FranchiseError("Another franchise login already uses this email. Change the franchise email first.");
    userId = newId("usr");
    await db.insert(schema.users).values({ id: userId, kind: "franchise", name: f.ownerName, email: f.email, mobile: null, mustResetPassword: true });
    await db.update(schema.franchises).set({ userId, updatedAt: new Date() }).where(eq(schema.franchises.id, f.id));
  } else {
    // A new link replaces any older unused one and signs the franchise out everywhere.
    await db.update(schema.oneTimeTokens).set({ usedAt: new Date() }).where(and(eq(schema.oneTimeTokens.userId, userId), isNull(schema.oneTimeTokens.usedAt)));
    await revokeAllSessions(userId);
    await db.update(schema.users).set({ active: true, email: f.email, name: f.ownerName }).where(eq(schema.users.id, userId));
  }
  const token = randomToken(32);
  await db.insert(schema.oneTimeTokens).values({ id: sha256(token), userId, purpose: "password_setup", expiresAt: new Date(Date.now() + SETUP_HOURS * 3600_000) });
  await audit({ actorUserId: actor, actorKind: "staff", action: f.userId ? "franchise.login_link_reissued" : "franchise.login_created", targetType: "franchise", targetId: f.id });
  return { token, email: f.email };
}

/** Turn the login off (also done automatically on termination). */
export async function disableLogin(actor: string, franchiseId: string) {
  const f = await getFranchise(franchiseId);
  if (!f?.userId) throw new FranchiseError("This franchise has no login");
  const db = await getDb();
  await db.update(schema.users).set({ active: false }).where(eq(schema.users.id, f.userId));
  await db.update(schema.oneTimeTokens).set({ usedAt: new Date() }).where(and(eq(schema.oneTimeTokens.userId, f.userId), isNull(schema.oneTimeTokens.usedAt)));
  await revokeAllSessions(f.userId);
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.login_disabled", targetType: "franchise", targetId: f.id });
}

export async function loginState(f: { userId: string | null }) {
  if (!f.userId) return { state: "none" as const };
  const db = await getDb();
  const [u] = await db.select({ active: schema.users.active, pw: schema.users.passwordHash, must: schema.users.mustResetPassword }).from(schema.users).where(eq(schema.users.id, f.userId));
  const [last] = await db.select({ at: schema.sessions.createdAt }).from(schema.sessions).where(eq(schema.sessions.userId, f.userId)).orderBy(desc(schema.sessions.createdAt)).limit(1);
  if (!u) return { state: "none" as const };
  return { state: !u.active ? "disabled" as const : !u.pw || u.must ? "invited" as const : "ready" as const, lastLogin: last?.at ?? null };
}

/** Use a set-password link. Returns the franchise user id. */
export async function consumeSetupToken(token: string, password: string) {
  if (password.length < 10 || password.length > 128) throw new FranchiseError("Password must be at least 10 characters");
  const db = await getDb();
  const [t] = await db.select().from(schema.oneTimeTokens).where(and(eq(schema.oneTimeTokens.id, sha256(token)), isNull(schema.oneTimeTokens.usedAt), gte(schema.oneTimeTokens.expiresAt, new Date())));
  if (!t || t.purpose !== "password_setup") throw new FranchiseError("This link is invalid or has expired. Ask Vishwaship for a new one.");
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, t.userId));
  if (!u || u.kind !== "franchise" || !u.active) throw new FranchiseError("This link is invalid or has expired. Ask Vishwaship for a new one.");
  const used = await db.update(schema.oneTimeTokens).set({ usedAt: new Date() }).where(and(eq(schema.oneTimeTokens.id, t.id), isNull(schema.oneTimeTokens.usedAt))).returning({ id: schema.oneTimeTokens.id });
  if (!used.length) throw new FranchiseError("This link was already used");
  await db.update(schema.users).set({ passwordHash: await hashPassword(password), mustResetPassword: false }).where(eq(schema.users.id, u.id));
  await revokeAllSessions(u.id);
  await audit({ actorUserId: u.id, actorKind: "franchise", action: "franchise.password_set", targetType: "user", targetId: u.id });
  return u.id;
}

/** The franchise that a signed-in franchise user runs (null when none or terminated). */
export async function franchiseForUser(userId: string) {
  const db = await getDb();
  const [f] = await db.select().from(schema.franchises).where(eq(schema.franchises.userId, userId));
  return f && f.status !== "terminated" ? f : null;
}

// ---------------- customers (admin link / unlink) ----------------
async function customerOrg(identifier: string) {
  const id = identifier.trim().toLowerCase();
  const db = await getDb();
  const mobile = id.replace(/\D/g, "").slice(-10);
  const [u] = await db.select({ orgId: schema.users.orgId }).from(schema.users)
    .where(and(eq(schema.users.kind, "customer"), or(eq(schema.users.email, id), /^[6-9]\d{9}$/.test(mobile) ? eq(schema.users.mobile, mobile) : sql`false`)));
  if (!u?.orgId) return null;
  const [o] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, u.orgId));
  return o ?? null;
}

export async function linkCustomer(actor: string, franchiseId: string, identifier: string) {
  const f = await getFranchise(franchiseId);
  if (!f) throw new FranchiseError("Franchise not found");
  if (f.status !== "active") throw new FranchiseError("Only an active franchise can get customers");
  const o = await customerOrg(identifier);
  if (!o) throw new FranchiseError("No customer account with this email or mobile");
  if (o.franchiseId === f.id) throw new FranchiseError("This customer is already with this franchise");
  if (o.franchiseId) {
    const other = await getFranchise(o.franchiseId);
    throw new FranchiseError(`This customer is with ${other?.businessName ?? "another franchise"}${other ? ` (${other.code})` : ""}. Remove that link first.`);
  }
  const db = await getDb();
  const res = await db.update(schema.orgs).set({ franchiseId: f.id, franchiseLinkedAt: new Date(), franchiseLinkSource: "admin" }).where(and(eq(schema.orgs.id, o.id), isNull(schema.orgs.franchiseId))).returning({ id: schema.orgs.id });
  if (!res.length) throw new FranchiseError("This customer was just linked to another franchise");
  await audit({ actorUserId: actor, actorKind: "staff", orgId: o.id, action: "franchise.customer_linked", targetType: "franchise", targetId: f.id, details: { business: o.businessName } });
  return o.businessName;
}

export async function unlinkCustomer(actor: string, franchiseId: string, orgId: string) {
  const db = await getDb();
  const res = await db.update(schema.orgs).set({ franchiseId: null, franchiseLinkedAt: null, franchiseLinkSource: null })
    .where(and(eq(schema.orgs.id, orgId), eq(schema.orgs.franchiseId, franchiseId))).returning({ name: schema.orgs.businessName });
  if (!res.length) throw new FranchiseError("This customer is not with this franchise");
  await audit({ actorUserId: actor, actorKind: "staff", orgId, action: "franchise.customer_unlinked", targetType: "franchise", targetId: franchiseId, details: { business: res[0].name } });
}

// ---------------- dashboard data (scoped) ----------------
const LIVE = ne(schema.shipments.bookingStatus, "cancelled");
const BOOKED = and(inArray(schema.shipments.bookingStatus, ["confirmed", "pending", "ambiguous"]), LIVE);

/** Start of the current month in IST, as a UTC Date. */
export function monthStartIst(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3600_000);
}

export type CustomerRow = {
  orgId: string; businessName: string; name: string; email: string | null; mobile: string | null; kycStatus: string; status: string;
  linkedAt: Date | null; source: string | null; createdAt: Date; walletPaise: number; shipmentsMonth: number; valueMonthPaise: number; shipmentsTotal: number; lastShipmentAt: Date | null;
};

export async function franchiseCustomers(franchiseId: string, now = new Date()): Promise<CustomerRow[]> {
  const db = await getDb();
  const orgs = await db.select().from(schema.orgs).where(eq(schema.orgs.franchiseId, franchiseId)).orderBy(desc(schema.orgs.franchiseLinkedAt));
  if (!orgs.length) return [];
  const ids = orgs.map((o) => o.id);
  const since = monthStartIst(now);
  const [users, wallets, stats] = await Promise.all([
    db.select({ orgId: schema.users.orgId, name: schema.users.name, email: schema.users.email, mobile: schema.users.mobile, createdAt: schema.users.createdAt }).from(schema.users)
      .where(and(eq(schema.users.kind, "customer"), inArray(schema.users.orgId, ids))).orderBy(schema.users.createdAt),
    db.select({ orgId: schema.wallets.orgId, posted: schema.wallets.postedPaise, reserved: schema.wallets.reservedPaise }).from(schema.wallets).where(inArray(schema.wallets.orgId, ids)),
    db.select({
      orgId: schema.shipments.orgId,
      total: sql<number>`count(*)::int`,
      month: sql<number>`count(*) filter (where ${schema.shipments.createdAt} >= ${since})::int`,
      value: sql<number>`coalesce(sum(${schema.shipments.sellPaise}) filter (where ${schema.shipments.createdAt} >= ${since}), 0)::bigint`,
      last: sql<Date | null>`max(${schema.shipments.createdAt})`,
    }).from(schema.shipments).where(and(inArray(schema.shipments.orgId, ids), BOOKED)).groupBy(schema.shipments.orgId),
  ]);
  return orgs.map((o) => {
    const u = users.find((x) => x.orgId === o.id);
    const w = wallets.find((x) => x.orgId === o.id);
    const s = stats.find((x) => x.orgId === o.id);
    return {
      orgId: o.id, businessName: o.businessName, name: u?.name ?? o.name, email: u?.email ?? null, mobile: u?.mobile ?? null, kycStatus: o.kycStatus, status: o.status,
      linkedAt: o.franchiseLinkedAt, source: o.franchiseLinkSource, createdAt: o.createdAt, walletPaise: w ? w.posted - w.reserved : 0,
      shipmentsMonth: s?.month ?? 0, valueMonthPaise: Number(s?.value ?? 0), shipmentsTotal: s?.total ?? 0, lastShipmentAt: s?.last ? new Date(s.last) : null,
    };
  });
}

export async function franchiseSummary(franchiseId: string, now = new Date()) {
  const rows = await franchiseCustomers(franchiseId, now);
  const since = monthStartIst(now);
  const db = await getDb();
  const [{ delivered }] = rows.length ? await db.select({ delivered: sql<number>`count(*)::int` }).from(schema.shipments)
    .where(and(inArray(schema.shipments.orgId, rows.map((r) => r.orgId)), BOOKED, eq(schema.shipments.status, "delivered"), gte(schema.shipments.createdAt, since))) : [{ delivered: 0 }];
  return {
    customers: rows.length,
    newThisMonth: rows.filter((r) => r.linkedAt && r.linkedAt >= since).length,
    activeThisMonth: rows.filter((r) => r.shipmentsMonth > 0).length,
    shipmentsMonth: rows.reduce((s, r) => s + r.shipmentsMonth, 0),
    deliveredMonth: delivered,
    valueMonthPaise: rows.reduce((s, r) => s + r.valueMonthPaise, 0),
    walletPaise: rows.reduce((s, r) => s + r.walletPaise, 0),
    rows,
  };
}

/** One customer of this franchise, or null when it is not theirs. */
export async function franchiseCustomer(franchiseId: string, orgId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.orgs).where(and(eq(schema.orgs.id, orgId), eq(schema.orgs.franchiseId, franchiseId)));
  return o ?? null;
}

export type ShipmentRow = { id: string; orgId: string; business: string; orderNumber: string; awb: string | null; carrierName: string; status: string; bookingStatus: string;
  paymentType: string; sellPaise: number; city: string; pincode: string; createdAt: Date; deliveredAt: Date | null };

/** Shipments of this franchise's customers (optionally one customer), newest first. Never includes cost or provider. */
export async function franchiseShipments(franchiseId: string, opts: { orgId?: string; status?: string; limit?: number } = {}): Promise<ShipmentRow[]> {
  const db = await getDb();
  const rows = await db.select({
    id: schema.shipments.id, orgId: schema.shipments.orgId, business: schema.orgs.businessName, orderNumber: schema.orders.orderNumber, awb: schema.shipments.awb,
    carrierName: schema.shipments.carrierName, status: schema.shipments.status, bookingStatus: schema.shipments.bookingStatus, paymentType: schema.orders.paymentType,
    sellPaise: schema.shipments.sellPaise, consignee: schema.orders.consignee, createdAt: schema.shipments.createdAt, deliveredAt: schema.shipments.deliveredAt,
  }).from(schema.shipments)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(eq(schema.orgs.franchiseId, franchiseId), opts.orgId ? eq(schema.shipments.orgId, opts.orgId) : undefined, opts.status ? eq(schema.shipments.status, opts.status) : undefined))
    .orderBy(desc(schema.shipments.createdAt)).limit(Math.min(opts.limit ?? 200, 500));
  return rows.map(({ consignee, ...r }) => {
    const c = (consignee ?? {}) as { city?: string; pincode?: string };
    return { ...r, city: c.city ?? "", pincode: c.pincode ?? "" };
  });
}

/** Recent wallet entries of one customer (amounts and kinds only). */
export async function customerWallet(orgId: string, limit = 20) {
  const db = await getDb();
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  if (!w) return { balancePaise: 0, heldPaise: 0, entries: [] };
  const entries = await db.select({ id: schema.ledgerEntries.id, kind: schema.ledgerEntries.kind, amountPaise: schema.ledgerEntries.amountPaise, balanceAfterPaise: schema.ledgerEntries.balanceAfterPaise, createdAt: schema.ledgerEntries.createdAt })
    .from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), ne(schema.ledgerEntries.amountPaise, 0))).orderBy(desc(schema.ledgerEntries.createdAt)).limit(limit);
  return { balancePaise: w.postedPaise - w.reservedPaise, heldPaise: w.reservedPaise, entries };
}
