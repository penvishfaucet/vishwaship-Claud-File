import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { lookupPincode, type PinResult } from "@/server/pincode";
import { adapterFor } from "@/server/providers/registry";
import { canTakeBookings } from "@/server/carriers/verification";
import { partnerCodeFor } from "@/server/carriers/specs";
import { FOD_RULE_TEXT, chargeableKg, fodAllowed } from "@/lib/payment";
import { toQuoteRequest } from "./input";
import { accountServes, getQuotes, type QuoteOffer, type ServiceStatus } from "./service";
import { presentOffer } from "./present";

/**
 * Public Rate Calculator: one request checks B2C and B2B together and reports every shipping service separately.
 * Customer-facing names never reveal the aggregator Vishwaship books through (Shipmozo / Shipora X → "Partner network").
 */

export const MSG = {
  pinFormat: "Enter a valid 6-digit pincode.",
  pinUnknown: "Invalid pincode. Please check and try again.",
  pickupNotServiceable: "Pickup pincode is not serviceable.",
  deliveryNotServiceable: "Delivery pincode is not serviceable.",
  routeNoService: "No courier service is available for this pickup and delivery route.",
  retry: "We couldn't reach the courier services just now. Your details are kept — please try again.",
} as const;

const pin = z.string().regex(/^[1-9]\d{5}$/, MSG.pinFormat);
export const PublicRatesInput = z.object({
  originPincode: pin,
  destinationPincode: pin,
  paymentType: z.enum(["prepaid", "cod", "fod"]),
  codAmountRupees: z.number().min(0).max(5_00_000).optional(),
  /** Goods (invoice) value: Delhivery B2B will not quote without it (inv_amount must be > 0). */
  declaredValueRupees: z.number({ invalid_type_error: "Enter the invoice value." }).min(1, "Enter the invoice value.").max(50_00_000, "Maximum ₹50,00,000."),
  packages: z.array(z.object({
    count: z.number().int().min(1).max(500),
    lengthCm: z.number().positive().max(500),
    breadthCm: z.number().positive().max(500),
    heightCm: z.number().positive().max(500),
    weightKg: z.number().positive().max(5000),
  })).min(1).max(20),
}).refine((v) => v.paymentType !== "cod" || (v.codAmountRupees ?? 0) > 0, { message: "Enter the COD amount to collect.", path: ["codAmountRupees"] })
  .refine((v) => v.paymentType !== "fod" || fodAllowed(chargeableKg(v.packages)), { message: `FOD is ${FOD_RULE_TEXT.toLowerCase()}.`, path: ["paymentType"] });
export type PublicRatesInput = z.infer<typeof PublicRatesInput>;

/** The services the calculator compares (owner's list). Shiprocket has no adapter in this project yet. */
export const EXPECTED_SERVICES = [
  { key: "delhivery_b2c", adapter: "delhivery_b2c", mode: "B2C", name: "Delhivery B2C" },
  { key: "delhivery_b2b", adapter: "delhivery_b2b", mode: "B2B", name: "Delhivery B2B" },
  { key: "shipmozo_b2c", adapter: "shipmozo", mode: "B2C", name: "Partner network B2C" },
  { key: "shipmozo_b2b", adapter: "shipmozo", mode: "B2B", name: "Partner network B2B" },
  { key: "shiprocket_b2c", adapter: "shiprocket", mode: "B2C", name: "Shiprocket B2C" },
] as const;

export type PublicServiceState = {
  key: string; name: string; mode: "B2C" | "B2B";
  /** available = returned rates · no_service = does not serve this route/shipment · failed = could not be reached · not_offered = not for this payment mode · inactive = connected but not switched on · not_connected = no integration */
  state: "available" | "no_service" | "failed" | "not_offered" | "inactive" | "not_connected";
  note?: string; count: number;
};

const adapterOf = (a: { adapter: string; configPublic: unknown }) => {
  const proto = (a.configPublic as Record<string, unknown> | null)?.protocol;
  return typeof proto === "string" && proto ? proto : a.adapter;
};
const serviceKey = (adapter: string, mode: "B2C" | "B2B") =>
  adapter === "shiporax" ? `shipmozo_${mode.toLowerCase()}` : `${adapter}_${mode.toLowerCase()}`; // Shipora X is another partner-network route

export function sourceName(adapter: string, mode: "B2C" | "B2B", config: Record<string, unknown> | null) {
  if (adapter === "delhivery_b2c" || adapter === "delhivery_b2b") return `Delhivery ${mode}`;
  if (adapter === "shiprocket") return `Shiprocket ${mode}`;
  if (adapter === "demo") return `Sample network ${mode}`;
  const code = partnerCodeFor(adapter, config);
  return `Partner network ${mode}${code ? ` · ${code}` : ""}`;
}

type Pin = { pin: string; result: PinResult };

