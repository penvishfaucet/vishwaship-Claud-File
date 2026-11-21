import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import { canonicalDistrict, canonicalState, districtKey, pincodeKey } from "@/lib/india-districts";
import { DEFAULT_FRANCHISE_TERMS, activationChecklist, depositSummary } from "@/lib/franchise";

/**
 * Franchise module, phase 1 (admin side): franchise records, exclusive areas, security deposit received offline,
 * versioned Terms & Conditions, and the activate / suspend / terminate lifecycle. Every change is audited.
 */
export class FranchiseError extends Error {}

export type Franchise = typeof schema.franchises.$inferSelect;
export type FranchiseArea = typeof schema.franchiseAreas.$inferSelect;
export type FranchiseDeposit = typeof schema.franchiseDeposits.$inferSelect;

const isUnique = (e: unknown) => /unique|duplicate/i.test((e as Error).message) || (e as { cause?: { code?: string } }).cause?.code === "23505"
  || /unique|duplicate/i.test(String((e as { cause?: { message?: string } }).cause?.message ?? ""));

const log = (actor: string, action: string, f: { id: string }, details?: Record<string, unknown>) =>
  audit({ actorUserId: actor, actorKind: "staff", action: `franchise.${action}`, targetType: "franchise", targetId: f.id, details });

// ---------------- Terms & Conditions ----------------
export async function currentTerms(): Promise<{ version: number; body: string; createdAt: Date | null }> {
  const db = await getDb();
  const [t] = await db.select().from(schema.franchiseTerms).orderBy(desc(schema.franchiseTerms.version)).limit(1);
  return t ? { version: t.version, body: t.body, createdAt: t.createdAt } : { version: 0, body: DEFAULT_FRANCHISE_TERMS, createdAt: null };
}

export async function termsVersions() {
  const db = await getDb();
  return db.select().from(schema.franchiseTerms).orderBy(desc(schema.franchiseTerms.version));
}

/** Publish a new version. Existing franchises stay on the version they signed until a new agreement is recorded. */
export async function publishTerms(actor: string, body: string) {
  const text = body.replace(/\r\n/g, "\n").trim();
  if (text.length < 50) throw new FranchiseError("Terms are too short");
  if (text.length > 20_000) throw new FranchiseError("Terms are too long (max 20,000 characters)");
  const cur = await currentTerms();
  if (cur.version > 0 && cur.body === text) throw new FranchiseError("No change to publish");
  const db = await getDb();
  const version = cur.version + 1;
  await db.insert(schema.franchiseTerms).values({ version, body: text, createdBy: actor });
  await audit({ actorUserId: actor, actorKind: "staff", action: "franchise.terms_published", targetType: "franchise_terms", targetId: String(version), details: { version, chars: text.length } });
  return version;
}

// ---------------- franchise record ----------------
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const dateStr = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional().or(z.literal("")).transform((v) => (v ? new Date(`${v}T00:00:00+05:30`) : null));

export const FranchiseInput = z.object({
  businessName: z.string().trim().min(2, "Enter the business name").max(120),
  ownerName: z.string().trim().min(2, "Enter the owner's name").max(80),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(160),
  gstin: opt(15).refine((v) => !v || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), "GSTIN looks wrong (15 characters, e.g. 27ABCDE1234F1Z5)"),
  pan: opt(10).refine((v) => !v || /^[A-Z]{5}\d{4}[A-Z]$/.test(v), "PAN looks wrong (e.g. ABCDE1234F)"),
  line1: opt(160), line2: opt(160), city: opt(80), state: opt(60),
  pincode: opt(6).refine((v) => !v || /^[1-9]\d{5}$/.test(v), "Enter a valid 6-digit PIN"),
  depositRupees: z.coerce.number().int("Deposit must be whole rupees").min(0).max(10_000_000),
  monthlyTarget: z.coerce.number().int().min(0).max(1_000_000),
  termStart: dateStr,
  termEnd: dateStr,
  notes: opt(2000),
}).superRefine((v, ctx) => {
  if (v.termStart && v.termEnd && v.termEnd <= v.termStart) ctx.addIssue({ code: "custom", path: ["termEnd"], message: "Term end must be after the start" });
});
/** Form values arrive as strings; numbers are accepted too (tests, scripts). */
type Loose<T> = { [K in keyof T]?: string | number | null };
export type FranchiseInputT = Loose<z.input<typeof FranchiseInput>>;

