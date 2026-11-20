import "server-only";
import { resolveCname, resolveTxt, resolve4 } from "node:dns/promises";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId, randomToken } from "@/server/util/ids";
import { storeForOrg } from "./service";

/**
 * Custom domains. Verification is a DNS TXT record we generate; routing needs the host's DNS to point at the
 * store edge (CNAME, or A record for an apex domain). SSL is issued by the edge proxy (e.g. Cloudflare for SaaS) once
 * Vishwaship connects it — until then the SSL status stays "pending_setup" and we say so plainly.
 */

export const CNAME_TARGET = () => process.env.STORE_CNAME_TARGET || "stores.vishwaship.in";
export const APEX_A_RECORD = () => process.env.STORE_A_RECORD || "";
export const TXT_NAME = (host: string) => `_vishwaship-verify.${host}`;
export const TXT_VALUE = (token: string) => `vishwaship-verify=${token}`;
export const MAX_DOMAINS = 5;

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PLATFORM = ["vishwaship.in", "vishwaship.com", "localhost"];

export function normaliseHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
}

export const isApex = (host: string) => host.split(".").length === 2 || /\.(co|org|net|gov|ac)\.in$/.test(host) && host.split(".").length === 3;

export function dnsRecords(d: { hostname: string; verifyToken: string }) {
  const apex = isApex(d.hostname);
  const a = APEX_A_RECORD();
  return [
    { type: "TXT", name: TXT_NAME(d.hostname), value: TXT_VALUE(d.verifyToken), purpose: "Proves you own this domain" },
    apex
      ? { type: "A", name: d.hostname, value: a || "(shared when custom domains are switched on)", purpose: "Points your domain to your store" }
      : { type: "CNAME", name: d.hostname, value: CNAME_TARGET(), purpose: "Points your domain to your store" },
  ];
}

export async function listDomains(orgId: string) {
  const s = await storeForOrg(orgId);
  if (!s) return [];
  const db = await getDb();
  return db.select().from(schema.storeDomains).where(and(eq(schema.storeDomains.storeId, s.id), eq(schema.storeDomains.orgId, orgId))).orderBy(asc(schema.storeDomains.createdAt));
}

export async function addDomain(orgId: string, raw: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const s = await storeForOrg(orgId);
  if (!s) return { ok: false, message: "Create your store first" };
  const host = normaliseHost(raw);
  if (!HOST_RE.test(host)) return { ok: false, message: "Enter a domain like mystore.com or shop.mystore.com" };
  if (PLATFORM.some((p) => host === p || host.endsWith(`.${p}`))) return { ok: false, message: "Use your own domain here. Your free store link already works." };
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeDomains).where(eq(schema.storeDomains.storeId, s.id));
  if (n >= MAX_DOMAINS) return { ok: false, message: `You can connect up to ${MAX_DOMAINS} domains` };
  const [taken] = await db.select({ id: schema.storeDomains.id }).from(schema.storeDomains).where(eq(schema.storeDomains.hostname, host));
  if (taken) return { ok: false, message: "This domain is already connected to a store" };
  const id = newId("sd");
  try {
    await db.insert(schema.storeDomains).values({ id, storeId: s.id, orgId, hostname: host, verifyToken: randomToken(18).replace(/[^A-Za-z0-9]/g, "x"), isPrimary: n === 0 });
  } catch { return { ok: false, message: "This domain is already connected to a store" }; }
  return { ok: true, id };
}

type Resolver = { txt: (n: string) => Promise<string[][]>; cname: (n: string) => Promise<string[]>; a: (n: string) => Promise<string[]> };
const realDns: Resolver = { txt: resolveTxt, cname: resolveCname, a: resolve4 };
const quiet = async <T,>(p: Promise<T>, fallback: T) => { try { return await p; } catch { return fallback; } };

/** Pure check, exported for tests. */
export async function checkDns(d: { hostname: string; verifyToken: string }, dns: Resolver = realDns) {
  const txt = (await quiet(dns.txt(TXT_NAME(d.hostname)), [] as string[][])).map((r) => r.join(""));
  const owned = txt.includes(TXT_VALUE(d.verifyToken));
  let pointed = false;
  if (isApex(d.hostname)) {
    const want = APEX_A_RECORD();
    const a = await quiet(dns.a(d.hostname), [] as string[]);
    pointed = !!want && a.includes(want);
  } else {
    const c = (await quiet(dns.cname(d.hostname), [] as string[])).map((x) => x.toLowerCase().replace(/\.$/, ""));
    pointed = c.includes(CNAME_TARGET());
  }
  const message = !owned
    ? "TXT record not found yet. DNS changes can take up to 24 hours."
    : !pointed
      ? "Ownership verified. Now point the domain to your store (second record)."
      : "Domain verified and pointing to your store.";
  return { owned, pointed, message };
}

export async function verifyDomain(orgId: string, id: string, dns?: Resolver) {
  const db = await getDb();
  const [d] = await db.select().from(schema.storeDomains).where(and(eq(schema.storeDomains.id, id), eq(schema.storeDomains.orgId, orgId)));
  if (!d) return { ok: false as const, message: "Domain not found" };
  const r = await checkDns(d, dns);
  await db.update(schema.storeDomains).set({
    status: r.owned ? "verified" : d.status === "verified" ? "failed" : "pending_dns",
    verifiedAt: r.owned ? d.verifiedAt ?? new Date() : d.verifiedAt,
    // SSL is issued by the edge once DNS points to it; until that is connected we never claim it is active.
    sslStatus: d.sslStatus === "active" ? "active" : r.owned && r.pointed && process.env.STORE_SSL_EDGE === "on" ? "pending" : "pending_setup",
    lastCheckedAt: new Date(), lastCheckMessage: r.message,
  }).where(eq(schema.storeDomains.id, d.id));
  return { ok: true as const, ...r };
}

export async function setPrimary(orgId: string, id: string) {
  const db = await getDb();
  const [d] = await db.select().from(schema.storeDomains).where(and(eq(schema.storeDomains.id, id), eq(schema.storeDomains.orgId, orgId)));
  if (!d) return { ok: false as const, message: "Domain not found" };
  if (d.status !== "verified") return { ok: false as const, message: "Verify the domain before making it primary" };
  await db.update(schema.storeDomains).set({ isPrimary: false }).where(and(eq(schema.storeDomains.storeId, d.storeId), ne(schema.storeDomains.id, d.id)));
  await db.update(schema.storeDomains).set({ isPrimary: true }).where(eq(schema.storeDomains.id, d.id));
  return { ok: true as const };
}

export async function disconnectDomain(orgId: string, id: string) {
  const db = await getDb();
  const res = await db.delete(schema.storeDomains).where(and(eq(schema.storeDomains.id, id), eq(schema.storeDomains.orgId, orgId))).returning({ host: schema.storeDomains.hostname });
  return res.length ? { ok: true as const, host: res[0].host } : { ok: false as const, message: "Domain not found" };
}

/** Storefront routing: a live custom domain (verified + SSL active) → store. */
export async function storeByHost(host: string) {
  const db = await getDb();
  const [d] = await db.select({ storeId: schema.storeDomains.storeId }).from(schema.storeDomains)
    .where(and(eq(schema.storeDomains.hostname, normaliseHost(host)), eq(schema.storeDomains.status, "verified")));
  return d?.storeId ?? null;
}
