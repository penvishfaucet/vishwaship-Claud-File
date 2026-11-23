import "server-only";
import type { ProviderQuote, ProviderQuoteComponent } from "@/server/pricing/engine";
import {
  type BookResult, type LabelFormat, type NormalizedStatus, type PodResult, type ProviderContext, type Result, type ShippingAdapter, type WarehouseInput, unsupported,
} from "./types";
import { labelStrings } from "@/server/labels/strings";
import { collectsCod } from "@/lib/payment";
import { pickupAgent, amountToPaise, b2bCharges, documentLinks, documentMeta, documentReply, firstString, jsonOrNull, providerError, rupees } from "./delhivery-common";

/**
 * Delhivery Direct B2B (LTL). Endpoints from the Delhivery developer portal (docs/DELHIVERY-API-NOTES.md).
 * Secrets: username, password (Delhivery ONE B2B API user). Config: billingAddress, rovInsurance, volDivisor, rateSource, rateCard.
 * Auth: POST /ums/login → JWT (24 h), cached per account; one re-login on 401.
 */
const base = (ctx: ProviderContext) => (ctx.mode === "live" ? "https://ltl-clients-api.delhivery.com" : "https://ltl-clients-api-dev.delhivery.com");
const tokens = new Map<string, { token: string; exp: number }>();

async function login(ctx: ProviderContext): Promise<Result<string>> {
  const hit = tokens.get(ctx.accountId);
  if (hit && hit.exp > Date.now()) return { ok: true, value: hit.token };
  if (!ctx.secrets.username || !ctx.secrets.password) return { ok: false, error: { category: "auth", message: "Delhivery B2B username / password not configured", retryable: false } };
  let r: Response;
  try {
    r = await ctx.fetch(`${base(ctx)}/ums/login`, { method: "POST", timeoutMs: 15_000, headers: { "content-type": "application/json" }, body: JSON.stringify({ username: ctx.secrets.username, password: ctx.secrets.password }) });
  } catch (e) { return { ok: false, error: { category: "timeout", message: `Delhivery login unreachable: ${(e as Error).message}`, retryable: true } }; }
  const j = await jsonOrNull(r);
  if (!r.ok) return { ok: false, error: { category: "auth", message: `Delhivery B2B login failed (HTTP ${r.status})${r.status === 400 || r.status === 401 || r.status === 403 ? " — Delhivery rejected the username/password (the user locks for 10 minutes after wrong attempts)" : ""}`, retryable: false } };
  const token = firstString(j, ["jwt", "token", "access_token", "data.jwt", "data.token", "data.access_token"]);
  if (!token) return { ok: false, error: { category: "upstream", message: "Delhivery login returned no token", retryable: true } };
  tokens.set(ctx.accountId, { token, exp: Date.now() + 23 * 3600_000 });
  return { ok: true, value: token };
}

async function call(ctx: ProviderContext, path: string, init: RequestInit & { timeoutMs?: number } = {}, retried = false): Promise<Result<{ status: number; json: unknown }>> {
  const t = await login(ctx);
  if (!t.ok) return t;
  let r: Response;
  try {
    r = await ctx.fetch(`${base(ctx)}${path}`, { timeoutMs: 20_000, ...init, headers: { authorization: `Bearer ${t.value}`, ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) } });
  } catch (e) { return { ok: false, error: { category: "timeout", message: `Delhivery B2B timed out: ${(e as Error).message}`, retryable: true } }; }
  if (r.status === 401 && !retried) { tokens.delete(ctx.accountId); return call(ctx, path, init, true); }
  const json = await jsonOrNull(r);
  if (r.status === 429) return { ok: false, error: { category: "rate_limited", message: "Delhivery rate limit reached — try again shortly", retryable: true } };
  if (r.status >= 500) return { ok: false, error: { category: "upstream", message: `Delhivery B2B error HTTP ${r.status}`, retryable: true } };
  if (!r.ok) return { ok: false, error: { category: r.status === 404 ? "not_found" : "validation", message: providerError(json, `Delhivery B2B rejected the request (HTTP ${r.status})`), retryable: false } };
  return { ok: true, value: { status: r.status, json } };
}

/**
 * freight_mode is a retail (B2BR) field: a regular B2B client gets "Freight mode FoP not allowed for B2B" (seen on the live
 * account 2026-11-18). Send it only for FOD, or "fop" when Admin marks the account as retail (config.retailClient).
 */