function toRow(v: z.output<typeof FranchiseInput>) {
  const address = v.line1 || v.city || v.state || v.pincode ? { line1: v.line1, line2: v.line2, city: v.city, state: v.state, pincode: v.pincode } : null;
  return {
    businessName: v.businessName, ownerName: v.ownerName, mobile: v.mobile, email: v.email, gstin: v.gstin?.toUpperCase() ?? null, pan: v.pan?.toUpperCase() ?? null,
    address, depositRequiredPaise: v.depositRupees * 100, monthlyTargetShipments: v.monthlyTarget, termStart: v.termStart, termEnd: v.termEnd, notes: v.notes,
  };
}

function parse(input: FranchiseInputT) {
  const up = (v: unknown) => (typeof v === "string" ? v.toUpperCase() : v);
  const p = FranchiseInput.safeParse({ ...input, gstin: up(input.gstin) ?? undefined, pan: up(input.pan) ?? undefined });
  if (!p.success) throw new FranchiseError(p.error.issues[0].message);
  return p.data;
}

async function nextCode() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.franchises);
  return n + 1;
}
export const franchiseCode = (n: number) => `VSF-${String(n).padStart(4, "0")}`;

export async function createFranchise(actor: string, input: FranchiseInputT) {
  const v = parse(input);
  const db = await getDb();
  const id = newId("fr");
  let n = await nextCode();
  for (let attempt = 0; ; attempt++) {
    try {
      await db.insert(schema.franchises).values({ id, code: franchiseCode(n), ...toRow(v), createdBy: actor });
      break;
    } catch (e) {
      if (!isUnique(e) || attempt > 20) throw e;
      n++;
    }
  }
  await log(actor, "created", { id }, { code: franchiseCode(n), depositPaise: v.depositRupees * 100 });
  return id;
}

export async function getFranchise(id: string) {
  const db = await getDb();
  const [f] = await db.select().from(schema.franchises).where(eq(schema.franchises.id, id));
  return f ?? null;
}

async function mustGet(id: string) {
  const f = await getFranchise(id);
  if (!f) throw new FranchiseError("Franchise not found");
  return f;
}

export async function updateFranchise(actor: string, id: string, input: FranchiseInputT) {
  const f = await mustGet(id);
  if (f.status === "terminated") throw new FranchiseError("A terminated franchise cannot be edited");
  const v = parse(input);
  const row = toRow(v);
  const db = await getDb();
  if (f.userId && (row.email !== f.email || row.ownerName !== f.ownerName)) {
    // keep the franchise login in step with the record (the login email is the franchise email)
    try { await db.update(schema.users).set({ email: row.email, name: row.ownerName }).where(eq(schema.users.id, f.userId)); }
    catch (e) { if (isUnique(e)) throw new FranchiseError("Another franchise login already uses this email"); throw e; }
  }
  await db.update(schema.franchises).set({ ...row, updatedAt: new Date() }).where(eq(schema.franchises.id, id));
  const changed = (Object.keys(row) as Array<keyof typeof row>).filter((k) => JSON.stringify(row[k]) !== JSON.stringify(f[k]));
  await log(actor, "updated", f, { changed });
}

// ---------------- areas ----------------
async function holderOf(areaKeys: string[]) {
  if (!areaKeys.length) return [];
  const db = await getDb();
  return db.select({ a: schema.franchiseAreas, code: schema.franchises.code, name: schema.franchises.businessName }).from(schema.franchiseAreas)
    .innerJoin(schema.franchises, eq(schema.franchises.id, schema.franchiseAreas.franchiseId))
    .where(and(inArray(schema.franchiseAreas.areaKey, areaKeys), isNull(schema.franchiseAreas.releasedAt)));
}

async function insertArea(actor: string, f: Franchise, row: Omit<typeof schema.franchiseAreas.$inferInsert, "id" | "franchiseId" | "assignedBy">) {
  const db = await getDb();
  try {
    await db.insert(schema.franchiseAreas).values({ id: newId("fra"), franchiseId: f.id, assignedBy: actor, ...row });
  } catch (e) {
    if (!isUnique(e)) throw e;
    const [h] = await holderOf([row.areaKey]);
    throw new FranchiseError(h ? `This area already belongs to ${h.name} (${h.code})` : "This area was just given to another franchise");
  }
}

