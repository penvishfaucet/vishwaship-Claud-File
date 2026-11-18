import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import type { Permission } from "@/server/auth/rbac";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { setMarkup } from "@/server/pricing/rules";
import { getAdapter, providerContext } from "@/server/providers/registry";
import { encryptJson, maskSecret } from "@/server/security/crypto";
import { DELHIVERY_HOSTS as HOSTS, ensureDelhiveryAccount } from "@/server/carriers/delhivery";

const svc = z.enum(["b2b", "b2c"]);
const bool = z.union([z.boolean(), z.literal("on"), z.literal("")]).transform((v) => v === true || v === "on");
const money = z.coerce.number().min(0).max(1_00_000);

const Ops = z.discriminatedUnion("op", [
  z.object({ op: z.literal("credentials"), service: svc, mode: z.enum(["test", "live"]), username: z.string().trim().max(120).default(""), password: z.string().max(200).default(""), apiToken: z.string().trim().max(200).default("") }),
  z.object({ op: z.literal("test"), service: svc }),
  z.object({ op: z.literal("clear"), service: svc }),
  z.object({ op: z.literal("status"), service: svc, status: z.enum(["enabled", "disabled"]) }),
  z.object({ op: z.literal("payments"), service: svc, prepaid: bool, cod: bool, fod: bool, fodStatus: z.enum(["pending_activation", "active"]).default("pending_activation"), fodBasis: z.enum(["carrier_freight", "vishwaship_rate"]).default("carrier_freight") }),
  z.object({ op: z.literal("rates"), service: svc, rateSource: z.enum(["api", "rate_card"]), shippingMode: z.enum(["S", "E"]).default("S"), volDivisor: z.coerce.number().int().min(1000).max(10000).default(5000), rovInsurance: bool,
    perKg: money.default(0), minKg: money.default(20), docket: money.default(0), fuelPct: money.default(0), codFee: money.default(0), codPct: money.default(0), fodFee: money.default(0), first500: money.default(0), addl500: money.default(0),
    pickupStartTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).default("11:00:00") }),
  z.object({ op: z.literal("billing"), service: z.literal("b2b"), name: z.string().trim().min(2).max(80), company: z.string().trim().min(2).max(120), address: z.string().trim().min(5).max(300), city: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60), pin: z.string().regex(/^[1-9]\d{5}$/), phone: z.string().regex(/^[6-9]\d{9}$/), gst_number: z.string().trim().max(15).default(""), pan_number: z.string().trim().max(10).default("") }),
  z.object({ op: z.literal("markup"), service: svc, pct: z.coerce.number().min(0).max(500) }),
  z.object({ op: z.literal("fod_status"), service: svc, shipmentId: z.string().min(3), status: z.enum(["pending_collection", "collected", "settled", "disputed"]), note: z.string().trim().max(200).default("") }),
]);
const PERM: Record<string, Permission> = { clear: "integrations.write", credentials: "integrations.write", test: "integrations.write", status: "integrations.write", payments: "integrations.write", rates: "pricing.write", billing: "integrations.write", markup: "pricing.write", fod_status: "finance.adjust" };