/** Billing address for FOD / retail manifests: empty fields are left out (Delhivery regex-checks e.g. pan_number); PAN comes from the GSTIN when missing. */
function billingFor(ctx: ProviderContext): Record<string, string> | null {
  const b = ctx.config.billingAddress as Record<string, string> | undefined;
  if (!b) return null;
  const out = Object.fromEntries(Object.entries(b).filter(([, v]) => typeof v === "string" && v.trim()));
  if (!out.pan_number && /^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(out.gst_number ?? "")) out.pan_number = out.gst_number.slice(2, 12);
  return out;
}

function freightMode(ctx: ProviderContext, pay: string): { freight_mode?: string } {
  if (pay === "fod") return { freight_mode: "fod" };
  return ctx.config.retailClient ? { freight_mode: "fop" } : {};
}

const STATUS: Record<string, NormalizedStatus> = {
  MANIFESTED: "booked", NOT_PICKED: "pickup_pending", PICKED_UP: "picked_up", LEFT_ORIGIN: "in_transit", REACH_DESTINATION: "at_delivery_center",
  UNDEL_REATTEMPT: "ndr", PART_DEL: "delivered", OFD: "out_for_delivery", DELIVERED: "delivered", RETURNED_INTRANSIT: "rto_in_transit",
  RECEIVED_AT_RETURN_CENTER: "rto_in_transit", RETURN_OFD: "rto_in_transit", RETURN_DELIVERED: "rto_delivered", LOST: "lost", CANCELLED: "cancelled",
  // words seen in LTL scan lists / the tracking page
  OPEN: "pickup_pending", SCHEDULED: "pickup_pending", PENDING: "pickup_pending", PICKUP_SCHEDULED: "pickup_pending", NOT_PICKED_UP: "pickup_pending",
  IN_TRANSIT: "in_transit", INTRANSIT: "in_transit", DISPATCHED: "out_for_delivery", OUT_FOR_DELIVERY: "out_for_delivery",
  REACHED_DESTINATION: "at_delivery_center", AT_DESTINATION: "at_delivery_center", UNDELIVERED: "ndr", RTO: "rto_in_transit", RETURNED: "rto_in_transit",
};
export const mapB2bStatus = (s: string): NormalizedStatus => STATUS[s.trim().toUpperCase().replace(/[\s-]+/g, "_")] ?? "in_transit";

/**
 * Delhivery B2B (LTL) /lrn/track answer → events + ETA. The response body is not published, so it is read defensively:
 * the latest status at the top, plus any list of scans found anywhere in the body (status, time, location, remark),
 * and an expected / promised delivery date if one is present. Times without a zone are IST.
 */
export function parseB2bTrack(json: unknown, awb: string): { status: NormalizedStatus; events: import("./types").TrackingEvent[]; etaDate?: string; raw: string } | null {
  const T_KEYS = ["scan_timestamp", "scan_time", "scan_date_time", "scan_datetime", "status_time", "status_date_time", "timestamp", "date_time", "datetime", "updated_at", "created_at", "date"];
  const S_KEYS = ["status", "scan_status", "scan", "status_type", "current_status", "activity", "event"];
  const L_KEYS = ["location", "scan_location", "current_location", "location_name", "hub", "hub_name", "facility", "city", "center", "centre"];
  const R_KEYS = ["remarks", "remark", "instructions", "status_description", "description", "reason", "message"];
  const iso = (t: string | null) => {
    if (!t) return null;
    const v = /^\d{10,13}$/.test(t) ? new Date(Number(t) * (t.length === 10 ? 1000 : 1)) : new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) || !/\d{2}:\d{2}/.test(t) ? t : `${t.replace(" ", "T")}+05:30`);
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  };
  const text = (o: Record<string, unknown>, keys: string[]): string | null => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
      if (v && typeof v === "object" && !Array.isArray(v)) { const n = text(v as Record<string, unknown>, ["name", "city", "location", "value"]); if (n) return n; }
    }
    return null;
  };
  const events: import("./types").TrackingEvent[] = [];
  // every array of scan-like objects (has a status and a time), at any depth
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object" || depth > 6) return;
    if (Array.isArray(v)) {
      for (const x of v) {
        if (x && typeof x === "object" && !Array.isArray(x)) {
          const o = x as Record<string, unknown>;
          const raw = text(o, S_KEYS), at = iso(text(o, T_KEYS));
          if (raw && at && raw.length <= 120) events.push({ status: mapB2bStatus(raw), rawStatus: raw.slice(0, 200), location: text(o, L_KEYS)?.slice(0, 200) ?? undefined, occurredAt: at, remark: text(o, R_KEYS)?.slice(0, 300) ?? undefined });
        }
        walk(x, depth + 1);
      }
      return;
    }
    for (const x of Object.values(v as Record<string, unknown>)) if (x && typeof x === "object") walk(x, depth + 1);
  };
  walk(json, 0);
  // the latest status (top level / data / data[0])
  const tops = [json, (json as Record<string, unknown> | null)?.data, ((json as Record<string, unknown> | null)?.data as unknown[] | undefined)?.[0]].filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  let raw = "", at: string | null = null, loc: string | null = null, remark: string | null = null, eta: string | null = null;
  for (const o of tops) {
    raw ||= text(o, ["status", "current_status", "lrn_status", "shipment_status"]) ?? "";
    at ||= iso(text(o, ["status_time", "status_date_time", "timestamp", "updated_at", "last_update", "last_updated"]));
    loc ||= text(o, ["location", "current_location", "scan_location", "last_location", "hub_name"]);
    remark ||= text(o, ["remarks", "remark", "status_description", "instructions"]);
    eta ||= iso(text(o, ["edd", "expected_delivery_date", "promised_delivery_date", "estimated_delivery_date", "expected_date", "eta", "promise_date", "pdd"]));
  }
  if (!raw && !events.length) return null;
  const sorted = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const last = sorted.at(-1);
  if (raw) {
    // the headline status, unless the newest scan already says the same; without a time it is "now" (the poll dedupes repeats)
    const when = at ?? (last && last.rawStatus.toUpperCase() === raw.toUpperCase() ? last.occurredAt : new Date().toISOString());
    if (!events.some((e) => e.rawStatus.toUpperCase() === raw.toUpperCase() && e.occurredAt === when)) events.push({ status: mapB2bStatus(raw), rawStatus: raw.slice(0, 200), location: loc?.slice(0, 200) ?? last?.location, occurredAt: when, remark: remark?.slice(0, 300) ?? undefined });
  }
  const status = raw ? mapB2bStatus(raw) : last!.status;
  return { status, events, etaDate: eta ?? undefined, raw: raw || last!.rawStatus };
}