/** Give a whole district. Exclusive: no other live franchise may hold the district or any PIN inside it. */
export async function addDistrict(actor: string, franchiseId: string, stateIn: string, districtIn: string) {
  const f = await mustGet(franchiseId);
  if (f.status === "terminated") throw new FranchiseError("A terminated franchise cannot get new areas");
  const state = canonicalState(stateIn);
  if (!state) throw new FranchiseError("Choose a state from the list");
  if (districtIn.trim().length < 2) throw new FranchiseError("Enter the district");
  const district = canonicalDistrict(state, districtIn);
  const key = districtKey(state, district.name);
  const [held] = await holderOf([key]);
  if (held) throw new FranchiseError(held.a.franchiseId === f.id ? "This franchise already has this district" : `${district.name} already belongs to ${held.name} (${held.code})`);
  const db = await getDb();
  const pins = await db.select({ a: schema.franchiseAreas, code: schema.franchises.code, name: schema.franchises.businessName }).from(schema.franchiseAreas)
    .innerJoin(schema.franchises, eq(schema.franchises.id, schema.franchiseAreas.franchiseId))
    .where(and(eq(schema.franchiseAreas.kind, "pincode"), isNull(schema.franchiseAreas.releasedAt), sql`lower(${schema.franchiseAreas.state}) = ${state.toLowerCase()}`, sql`lower(${schema.franchiseAreas.district}) = ${district.name.toLowerCase()}`));
  const other = pins.find((p) => p.a.franchiseId !== f.id);
  if (other) throw new FranchiseError(`PIN ${other.a.pincode} in ${district.name} belongs to ${other.name} (${other.code}). Release it first.`);
  await insertArea(actor, f, { kind: "district", state, district: district.name, pincode: null, areaKey: key });
  // This franchise's own extra PINs inside the district are now covered by the district.
  const own = pins.filter((p) => p.a.franchiseId === f.id).map((p) => p.a.id);
  if (own.length) await db.update(schema.franchiseAreas).set({ releasedAt: new Date(), releasedBy: actor }).where(inArray(schema.franchiseAreas.id, own));
  await log(actor, "area_added", f, { state, district: district.name, listed: district.known, mergedPins: own.length });
  return { state, district: district.name, known: district.known };
}

export type PinLookup = (pin: string) => Promise<{ status: string; city?: string; state?: string; partial?: boolean; source?: string }>;

/** Give one extra PIN (for a partial area). The PIN's district comes from the India Post directory. */
export async function addPincode(actor: string, franchiseId: string, pinIn: string, lookup: PinLookup) {
  const f = await mustGet(franchiseId);
  if (f.status === "terminated") throw new FranchiseError("A terminated franchise cannot get new areas");
  const pin = pinIn.trim();
  if (!/^[1-9]\d{5}$/.test(pin)) throw new FranchiseError("Enter a valid 6-digit PIN");
  const r = await lookup(pin);
  if (r.status !== "found" || !r.state) throw new FranchiseError("This PIN was not found in the India Post directory");
  if (r.partial || r.source === "offline" || !r.city) throw new FranchiseError("The PIN directory is not answering right now, so the district cannot be checked. Try again in a few minutes.");
  const state = canonicalState(r.state) ?? r.state;
  const district = canonicalDistrict(state, r.city).name;
  const [byDistrict] = await holderOf([districtKey(state, district)]);
  if (byDistrict) throw new FranchiseError(byDistrict.a.franchiseId === f.id ? `This franchise already has all of ${district}` : `PIN ${pin} is in ${district}, which belongs to ${byDistrict.name} (${byDistrict.code})`);
  const [byPin] = await holderOf([pincodeKey(pin)]);
  if (byPin) throw new FranchiseError(byPin.a.franchiseId === f.id ? "This franchise already has this PIN" : `PIN ${pin} already belongs to ${byPin.name} (${byPin.code})`);
  await insertArea(actor, f, { kind: "pincode", state, district, pincode: pin, areaKey: pincodeKey(pin) });
  await log(actor, "area_added", f, { pincode: pin, state, district });
  return { pin, state, district };
}