/** Admin → Carrier Integrations → Delhivery (B2B and B2C configured independently). */
export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return apiError(400, "validation_error", "Body must be JSON"); }
  const p = Ops.safeParse(raw);
  if (!p.success) return apiError(422, "validation_error", p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = p.data;
  const s = await apiStaff(PERM[b.op]);
  if (!s) return apiError(403, "forbidden", "You do not have permission for this action");
  const db = await getDb();
  const acct = await ensureDelhiveryAccount(b.service);
  const cfg = (acct.configPublic ?? {}) as Record<string, unknown>;
  const saveCfg = (patch: Record<string, unknown>) => db.update(schema.providerAccounts).set({ configPublic: { ...cfg, allowedHosts: HOSTS[b.service], ...patch } }).where(eq(schema.providerAccounts.id, acct.id));
  const done = async (message: string, details: Record<string, unknown> = {}) => {
    await audit({ actorUserId: s.userId, actorKind: "staff", action: `delhivery.${b.service}.${b.op}`, targetType: "provider_account", targetId: acct.id, details });
    return NextResponse.json({ ok: true, message });
  };

  switch (b.op) {
    case "credentials": {
      const secrets = b.service === "b2b" ? { username: b.username, password: b.password } : { apiToken: b.apiToken };
      if (Object.values(secrets).some((v) => !v)) return apiError(422, "validation_error", b.service === "b2b" ? "Enter the Delhivery B2B username and password" : "Enter the Delhivery B2C API token");
      await db.update(schema.providerAccounts).set({ secretsEnc: encryptJson(secrets), secretsHint: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, k === "username" ? v.replace(/^(.{2}).*(.{2})$/, "$1•••$2") : maskSecret(v)])), mode: b.mode, lastTestOk: null, lastTestMessage: null }).where(eq(schema.providerAccounts.id, acct.id));
      await saveCfg({});
      return done("Credentials saved (encrypted). Run Test connection next.", { mode: b.mode, fields: Object.keys(secrets) });
    }
    case "clear":
      await db.update(schema.providerAccounts).set({ secretsEnc: null, secretsHint: null, status: "disabled", lastTestOk: null, lastTestMessage: null, lastTestAt: null }).where(eq(schema.providerAccounts.id, acct.id));
      return done("Credentials removed and service disabled");
    case "test": {
      const ad = getAdapter(acct.adapter)!;
      const [fresh] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, acct.id));
      const r = await ad.health(await providerContext(fresh));
      const msg = r.ok ? r.value.message : r.error.message;
      await db.update(schema.providerAccounts).set({ lastTestAt: new Date(), lastTestOk: r.ok, lastTestMessage: msg.slice(0, 200) }).where(eq(schema.providerAccounts.id, acct.id));
      await audit({ actorUserId: s.userId, actorKind: "staff", action: `delhivery.${b.service}.test`, targetType: "provider_account", targetId: acct.id, details: { ok: r.ok } });
      return r.ok ? NextResponse.json({ ok: true, message: msg }) : apiError(502, "provider_error", msg);
    }
    case "status":
      if (b.status === "enabled" && (!acct.secretsEnc || !acct.lastTestOk)) return apiError(409, "conflict", "Save credentials and pass Test connection before enabling");
      await db.update(schema.providerAccounts).set({ status: b.status }).where(eq(schema.providerAccounts.id, acct.id));
      return done(b.status === "enabled" ? "Service enabled — customers can now see Delhivery rates" : "Service disabled", { status: b.status });
    case "payments": {
      if (b.service === "b2c" && b.fod) return apiError(422, "validation_error", "FOD is not a documented Delhivery B2C payment mode");
      const payments = { prepaid: b.prepaid, cod: b.cod, fod: b.service === "b2b" ? b.fod : false, fodStatus: b.service === "b2b" ? b.fodStatus : "not_supported", fodBasis: b.fodBasis };
      await saveCfg({ payments });
      return done("Payment modes saved", payments);
    }
    case "rates": {
      const rateCard = b.service === "b2b"
        ? { perKgPaise: Math.round(b.perKg * 100), minKg: b.minKg, docketPaise: Math.round(b.docket * 100), fuelPct: b.fuelPct, codFeePaise: Math.round(b.codFee * 100), codPct: b.codPct, fodFeePaise: Math.round(b.fodFee * 100) }
        : { first500Paise: Math.round(b.first500 * 100), addl500Paise: Math.round(b.addl500 * 100), codFeePaise: Math.round(b.codFee * 100), codPct: b.codPct };
      if (b.rateSource === "rate_card" && !(b.service === "b2b" ? rateCard.perKgPaise : (rateCard as { first500Paise: number }).first500Paise)) return apiError(422, "validation_error", "Enter the contract rate card before selecting it as the rate source");
      await saveCfg({ rateSource: b.rateSource, rateCard, shippingMode: b.shippingMode, volDivisor: b.volDivisor, rovInsurance: b.rovInsurance, pickupStartTime: b.pickupStartTime.length === 5 ? `${b.pickupStartTime}:00` : b.pickupStartTime });
      return done("Rate settings saved", { rateSource: b.rateSource });
    }
    case "billing": {
      const { op: _o, service: _s, ...addr } = b; void _o; void _s;
      if (!addr.gst_number && !addr.pan_number) return apiError(422, "validation_error", "Enter a GST number or PAN (Delhivery requires one)");
      addr.gst_number = addr.gst_number.toUpperCase(); addr.pan_number = addr.pan_number.toUpperCase();
      // Delhivery validates pan_number as AAAAA9999A; a GSTIN carries the PAN in characters 3–12.
      if (!addr.pan_number && /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(addr.gst_number)) addr.pan_number = addr.gst_number.slice(2, 12);
      if (addr.pan_number && !/^[A-Z]{5}\d{4}[A-Z]$/.test(addr.pan_number)) return apiError(422, "validation_error", "PAN must look like ABCDE1234F");
      await saveCfg({ billingAddress: { ...addr, consignor: addr.company } });
      return done("Billing address saved — sent with every B2B manifest");
    }
    case "fod_status": {
      const u = await db.update(schema.shipments).set({ fodStatus: b.status }).where(and(eq(schema.shipments.id, b.shipmentId), eq(schema.shipments.providerAccountId, acct.id), eq(schema.shipments.freightPayer, "receiver"))).returning({ id: schema.shipments.id, orgId: schema.shipments.orgId });
      if (!u.length) return apiError(404, "not_found", "FOD shipment not found for this service");
      await audit({ actorUserId: s.userId, actorKind: "staff", orgId: u[0].orgId, action: "fod.status", targetType: "shipment", targetId: b.shipmentId, details: { status: b.status, note: b.note } });
      return done(`FOD marked ${b.status.replace("_", " ")}`);
    }
    case "markup": {
      const bps = Math.round(b.pct * 100);
      const r = await setMarkup(acct.adapter, null, bps, s.userId);
      return done(`${b.service === "b2b" ? "B2B Freight Markup" : "B2C markup"} set to ${b.pct}% (version ${r.version}) — applies to new quotes now; booked shipments keep their confirmed price`, { bps });
    }
  }
}