const LABEL_SIZE: Partial<Record<LabelFormat, string>> = { a4: "a4", thermal_4x4: "md", thermal_3x4: "std", thermal_2x4: "sm" };

export const delhiveryB2bAdapter: ShippingAdapter = {
  key: "delhivery_b2b",
  displayName: "Delhivery Direct B2B",
  implemented: ["authenticate", "health", "warehouse_sync", "serviceability", "quote", "book", "booking_lookup", "label", "pickup", "track", "cancel", "reconciliation", "pod"],
  paymentModes: ["prepaid", "cod", "fod"],
  pickupScope: "warehouse",

  async health(ctx) {
    const r = await call(ctx, "/pincode-service/110001?weight=1000");
    return r.ok ? { ok: true, value: { message: `Connected to Delhivery B2B (${ctx.mode === "live" ? "production" : "test"}) — login and serviceability OK` } } : r;
  },

  async quote(ctx, req) {
    if (req.mode !== "B2B" || req.direction === "reverse") return { ok: true, value: [] };
    const totalG = req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
    const svc = await call(ctx, `/pincode-service/${req.destinationPincode}?weight=${totalG}`);
    if (!svc.ok) return svc;
    const sj = svc.value.json as Record<string, unknown> | null;
    const explicit = (sj?.serviceable ?? (sj?.data as Record<string, unknown> | undefined)?.serviceable) as boolean | undefined;
    if (explicit === false) return { ok: false, error: { category: "not_serviceable", message: `Delhivery B2B does not deliver to ${req.destinationPincode}`, retryable: false } };
    if (nszFlag(sj)) return { ok: false, error: { category: "not_serviceable", message: `Delhivery B2B does not deliver to ${req.destinationPincode} (non-serviceable zone)`, retryable: false } };
    if (req.paymentType === "fod" && fodFlag(sj) === false) return { ok: false, error: { category: "not_serviceable", message: `Delhivery B2B does not offer FOD (freight on delivery) to ${req.destinationPincode}`, retryable: false } };
    const oda = odaFlag(sj);
    let pending: string | undefined;

    const divisor = Number(ctx.config.volDivisor ?? 3375); // Delhivery B2B (LTL): 8 kg per CFT = L×B×H cm ÷ 3375 (matches its re-weigh charges)
    const volG = req.packages.reduce((t, p) => t + Math.ceil(((p.lengthMm / 10) * (p.breadthMm / 10) * (p.heightMm / 10) * 1000) / divisor) * p.count, 0);
    let components: ProviderQuoteComponent[]; let chargeable = Math.max(totalG, volG); let source: string;

    if (ctx.config.rateSource === "rate_card") {
      const rc = (ctx.config.rateCard ?? {}) as { perKgPaise?: number; minKg?: number; docketPaise?: number; fuelPct?: number; codFeePaise?: number; codPct?: number; fodFeePaise?: number; odaPerKgPaise?: number; odaMinPaise?: number };
      if (!rc.perKgPaise) return { ok: false, error: { category: "unsupported", message: "Delhivery B2B contract rate card is not configured", retryable: false } };
      const kg = Math.max(rc.minKg ?? 20, Math.ceil(chargeable / 1000)); chargeable = kg * 1000;
      const freight = kg * rc.perKgPaise;
      components = [{ code: "freight", label: "Base freight", amount: freight }];
      if (rc.fuelPct) components.push({ code: "fuel", label: "Fuel surcharge", amount: Math.round((freight * rc.fuelPct) / 100) });
      if (rc.docketPaise) components.push({ code: "docket", label: "Docket charge", amount: rc.docketPaise });
      if (collectsCod(req.paymentType, req.codAmount)) components.push({ code: "cod_fee", label: "COD charge", amount: Math.max(rc.codFeePaise ?? 0, Math.round(((req.codAmount ?? 0) * (rc.codPct ?? 0)) / 100)) });
      if (req.paymentType === "fod" && rc.fodFeePaise) components.push({ code: "other", label: "FOD charge", amount: rc.fodFeePaise });
      if (oda) {
        if (rc.odaPerKgPaise || rc.odaMinPaise) components.push({ code: "oda", label: "ODA charge", amount: Math.max(rc.odaMinPaise ?? 0, kg * (rc.odaPerKgPaise ?? 0)) });
        else pending = "ODA destination: the ODA charge is not in the contract rate card yet";
      }
      source = "contract_rate_card";
    } else {
      const est = await call(ctx, "/freight/estimate", { method: "POST", body: JSON.stringify(estimateBody(ctx, req)) });
      if (!est.ok) return est;
      const parsed = b2bCharges(est.value.json);
      if (!parsed) return { ok: false, error: { category: "upstream", message: "Delhivery returned no freight breakup for this route — rate unavailable (not ₹0). Retry, or configure a contract rate card.", retryable: true } };
      components = parsed.components;
      if (parsed.chargeableGrams) chargeable = parsed.chargeableGrams;
      // ODA destination but the estimate carries no ODA line: the amount is unconfirmed, so this rate must not be booked.
      if (oda && !components.some((c) => c.code === "oda")) pending = "ODA destination: Delhivery has not confirmed the ODA charge for this route";
      source = "freight_estimate_api";
    }
    if (!components.some((c) => c.code === "freight" && c.amount > 0)) return { ok: false, error: { category: "upstream", message: "Delhivery base freight unavailable for this route", retryable: true } };

    let etaDays: number | undefined;
    const tat = await call(ctx, `/tat/estimate?origin_pin=${req.originPincode}&destination_pin=${req.destinationPincode}`, { timeoutMs: 8_000 });
    if (tat.ok) { const d = Number(firstString(tat.value.json, ["tat", "data.tat", "data.expected_tat", "expected_tat", "data"])); if (d > 0 && d < 60) etaDays = Math.round(d); }

    const q: ProviderQuote = {
      provider: "delhivery_b2b", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "Delhivery B2B Surface (LTL)", mode: "B2B", etaDays,
      components, taxInclusive: false, taxRateBps: 1800, chargeableWeightGrams: chargeable, providerQuoteRef: `${source}:${req.paymentType}`, ...(pending ? { pending } : {}),
    };
    return { ok: true, value: [q] };
  },

  async registerWarehouse(ctx, w: WarehouseInput) {
    const name = `VS-${w.code}`.slice(0, 50);
    const r = await call(ctx, "/client-warehouse/create/", {
      method: "POST",
      body: JSON.stringify({ name, pin_code: w.pincode, city: w.city, state: w.state, country: "India", same_as_fwd_add: true,
        address_details: { address: [w.line1, w.line2].filter(Boolean).join(", "), contact_person: w.contactName, phone_number: w.mobile } }),
    });
    if (!r.ok && !/already|exist/i.test(r.error.message)) return r;
    return { ok: true, value: { ref: name } };
  },

  async book(ctx, req) {
    if (!req.pickup.providerWarehouseRef) return { ok: false, error: { category: "validation", message: "Pickup warehouse is not registered with Delhivery B2B", retryable: false } };
    const totalG = req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
    const fd = new FormData();
    fd.set("lrn", "");
    fd.set("pickup_location_name", req.pickup.providerWarehouseRef);
    fd.set("payment_mode", collectsCod(req.paymentType, req.codAmount) ? "cod" : "prepaid");
    if (collectsCod(req.paymentType, req.codAmount)) fd.set("cod_amount", String(rupees(req.codAmount)));
    fd.set("weight", String(totalG));
    fd.set("dropoff_location", JSON.stringify({ consignee_name: req.consignee.name, address: [req.consignee.line1, req.consignee.line2].filter(Boolean).join(", "), city: req.consignee.city, state: req.consignee.state, zip: req.consignee.pincode, phone: req.consignee.mobile, email: req.consignee.email ?? "" }));
    const shipments = req.packages.map((p, i) => ({ order_id: `${req.vishwashipOrderId.replace(/[^A-Za-z0-9]/g, "")}${i + 1}`, box_count: p.count, description: req.products.map((x) => x.name).join(", ").replace(/[^A-Za-z0-9 ,]/g, " ").slice(0, 100) || "Goods", weight: p.actualWeightGrams * p.count }));
    // No JSON booleans or empty lists in shipment_details: the form parser rejected the field as "not a valid list" with them; dimensions (numbers only) parsed fine. Delhivery assigns waybills itself.
    fd.set("shipment_details", JSON.stringify(shipments));
    // Live B2B validation (2026-11-18): dimensions need length / width / height (cm) per box group.
    fd.set("dimensions", JSON.stringify(req.packages.map((p) => ({ box_count: p.count, length: p.lengthMm / 10, width: p.breadthMm / 10, height: p.heightMm / 10 }))));
    fd.set("invoices", JSON.stringify([{ ewaybill: req.ewayBill ?? "", inv_num: req.invoiceNumber ?? req.orderNumber, inv_amt: rupees(req.declaredValue), inv_qr_code: "" }]));
    fd.set("rov_insurance", ctx.config.rovInsurance ? "True" : "False");
    const fm = freightMode(ctx, req.paymentType).freight_mode;
    if (fm) fd.set("freight_mode", fm);
    fd.set("fm_pickup", "True");
    const billing = billingFor(ctx);
    if (billing) fd.set("billing_address", JSON.stringify(billing));
    let r = await call(ctx, "/manifest", { method: "POST", body: fd, timeoutMs: 30_000 });
    // "shipment_details: value is not a valid list" (live): send each shipment as its own form value instead.
    // A validation failure creates nothing at Delhivery, so this second attempt cannot duplicate a manifest.
    if (!r.ok && /shipment_details.{0,40}not a valid list/i.test(r.error.message)) {
      fd.delete("shipment_details");
      for (const sd of shipments) fd.append("shipment_details", JSON.stringify(sd));
      r = await call(ctx, "/manifest", { method: "POST", body: fd, timeoutMs: 30_000 });
    }
    // Still rejected: send the whole manifest as JSON, where shipment_details / dimensions are real lists.
    if (!r.ok && /shipment_details.{0,40}not a valid list/i.test(r.error.message)) {
      const json: Record<string, unknown> = {
        lrn: "", pickup_location_name: req.pickup.providerWarehouseRef, payment_mode: collectsCod(req.paymentType, req.codAmount) ? "cod" : "prepaid",
        ...(collectsCod(req.paymentType, req.codAmount) ? { cod_amount: rupees(req.codAmount) } : {}), weight: totalG,
        dropoff_location: { consignee_name: req.consignee.name, address: [req.consignee.line1, req.consignee.line2].filter(Boolean).join(", "), city: req.consignee.city, state: req.consignee.state, zip: req.consignee.pincode, phone: req.consignee.mobile, email: req.consignee.email ?? "" },
        shipment_details: shipments,
        dimensions: req.packages.map((p) => ({ box_count: p.count, length: p.lengthMm / 10, width: p.breadthMm / 10, height: p.heightMm / 10 })),
        invoices: [{ ewaybill: req.ewayBill ?? "", inv_num: req.invoiceNumber ?? req.orderNumber, inv_amt: rupees(req.declaredValue), inv_qr_code: "" }],
        rov_insurance: !!ctx.config.rovInsurance, fm_pickup: true, ...(fm ? { freight_mode: fm } : {}),
        ...(billing ? { billing_address: billing } : {}),
      };
      const rj = await call(ctx, "/manifest", { method: "POST", body: JSON.stringify(json), timeoutMs: 30_000 });
      if (rj.ok || !/field required|value is not a valid/i.test(rj.error.message) || !/shipment_details/i.test(rj.error.message)) r = rj;
      if (!rj.ok) r = { ...rj, error: { ...rj.error, message: `${rj.error.message} [form-data: ${r.ok ? "ok" : r.error.message.slice(0, 120)}]`.slice(0, 400) } };
    }
    if (!r.ok) return r.error.category === "timeout" ? { ok: false, error: { ...r.error, category: "ambiguous" } } : r;
    const jobId = firstString(r.value.json, ["job_id", "data.job_id", "request_id", "data.request_id", "jobId"]);
    if (!jobId) return { ok: false, error: { category: "ambiguous", message: "Delhivery accepted the manifest but returned no job ID", retryable: false } };
    const res: BookResult = { providerOrderRef: `job:${jobId}`, awb: null, lrNumber: null, state: "pending_async", labelAvailable: false };
    return { ok: true, value: res };
  },

  async lookupBooking(ctx, ref) {
    if (!ref.providerOrderRef) return { ok: false, error: { category: "ambiguous", message: "No Delhivery job ID stored — manual check in Delhivery ONE needed", retryable: true } };
    const isJob = ref.providerOrderRef.startsWith("job:");
    const jobId = isJob ? ref.providerOrderRef.slice(4) : ref.providerOrderRef;
    const r = await call(ctx, `/manifest?job_id=${encodeURIComponent(jobId)}`);
    // Older rows stored the bare job id; a bare number Delhivery does not know as a job is an LR saved after reconcile.
    if (!r.ok) return !isJob && /^\d{6,}$/.test(jobId) ? { ok: true, value: { providerOrderRef: jobId, awb: jobId, lrNumber: jobId, state: "confirmed", labelAvailable: true } } : r;
    const j = r.value.json;
    const status = (firstString(j, ["status", "data.status", "job_status", "data.job_status"]) ?? "").toLowerCase();
    const lrn = firstString(j, ["lrn", "data.lrn", "lr_number", "data.lr_number", "data.lrnum", "lrnum"]);
    if (lrn) {
      const wbns = ((j as { data?: { waybills?: unknown } })?.data?.waybills ?? (j as { waybills?: unknown })?.waybills) as unknown;
      return { ok: true, value: { providerOrderRef: lrn, awb: lrn, lrNumber: lrn, pieceIds: Array.isArray(wbns) ? wbns.map(String) : undefined, state: "confirmed", labelAvailable: true } };
    }
    if (/fail|error|reject/.test(status)) return { ok: true, value: null };
    return { ok: true, value: { providerOrderRef: ref.providerOrderRef, awb: null, state: "pending_async", labelAvailable: false } };
  },

  async label(ctx, ref, format) {
    const formatsAvailable = Object.keys(LABEL_SIZE) as LabelFormat[];
    const size = LABEL_SIZE[format];
    if (!size) return { ok: true, value: { formatsAvailable } };
    // Raw request: Delhivery may answer with the label file itself (PDF / PNG) or JSON carrying links or base64 per carton.
    const t = await login(ctx);
    if (!t.ok) return t;
    let res: Response;
    try {
      res = await ctx.fetch(`${base(ctx)}/label/get_urls/${size}/${encodeURIComponent(ref.awb)}`, { timeoutMs: 25_000, headers: { authorization: `Bearer ${t.value}` } });
    } catch (e) { return { ok: false, error: { category: "timeout", message: `Delhivery B2B label request timed out: ${(e as Error).message}`, retryable: true } }; }
    if (res.status === 401) tokens.delete(ctx.accountId);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const head = Buffer.from(bytes.slice(0, 4)).toString("latin1");
    if (res.ok && (head === "%PDF")) return { ok: true, value: { pdf: bytes, formatsAvailable } };
    if (res.ok && (head.startsWith("\x89PNG") || head.startsWith("\xff\xd8"))) return { ok: true, value: { images: [`data:image/${head.startsWith("\x89") ? "png" : "jpeg"};base64,${Buffer.from(bytes).toString("base64")}`], formatsAvailable } };
    const text = Buffer.from(bytes).toString("utf8");
    let json: unknown = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (res.status === 429 || res.status >= 500 || res.status === 401) return { ok: false, error: { category: res.status === 429 ? "rate_limited" : "upstream", message: `Delhivery B2B label service answered HTTP ${res.status} — try again shortly`, retryable: true } };
    if (!res.ok) return { ok: false, error: { category: res.status === 404 ? "not_found" : "validation", message: providerError(json, `Delhivery B2B could not return the label (HTTP ${res.status})`), retryable: res.status === 404 } };
    const found = labelStrings(json);
    const images = found.map((s) => (s.startsWith("http") || s.startsWith("data:") ? s : `data:application/octet-stream;base64,${s.replace(/\s/g, "")}`));
    if (!images.length) {
      const keys = json && typeof json === "object" ? Object.keys(json as object).slice(0, 6).join(", ") : text.slice(0, 40);
      return { ok: false, error: { category: "not_found", message: `Delhivery has not generated labels for this LR yet (reply: ${keys || "empty"})`, retryable: true } };
    }
    return { ok: true, value: { images, formatsAvailable } };
  },

  /**
   * POD (developer portal "Document Download", 2026-11): GET /document/download?lrn=&doc_type=LM_POD&version=latest
   * (Bearer UMS token). Returns a link to the last-mile POD; the reply body is not documented, so links are collected.
   */
  async pod(ctx, ref) {
    const lrn = ref.lrNumber || ref.awb;
    const t = await login(ctx);
    if (!t.ok) return t;
    const out: PodResult = { ready: false, files: [] };
    // LM_POD = the last-mile POD Delhivery uploads after delivery; ALTERNATE_LM_POD when the first copy was re-uploaded
    for (const docType of ["LM_POD", "ALTERNATE_LM_POD"]) {
      let r: Response;
      try {
        r = await ctx.fetch(`${base(ctx)}/document/download?lrn=${encodeURIComponent(lrn)}&doc_type=${docType}&version=latest`, { timeoutMs: 25_000, headers: { authorization: `Bearer ${t.value}`, "x-request-id": `pod:${lrn}:${docType}` } });
      } catch (e) { return { ok: false, error: { category: "timeout", message: `Delhivery B2B timed out: ${(e as Error).message}`, retryable: true } }; }
      if (r.status === 401) { tokens.delete(ctx.accountId); return { ok: false, error: { category: "auth", message: "Delhivery B2B session expired — will retry", retryable: true } }; }
      if (r.status === 429 || r.status >= 500) return { ok: false, error: { category: r.status === 429 ? "rate_limited" : "upstream", message: `Delhivery document download HTTP ${r.status}`, retryable: true } };
      if (!r.ok) continue; // not uploaded yet
      const d = await documentReply(r);
      if (d.binary?.length) out.files.push({ kind: "pod", data: d.binary });
      else { const link = documentLinks(d.json)[0]; if (link) out.files.push({ kind: "pod", url: link }); Object.assign(out, documentMeta(d.json)); }
      if (out.files.length) break;
    }
    out.ready = out.files.length > 0;
    if (out.ready && !out.deliveryMode) out.deliveryMode = "pod";
    return { ok: true, value: out };
  },

  async schedulePickup(ctx, ref, date) {
    if (!ref.pickupLocation) return { ok: false, error: { category: "validation", message: "Pickup warehouse is not registered with Delhivery", retryable: false } };
    const r = await call(ctx, "/pickup_requests/", {
      method: "POST", headers: { "x-request-id": `${ref.providerOrderRef}:${date}` },
      body: JSON.stringify({ client_warehouse: ref.pickupLocation, pickup_date: date, start_time: String(ctx.config.pickupStartTime ?? "11:00:00"), expected_package_count: ref.packageCount ?? 1 }),
    });
    if (!r.ok) return r;
    return { ok: true, value: { pickupRef: firstString(r.value.json, ["pickup_id", "data.pickup_id", "pr_id", "data.pr_id", "id", "data.id"]) ?? undefined, scheduledFor: date, ...pickupAgent(r.value.json) } };
  },

  async track(ctx, awb) {
    const r = await call(ctx, `/lrn/track?lrnum=${encodeURIComponent(awb)}`);
    if (!r.ok) return r;
    const t = parseB2bTrack(r.value.json, awb);
    if (!t) return { ok: false, error: { category: "not_found", message: "No tracking status yet", retryable: true } };
    const cw = b2bChargedWeight(r.value.json);
    return { ok: true, value: { awb, carrierName: "Delhivery", status: t.status, events: t.events, etaDate: t.etaDate, ...(cw ? { chargedWeightGrams: cw } : {}) } };
  },

  async cancel(ctx, ref) {
    const lrn = ref.awb ?? ref.providerOrderRef;
    const r = await call(ctx, `/lrn/cancel/${encodeURIComponent(lrn)}`, { method: "DELETE" });
    if (!r.ok) return r;
    const j = r.value.json as Record<string, unknown> | null;
    if (j && (j.success === false || j.status === false)) return { ok: false, error: { category: "validation", message: providerError(j, "Delhivery refused the cancellation"), retryable: false } };
    return { ok: true, value: { acknowledged: true } };
  },

  async ndrAction() { return unsupported("NDR action"); },
};