export async function releaseArea(actor: string, areaId: string) {
  const db = await getDb();
  const [a] = await db.select().from(schema.franchiseAreas).where(eq(schema.franchiseAreas.id, areaId));
  if (!a || a.releasedAt) throw new FranchiseError("Area not found");
  const f = await mustGet(a.franchiseId);
  const live = await db.select({ id: schema.franchiseAreas.id }).from(schema.franchiseAreas).where(and(eq(schema.franchiseAreas.franchiseId, f.id), isNull(schema.franchiseAreas.releasedAt)));
  if (f.status === "active" && live.length <= 1) throw new FranchiseError("An active franchise needs at least one area. Add another area or suspend the franchise first.");
  await db.update(schema.franchiseAreas).set({ releasedAt: new Date(), releasedBy: actor }).where(eq(schema.franchiseAreas.id, a.id));
  await log(actor, "area_released", f, { state: a.state, district: a.district, pincode: a.pincode });
}

export async function areasOf(franchiseId: string, includeReleased = false) {
  const db = await getDb();
  return db.select().from(schema.franchiseAreas)
    .where(includeReleased ? eq(schema.franchiseAreas.franchiseId, franchiseId) : and(eq(schema.franchiseAreas.franchiseId, franchiseId), isNull(schema.franchiseAreas.releasedAt)))
    .orderBy(asc(schema.franchiseAreas.state), asc(schema.franchiseAreas.district), asc(schema.franchiseAreas.pincode));
}

/** Who holds a district (or a PIN, by its district) — for the "Check area" tool. */
export async function areaStatus(stateIn: string, districtIn: string) {
  const state = canonicalState(stateIn);
  if (!state) throw new FranchiseError("Choose a state from the list");
  const district = canonicalDistrict(state, districtIn).name;
  const [held] = await holderOf([districtKey(state, district)]);
  const db = await getDb();
  const pins = await db.select({ pin: schema.franchiseAreas.pincode, code: schema.franchises.code, name: schema.franchises.businessName }).from(schema.franchiseAreas)
    .innerJoin(schema.franchises, eq(schema.franchises.id, schema.franchiseAreas.franchiseId))
    .where(and(eq(schema.franchiseAreas.kind, "pincode"), isNull(schema.franchiseAreas.releasedAt), sql`lower(${schema.franchiseAreas.state}) = ${state.toLowerCase()}`, sql`lower(${schema.franchiseAreas.district}) = ${district.toLowerCase()}`));
  return { state, district, holder: held ? { id: held.a.franchiseId, code: held.code, name: held.name } : null, pins };
}

// ---------------- security deposit ----------------
const DEPOSIT_METHODS = ["bank_transfer", "upi", "cheque", "cash"] as const;
export const DepositInput = z.object({
  amountRupees: z.coerce.number().int("Amount must be whole rupees").min(1, "Enter the amount received").max(10_000_000),
  method: z.enum(DEPOSIT_METHODS, { errorMap: () => ({ message: "Choose how it was paid" }) }),
  reference: z.string().trim().max(40).optional().transform((v) => v || null),
  receivedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it was received"),
}).superRefine((v, ctx) => {
  if (v.method !== "cash" && !v.reference) ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the UTR / transaction / cheque number" });
  if (v.reference && !/^[A-Za-z0-9\-/ ]{4,40}$/.test(v.reference)) ctx.addIssue({ code: "custom", path: ["reference"], message: "Reference should be the UTR / cheque number only" });
});

export async function recordDeposit(actor: string, franchiseId: string, input: Loose<z.input<typeof DepositInput>>) {
  const f = await mustGet(franchiseId);
  if (f.status === "terminated") throw new FranchiseError("A terminated franchise cannot take a new deposit");
  const p = DepositInput.safeParse(input);
  if (!p.success) throw new FranchiseError(p.error.issues[0].message);
  const receivedOn = new Date(`${p.data.receivedOn}T00:00:00+05:30`);
  if (receivedOn.getTime() > Date.now() + 86400_000) throw new FranchiseError("Received date cannot be in the future");
  const db = await getDb();
  const id = newId("frd");
  const ym = new Date().toISOString().slice(0, 7).replace("-", "");
  for (let attempt = 0; ; attempt++) {
    const receiptNumber = `VFD-${ym}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`;
    try {
      await db.insert(schema.franchiseDeposits).values({ id, franchiseId: f.id, receiptNumber, amountPaise: p.data.amountRupees * 100, method: p.data.method, reference: p.data.reference, receivedOn, recordedBy: actor });
      await log(actor, "deposit_recorded", f, { receiptNumber, amountPaise: p.data.amountRupees * 100, method: p.data.method });
      return { id, receiptNumber };
    } catch (e) { if (!isUnique(e) || attempt > 5) throw e; }
  }
}

