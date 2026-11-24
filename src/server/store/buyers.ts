import "server-only";
import { randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { getAuthSettings, sendEmail } from "@/server/email/service";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";

/**
 * Online Store buyer accounts (phase 7b). One account per store, identified by a verified mobile (Firebase phone OTP)
 * or a verified email (6-digit email code). No passwords. The session is a signed, httpOnly cookie per store.
 * Orders are linked by buyer_id when placed while logged in; older guest orders show up when their mobile / email
 * matches the verified login, so a buyer only ever sees orders placed with their own number or email.
 */
type Store = { id: string; orgId: string; name: string; slug: string };
export type BuyerAddress = { id: string; label: string; name: string; mobile: string; line1: string; line2: string; pincode: string; city: string; state: string; isDefault: boolean };
export type Buyer = { id: string; storeId: string; name: string; mobile: string | null; email: string | null; addresses: BuyerAddress[] };

export class BuyerError extends Error { constructor(message: string, public field?: string) { super(message); } }

const KEY = () => process.env.APP_ENCRYPTION_KEY ?? "dev";
const DAYS = 30;
const cookieName = (storeId: string) => `sfb_${storeId.replace(/[^A-Za-z0-9_]/g, "")}`;
const sign = (v: string) => hmacSha256Hex(KEY(), `store-buyer:${v}`);
const MOBILE = /^[6-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normMobile = (v: string) => v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");

function toBuyer(r: typeof schema.storeBuyers.$inferSelect): Buyer {
  return { id: r.id, storeId: r.storeId, name: r.name, mobile: r.mobile, email: r.email, addresses: ((r.addresses as BuyerAddress[] | null) ?? []).slice(0, 10) };
}

async function setSession(storeId: string, buyerId: string) {
  const exp = Date.now() + DAYS * 86400_000;
  const v = `${buyerId}.${exp}`;
  (await cookies()).set(cookieName(storeId), `${v}.${sign(`${storeId}:${v}`)}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: DAYS * 86400 });
}

/** The logged-in buyer of this store, or null. */
export async function currentBuyer(storeId: string): Promise<Buyer | null> {
  const raw = (await cookies()).get(cookieName(storeId))?.value;
  if (!raw) return null;
  const [id, exp, mac] = raw.split(".");
  if (!id || !exp || !mac || Number(exp) < Date.now() || !safeEqual(mac, sign(`${storeId}:${id}.${exp}`))) return null;
  const db = await getDb();
  const [r] = await db.select().from(schema.storeBuyers).where(and(eq(schema.storeBuyers.id, id), eq(schema.storeBuyers.storeId, storeId)));
  return r ? toBuyer(r) : null;
}

export async function logoutBuyer(storeId: string) {
  (await cookies()).delete(cookieName(storeId));
}

/** Find or create the buyer for a verified mobile / email, then sign in. */
async function signIn(store: Store, by: { mobile?: string; email?: string }, name = "") {
  const db = await getDb();
  const where = by.mobile ? eq(schema.storeBuyers.mobile, by.mobile) : eq(schema.storeBuyers.email, by.email!);
  let [r] = await db.select().from(schema.storeBuyers).where(and(eq(schema.storeBuyers.storeId, store.id), where));
  if (!r) {
    [r] = await db.insert(schema.storeBuyers).values({ id: newId("sb"), storeId: store.id, orgId: store.orgId, mobile: by.mobile ?? null, email: by.email ?? null, name: name.slice(0, 80) })
      .onConflictDoNothing().returning();
    if (!r) [r] = await db.select().from(schema.storeBuyers).where(and(eq(schema.storeBuyers.storeId, store.id), where));
  }
  await db.update(schema.storeBuyers).set({ lastLoginAt: new Date() }).where(eq(schema.storeBuyers.id, r.id));
  await setSession(store.id, r.id);
  return toBuyer(r);
}

/** Which mobile OTP the store's buyers get (Store → Connect apps). null = email codes only. */
export async function buyerOtpConfig(settingsRaw: unknown): Promise<{ source: "vishwaship" | "own"; config: { apiKey: string; authDomain: string; projectId: string; appId?: string } } | null> {
  const { readSettings } = await import("@/lib/store-themes");
  const bl = readSettings(settingsRaw).buyerLogin;
  if (bl.otp === "email_only") return null;
  if (bl.otp === "own_firebase") {
    const f = bl.firebase;
    return f.apiKey && f.authDomain && f.projectId ? { source: "own", config: { apiKey: f.apiKey, authDomain: f.authDomain, projectId: f.projectId, ...(f.appId ? { appId: f.appId } : {}) } } : null;
  }
  const { firebasePhoneConfig } = await import("@/server/auth/firebase-phone");
  const cfg = await firebasePhoneConfig();
  return cfg ? { source: "vishwaship", config: cfg } : null;
}

/**
 * Vishwaship's OTP costs us an SMS: each successful login takes notification credits from the merchant
 * (Admin → Notifications "store_otp", default 4 credits). One charge per number per 10 minutes (retries are free).
 */
export async function chargeOtpCredits(orgId: string, storeId: string, mobile: string): Promise<boolean> {
  const { getSetting } = await import("@/server/quotes/service");
  const n = (await getSetting<Record<string, number>>("notification_credit_cost", {})).value.store_otp ?? 4;
  if (n <= 0) return true;
  const key = `sfb-otp:${storeId}:${mobile}:${Math.floor(Date.now() / 600_000)}`;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [done] = await tx.select({ id: schema.creditEntries.id }).from(schema.creditEntries).where(eq(schema.creditEntries.idempotencyKey, key));
    if (done) return true;
    const upd = await tx.update(schema.creditBalances).set({ credits: sql`${schema.creditBalances.credits} - ${n}` })
      .where(and(eq(schema.creditBalances.orgId, orgId), sql`${schema.creditBalances.credits} >= ${n}`)).returning({ c: schema.creditBalances.credits });
    if (!upd.length) return false;
    await tx.insert(schema.creditEntries).values({ id: newId("ce"), orgId, kind: "settle", credits: -n, idempotencyKey: key, refType: "store_buyer_otp", refId: storeId });
    return true;
  });
}

/** Mobile OTP: the browser verified the number with Firebase; the server checks the ID token. */
export async function loginWithPhoneToken(store: Store, mobile: string) {
  if (!MOBILE.test(mobile)) throw new BuyerError("Use a 10-digit Indian mobile number");
  return signIn(store, { mobile });
}

// ---------- email code ----------
const purpose = (storeId: string) => `sfb:${storeId}`;
const codeHash = (storeId: string, email: string, code: string) => hmacSha256Hex(KEY(), `store-buyer-otp:${storeId}:${email}:${code}`);

export async function sendEmailCode(store: Store, rawEmail: string, ip: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 160) throw new BuyerError("Enter a valid email address", "email");
  if (!(await rateLimit(`sfb-otp:ip:${ip}`, 20, 3600)).ok || !(await rateLimit(`sfb-otp:em:${store.id}:${email}`, 6, 3600)).ok) throw new BuyerError("Too many codes requested. Please try again later.");
  const cfg = await getAuthSettings();
  const db = await getDb();
  const p = purpose(store.id);
  const [last] = await db.select().from(schema.otpChallenges).where(and(eq(schema.otpChallenges.target, email), eq(schema.otpChallenges.purpose, p))).orderBy(desc(schema.otpChallenges.createdAt)).limit(1);
  if (last && !last.verifiedAt) {
    const wait = Math.ceil((last.createdAt.getTime() + cfg.otpCooldownSec * 1000 - Date.now()) / 1000);
    if (wait > 0) throw new BuyerError(`Please wait ${wait} s before asking for a new code`);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.delete(schema.otpChallenges).where(and(eq(schema.otpChallenges.target, email), eq(schema.otpChallenges.purpose, p), isNull(schema.otpChallenges.verifiedAt)));
  await db.insert(schema.otpChallenges).values({ id: newId("otp"), target: email, purpose: p, codeHash: codeHash(store.id, email, code), expiresAt: new Date(Date.now() + cfg.otpValidityMin * 60_000) });
  const r = await sendEmail({ event: "store_buyer_otp", to: email, toKind: "signup", orgId: store.orgId, ignoreRule: true,
    vars: { store_name: store.name, otp: code, otp_validity: `${cfg.otpValidityMin} minute${cfg.otpValidityMin === 1 ? "" : "s"}` } });
  if (r.status === "failed") throw new BuyerError("We could not send the code right now. Please try again in a minute.");
  return { cooldownSec: cfg.otpCooldownSec, validityMin: cfg.otpValidityMin };
}

export async function loginWithEmailCode(store: Store, rawEmail: string, code: string) {
  const email = rawEmail.trim().toLowerCase();
  const cfg = await getAuthSettings();
  const db = await getDb();
  const p = purpose(store.id);
  const [c] = await db.select().from(schema.otpChallenges).where(and(eq(schema.otpChallenges.target, email), eq(schema.otpChallenges.purpose, p), isNull(schema.otpChallenges.verifiedAt))).orderBy(desc(schema.otpChallenges.createdAt)).limit(1);
  if (!c) throw new BuyerError("Ask for a login code first", "code");
  if (c.expiresAt.getTime() < Date.now()) throw new BuyerError("This code has expired. Ask for a new one.", "code");
  if (c.attempts >= cfg.otpMaxAttempts) throw new BuyerError("Too many wrong attempts. Ask for a new code.", "code");
  if (!/^\d{6}$/.test(code.trim()) || !safeEqual(c.codeHash, codeHash(store.id, email, code.trim()))) {
    await db.update(schema.otpChallenges).set({ attempts: c.attempts + 1 }).where(eq(schema.otpChallenges.id, c.id));
    const left = cfg.otpMaxAttempts - c.attempts - 1;
    throw new BuyerError(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Ask for a new code.", "code");
  }
  const used = await db.update(schema.otpChallenges).set({ verifiedAt: new Date() }).where(and(eq(schema.otpChallenges.id, c.id), isNull(schema.otpChallenges.verifiedAt))).returning({ id: schema.otpChallenges.id });
  if (!used.length) throw new BuyerError("This code was already used", "code");
  return signIn(store, { email });
}

// ---------- profile + addresses ----------
export const AddressInput = z.object({
  id: z.string().max(40).optional(),
  label: z.string().trim().max(30).default("Home"),
  name: z.string().trim().min(2, "Enter the name").max(80),
  mobile: z.string().transform(normMobile).refine((v) => MOBILE.test(v), "Enter a 10-digit mobile number"),
  line1: z.string().trim().min(3, "Enter the address").max(200),
  line2: z.string().trim().max(200).default(""),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a 6-digit pincode"),
  city: z.string().trim().min(2, "Enter the city").max(60),
  state: z.string().trim().min(2, "Enter the state").max(60),
  isDefault: z.boolean().default(false),
});

async function saveAddresses(buyerId: string, list: BuyerAddress[]) {
  const db = await getDb();
  // exactly one default when there is any address
  if (list.length && !list.some((a) => a.isDefault)) list[0].isDefault = true;
  await db.update(schema.storeBuyers).set({ addresses: list.slice(0, 10) }).where(eq(schema.storeBuyers.id, buyerId));
}

export async function upsertAddress(buyer: Buyer, input: z.input<typeof AddressInput>) {
  const a = AddressInput.parse(input);
  let list = [...buyer.addresses];
  const id = a.id && list.some((x) => x.id === a.id) ? a.id : newId("ad");
  if (!a.id && list.length >= 10) throw new BuyerError("You can save up to 10 addresses. Delete one first.");
  const row: BuyerAddress = { id, label: a.label || "Home", name: a.name, mobile: a.mobile, line1: a.line1, line2: a.line2, pincode: a.pincode, city: a.city, state: a.state, isDefault: a.isDefault };
  list = list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? row : x)) : [...list, row];
  if (row.isDefault) list = list.map((x) => ({ ...x, isDefault: x.id === id }));
  await saveAddresses(buyer.id, list);
  return id;
}

export async function deleteAddress(buyer: Buyer, id: string) {
  await saveAddresses(buyer.id, buyer.addresses.filter((x) => x.id !== id));
}

export async function updateProfile(buyer: Buyer, name: string) {
  const db = await getDb();
  await db.update(schema.storeBuyers).set({ name: name.trim().slice(0, 80) }).where(eq(schema.storeBuyers.id, buyer.id));
}

/** After checkout while logged in: remember the delivery address when it is new (same line1 + pincode = same address). */
export async function rememberAddress(buyerId: string, b: { name: string; mobile: string; line1: string; line2?: string; pincode: string; city: string; state: string }) {
  const db = await getDb();
  const [r] = await db.select().from(schema.storeBuyers).where(eq(schema.storeBuyers.id, buyerId));
  if (!r) return;
  const buyer = toBuyer(r);
  const same = buyer.addresses.some((x) => x.line1.trim().toLowerCase() === b.line1.trim().toLowerCase() && x.pincode === b.pincode);
  if (!same && buyer.addresses.length < 10) {
    await saveAddresses(buyer.id, [...buyer.addresses, { id: newId("ad"), label: buyer.addresses.length ? "Other" : "Home", name: b.name, mobile: b.mobile, line1: b.line1, line2: b.line2 ?? "", pincode: b.pincode, city: b.city, state: b.state, isDefault: !buyer.addresses.length }]);
  }
  if (!buyer.name && b.name) await db.update(schema.storeBuyers).set({ name: b.name.slice(0, 80) }).where(eq(schema.storeBuyers.id, buyer.id));
}

/** Orders this buyer may see: linked to the account, or placed with the account's verified mobile / email. */
export function buyerOrderFilter(buyer: Buyer) {
  const conds = [eq(schema.storeOrders.buyerId, buyer.id)];
  if (buyer.mobile) conds.push(sql`${schema.storeOrders.buyer}->>'mobile' = ${buyer.mobile}`);
  if (buyer.email) conds.push(sql`lower(${schema.storeOrders.buyer}->>'email') = ${buyer.email}`);
  return and(eq(schema.storeOrders.storeId, buyer.storeId), or(...conds))!;
}