export { amountToPaise };

/**
 * Courier charged / billed weight in a Delhivery B2B reply, only from an explicitly named field (never the booked
 * "weight"). Values below 1000 are kilograms, otherwise grams (same reading as the freight estimate). null = not stated.
 */
export function b2bChargedWeight(j: unknown, depth = 0): number | null {
  if (!j || typeof j !== "object" || depth > 6) return null;
  for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    if (/^(charged_wt|charged_weight|chargeable_weight|chargeable_wt|billed_weight|billed_wt|charged_weight_kg|charged_weight_g)$/i.test(k)) {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
      if (Number.isFinite(n) && n > 0) return /_kg$/i.test(k) ? Math.round(n * 1000) : /_g$/i.test(k) ? Math.round(n) : n < 1000 ? Math.round(n * 1000) : Math.round(n);
    }
  }
  for (const v of Object.values(j as Record<string, unknown>)) {
    if (v && typeof v === "object") { const n = b2bChargedWeight(v, depth + 1); if (n) return n; }
  }
  return null;
}

/** ODA (out of delivery area) flag from the pincode-serviceability response: true / false / null (not stated). */
export function odaFlag(j: unknown): boolean | null { return yesNo(j, /(^|_)(oda|is_oda|oda_flag|odc|remote)(_|$)/i); }
/** Non-serviceable zone (NSZ) in the pincode-serviceability response: an nsz / is_nsz flag that is set, or a value "NSZ" (e.g. a centre type). */
export function nszFlag(j: unknown, depth = 0): boolean {
  if (yesNo(j, /(^|_)(nsz|is_nsz|nsz_flag)(_|$)/i) === true) return true;
  if (!j || typeof j !== "object" || depth > 5) return false;
  for (const v of Array.isArray(j) ? j : Object.values(j as Record<string, unknown>)) {
    if (typeof v === "string" && /^\s*nsz\s*$/i.test(v)) return true;
    if (v && typeof v === "object" && nszFlag(v, depth + 1)) return true;
  }
  return false;
}
/** FOD support flag from the pincode-serviceability response (null when Delhivery does not say). */
export function fodFlag(j: unknown): boolean | null { return yesNo(j, /(^|_)(fod|is_fod|fod_available|freight_on_delivery|topay|to_pay)(_|$)/i); }
function yesNo(j: unknown, key: RegExp, depth = 0): boolean | null {
  if (!j || typeof j !== "object" || depth > 4) return null;
  if (Array.isArray(j)) { for (const x of j) { const r = yesNo(x, key, depth + 1); if (r !== null) return r; } return null; }
  for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    if (!key.test(k)) continue;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v > 0;
    if (typeof v === "string") { if (/^(y|yes|true|1)$/i.test(v.trim())) return true; if (/^(n|no|false|0)$/i.test(v.trim())) return false; }
  }
  for (const v of Object.values(j as Record<string, unknown>)) if (v && typeof v === "object") { const r = yesNo(v, key, depth + 1); if (r !== null) return r; }
  return null;
}