export const SettleInput = z.object({
  refundRupees: z.coerce.number().min(0).max(10_000_000),
  forfeitRupees: z.coerce.number().min(0).max(10_000_000),
  refundReference: z.string().trim().max(40).optional().transform((v) => v || null),
  note: z.string().trim().min(5, "Write the reason (the franchise can be shown it)").max(500),
});

/**
 * Close a held deposit: refund some or all of it (paid back outside Vishwaship, reference recorded) and forfeit the rest
 * under the Terms. Refund + forfeit must equal the deposit. Only possible once the franchise is suspended or terminated,
 * so an active franchise is never left without its deposit.
 */
export async function settleDeposit(actor: string, depositId: string, input: Loose<z.input<typeof SettleInput>>) {
  const p = SettleInput.safeParse(input);
  if (!p.success) throw new FranchiseError(p.error.issues[0].message);
  const db = await getDb();
  const [d] = await db.select().from(schema.franchiseDeposits).where(eq(schema.franchiseDeposits.id, depositId));
  if (!d) throw new FranchiseError("Deposit not found");
  if (d.status !== "held") throw new FranchiseError("This deposit is already closed");
  const f = await mustGet(d.franchiseId);
  if (f.status === "active") throw new FranchiseError("Suspend or terminate the franchise before closing its deposit");
  const refund = Math.round(p.data.refundRupees * 100), forfeit = Math.round(p.data.forfeitRupees * 100);
  if (refund + forfeit !== d.amountPaise) throw new FranchiseError(`Refund + forfeit must add up to the deposit (₹${(d.amountPaise / 100).toLocaleString("en-IN")})`);
  if (refund > 0 && !p.data.refundReference) throw new FranchiseError("Enter the UTR of the refund payment");
  const status = forfeit === 0 ? "refunded" : refund === 0 ? "forfeited" : "partly_refunded";
  const res = await db.update(schema.franchiseDeposits).set({ status, refundPaise: refund, forfeitPaise: forfeit, refundReference: p.data.refundReference, decisionNote: p.data.note, decidedBy: actor, decidedAt: new Date() })
    .where(and(eq(schema.franchiseDeposits.id, d.id), eq(schema.franchiseDeposits.status, "held"))).returning({ id: schema.franchiseDeposits.id });
  if (!res.length) throw new FranchiseError("This deposit is already closed");
  await log(actor, "deposit_settled", f, { receiptNumber: d.receiptNumber, status, refundPaise: refund, forfeitPaise: forfeit });
  return status;
}

export async function depositsOf(franchiseId: string) {
  const db = await getDb();
  return db.select().from(schema.franchiseDeposits).where(eq(schema.franchiseDeposits.franchiseId, franchiseId)).orderBy(desc(schema.franchiseDeposits.createdAt));
}

// ---------------- KYC / agreement / lifecycle ----------------
export async function setKycVerified(actor: string, franchiseId: string, verified: boolean) {
  const f = await mustGet(franchiseId);
  if (verified && (!f.pan || !f.address)) throw new FranchiseError("Add the PAN and address before marking KYC verified");
  if (!verified && f.status === "active") throw new FranchiseError("Suspend the franchise before removing KYC");
  const db = await getDb();
  await db.update(schema.franchises).set({ kycVerifiedAt: verified ? new Date() : null, updatedAt: new Date() }).where(eq(schema.franchises.id, f.id));
  await log(actor, verified ? "kyc_verified" : "kyc_unverified", f);
}

/** Record that the franchise signed the agreement on the current Terms version (signed copy kept offline). */
export async function recordAgreement(actor: string, franchiseId: string, signedOn: string) {
  const f = await mustGet(franchiseId);
  if (f.status === "terminated") throw new FranchiseError("A terminated franchise cannot sign a new agreement");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signedOn)) throw new FranchiseError("Enter the date the agreement was signed");
  const at = new Date(`${signedOn}T00:00:00+05:30`);
  if (at.getTime() > Date.now() + 86400_000) throw new FranchiseError("Signed date cannot be in the future");
  const t = await currentTerms();
  if (t.version === 0) throw new FranchiseError("Publish the Terms & Conditions first (Franchises → Terms & Conditions)");
  const db = await getDb();
  await db.update(schema.franchises).set({ agreementSignedAt: at, termsVersion: t.version, updatedAt: new Date() }).where(eq(schema.franchises.id, f.id));
  await log(actor, "agreement_recorded", f, { termsVersion: t.version, signedOn });
}