/** Pure (unit-tested): turn per-service statuses into the one message the customer sees when nothing came back. */
export function emptyRouteMessage(statuses: Array<Pick<ServiceStatus, "status" | "category" | "message">>, origin: string, dest: string): { kind: "pickup" | "delivery" | "route" | "retry" | "none"; message: string } {
  if (!statuses.length) return { kind: "none", message: MSG.routeNoService };
  const answered = statuses.filter((s) => s.status === "no_service");
  const failed = statuses.filter((s) => s.status === "failed");
  if (!answered.length && failed.length) return { kind: "retry", message: MSG.retry };
  const mentions = (s: { message?: string }, p: string) => (s.message ?? "").includes(p);
  const about = answered.filter((s) => s.category === "not_serviceable");
  if (about.length && about.length === answered.length && !failed.length) {
    if (about.every((s) => mentions(s, origin) && !mentions(s, dest))) return { kind: "pickup", message: MSG.pickupNotServiceable };
    if (about.every((s) => mentions(s, dest) && !mentions(s, origin))) return { kind: "delivery", message: MSG.deliveryNotServiceable };
  }
  return failed.length ? { kind: "retry", message: `${MSG.routeNoService} Some services could not be reached — please try again.` } : { kind: "route", message: MSG.routeNoService };
}

export async function publicRates(v: PublicRatesInput) {
  const [o, d] = await Promise.all([lookupPincode(v.originPincode), lookupPincode(v.destinationPincode)]);
  const pins: { origin: Pin; dest: Pin } = { origin: { pin: v.originPincode, result: o }, dest: { pin: v.destinationPincode, result: d } };
  const fieldErrors: Record<string, string> = {};
  if (o.status === "not_found") fieldErrors.origin = MSG.pinUnknown;
  if (d.status === "not_found") fieldErrors.dest = MSG.pinUnknown;
  if (Object.keys(fieldErrors).length) return { ok: false as const, fieldErrors, pins };

  // FOD is B2B only; every other payment mode is checked on both service types.
  const modes: Array<"B2C" | "B2B"> = v.paymentType === "fod" ? ["B2B"] : ["B2C", "B2B"];
  const runs = await Promise.all(modes.map((mode) => getQuotes(toQuoteRequest({ ...v, mode }), null)));

  const db = await getDb();
  const accounts = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.category, "shipping"));
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const offers = runs.flatMap((r) => r.offers).sort((a, b) => a.total - b.total).map((o: QuoteOffer) => {
    const a = o.providerAccountId ? byId.get(o.providerAccountId) : undefined;
    const ad = a ? adapterOf(a) : "unknown";
    return { ...presentOffer(o), source: { key: serviceKey(ad, o.mode), name: sourceName(ad, o.mode, (a?.configPublic as Record<string, unknown>) ?? null) } };
  });
  const statuses = runs.flatMap((r) => r.statuses);

  // One row per expected service (+ any other active service), from what ran and what is configured.
  const services: PublicServiceState[] = [];
  const seen = new Set<string>();
  for (const st of statuses) {
    const a = byId.get(st.accountId);
    const ad = a ? adapterOf(a) : st.adapter;
    const key = serviceKey(ad, st.mode);
    const prev = services.find((x) => x.key === key);
    const state: PublicServiceState["state"] = st.status === "ok" ? "available" : st.status === "skipped" ? "not_offered" : st.status;
    if (prev) { // two accounts on one service: the better outcome wins
      const rank = ["available", "no_service", "failed", "not_offered"];
      prev.count += st.count;
      if (rank.indexOf(state) < rank.indexOf(prev.state)) { prev.state = state; prev.note = st.message; }
      continue;
    }
    seen.add(key);
    services.push({ key, mode: st.mode, name: sourceName(ad, st.mode, (a?.configPublic as Record<string, unknown>) ?? null).replace(/ · .*$/, ""), state, note: state === "available" ? undefined : st.message, count: st.count });
  }
  for (const e of EXPECTED_SERVICES) {
    if (seen.has(e.key)) continue;
    const rows = accounts.filter((a) => adapterOf(a) === e.adapter && a.status !== "archived" && accountServes(a, e.mode));
    const connected = rows.some((a) => !!adapterFor(a));
    const live = rows.some((a) => a.status === "enabled" && canTakeBookings(a));
    const notOffered = v.paymentType === "fod" && e.mode === "B2C";
    services.push({
      key: e.key, name: e.name, mode: e.mode, count: 0,
      state: notOffered ? "not_offered" : !connected ? "not_connected" : live ? "no_service" : "inactive",
      note: notOffered ? "FOD is only for B2B shipments" : !connected ? "Not connected yet" : live ? undefined : "Not switched on yet",
    });
  }
  services.sort((a, b) => EXPECTED_SERVICES.findIndex((e) => e.key === a.key) - EXPECTED_SERVICES.findIndex((e) => e.key === b.key));

  const empty = offers.length ? null : emptyRouteMessage(statuses, v.originPincode, v.destinationPincode);
  return { ok: true as const, offers, services, pins, empty, chargeableKg: chargeableKg(v.packages) };
}

export const pinView = (p: PinResult) => p.status === "found" ? { city: p.city, state: p.state, locality: p.locality ?? null } : null;