/** Body of the B2B /freight/estimate request (shared by quotes and the Admin raw rate check). */
function estimateBody(ctx: ProviderContext, req: import("./types").QuoteRequest) {
  const totalG = req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
  return {
    dimensions: req.packages.map((p) => ({ length_cm: p.lengthMm / 10, width_cm: p.breadthMm / 10, height_cm: p.heightMm / 10, box_count: p.count })),
    weight_g: totalG, cheque_payment: false, source_pin: req.originPincode, consignee_pin: req.destinationPincode,
    payment_mode: collectsCod(req.paymentType, req.codAmount) ? "cod" : "prepaid", ...(collectsCod(req.paymentType, req.codAmount) ? { cod_amount: rupees(req.codAmount ?? 0) } : {}),
    inv_amount: rupees(req.declaredValue ?? 0), ...freightMode(ctx, req.paymentType), rov_insurance: !!ctx.config.rovInsurance,
  };
}

/** Admin rate check: the exact Delhivery responses behind a quote (serviceability + freight estimate), as text. */
export async function delhiveryB2bRaw(ctx: ProviderContext, req: import("./types").QuoteRequest): Promise<Record<string, string>> {
  const totalG = req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
  const out: Record<string, string> = {};
  const body = estimateBody(ctx, req);
  out["request /freight/estimate"] = JSON.stringify(body);
  const svc = await call(ctx, `/pincode-service/${req.destinationPincode}?weight=${totalG}`);
  out["/pincode-service"] = svc.ok ? JSON.stringify(svc.value.json) : `error: ${svc.error.message}`;
  const est = await call(ctx, "/freight/estimate", { method: "POST", body: JSON.stringify(body) });
  out["/freight/estimate"] = est.ok ? JSON.stringify(est.value.json) : `error: ${est.error.message}`;
  return out;
}