export type FranchiseStatus = "draft" | "active" | "suspended" | "terminated";

export async function setStatus(actor: string, franchiseId: string, next: FranchiseStatus, reasonIn = "") {
  const f = await mustGet(franchiseId);
  const reason = reasonIn.trim().slice(0, 500);
  if (f.status === "terminated") throw new FranchiseError("A terminated franchise cannot be changed");
  if (f.status === next) throw new FranchiseError(`Already ${next}`);
  const db = await getDb();
  if (next === "active") {
    const [areas, deps, terms] = await Promise.all([areasOf(f.id), depositsOf(f.id), currentTerms()]);
    const missing = activationChecklist(f, areas.length, depositSummary(f.depositRequiredPaise, deps), terms.version).filter((c) => !c.ok);
    if (missing.length) throw new FranchiseError(`Cannot activate yet: ${missing.map((m) => m.label).join("; ")}`);
    await db.update(schema.franchises).set({ status: "active", statusReason: null, activatedAt: f.activatedAt ?? new Date(), updatedAt: new Date() }).where(eq(schema.franchises.id, f.id));
  } else if (next === "suspended" || next === "terminated") {
    if (reason.length < 5) throw new FranchiseError("Write the reason (at least 5 characters)");
    if (next === "suspended" && f.status !== "active") throw new FranchiseError("Only an active franchise can be suspended");
    await db.update(schema.franchises).set({ status: next, statusReason: reason, updatedAt: new Date() }).where(eq(schema.franchises.id, f.id));
    if (next === "terminated") {
      // Areas become free for a new franchise; the history rows stay.
      await db.update(schema.franchiseAreas).set({ releasedAt: new Date(), releasedBy: actor }).where(and(eq(schema.franchiseAreas.franchiseId, f.id), isNull(schema.franchiseAreas.releasedAt)));
      // Customers continue with Vishwaship directly (Terms 7.4); the login stops working.
      const freed = await db.update(schema.orgs).set({ franchiseId: null, franchiseLinkedAt: null, franchiseLinkSource: null }).where(eq(schema.orgs.franchiseId, f.id)).returning({ id: schema.orgs.id });
      if (freed.length) await log(actor, "customers_released", f, { count: freed.length });
      if (f.userId) {
        await db.update(schema.users).set({ active: false }).where(eq(schema.users.id, f.userId));
        await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, f.userId), isNull(schema.sessions.revokedAt)));
      }
    }
  } else {
    throw new FranchiseError("Unknown status");
  }
  await log(actor, `status_${next}`, f, { from: f.status, reason: reason || undefined });
}

// ---------------- lists ----------------
export async function listFranchises(filter: { status?: string; state?: string; q?: string } = {}) {
  const db = await getDb();
  const rows = await db.select().from(schema.franchises).orderBy(desc(schema.franchises.createdAt)).limit(1000);
  const ids = rows.map((r) => r.id);
  const [areas, deps] = ids.length ? await Promise.all([
    db.select().from(schema.franchiseAreas).where(and(inArray(schema.franchiseAreas.franchiseId, ids), isNull(schema.franchiseAreas.releasedAt))),
    db.select().from(schema.franchiseDeposits).where(inArray(schema.franchiseDeposits.franchiseId, ids)),
  ]) : [[], []];
  const q = filter.q?.trim().toLowerCase();
  return rows.map((f) => {
    const a = areas.filter((x) => x.franchiseId === f.id);
    return { f, areas: a, deposit: depositSummary(f.depositRequiredPaise, deps.filter((d) => d.franchiseId === f.id)) };
  }).filter(({ f, areas: a }) =>
    (!filter.status || f.status === filter.status)
    && (!filter.state || a.some((x) => x.state === filter.state))
    && (!q || [f.code, f.businessName, f.ownerName, f.mobile, f.email].some((s) => s.toLowerCase().includes(q)) || a.some((x) => (x.district ?? x.pincode ?? "").toLowerCase().includes(q))));
}
