import "server-only";
import type { ProviderQuote, ProviderQuoteComponent } from "@/server/pricing/engine";
import {
  type BookResult, type LabelFormat, type NormalizedStatus, type ProviderContext, type Result, type ShippingAdapter, type WarehouseInput, unsupported,
} from "./types";
import { amountToPaise, b2bCharges, firstString, jsonOrNull, providerError, rupees } from "./delhivery-common";

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
function freightMode(ctx: ProviderContext, pay: string): { freight_mode?: string } {
  if (pay === "fod") return { freight_mode: "fod" };
  return ctx.config.retailClient ? { freight_mode: "fop" } : {};
}

const STATUS: Record<string, NormalizedStatus> = {
  MANIFESTED: "booked", NOT_PICKED: "pickup_pending", PICKED_UP: "picked_up", LEFT_ORIGIN: "in_transit", REACH_DESTINATION: "at_delivery_center",
  UNDEL_REATTEMPT: "ndr", PART_DEL: "delivered", OFD: "out_for_delivery", DELIVERED: "delivered", RETURNED_INTRANSIT: "rto_in_transit",
  RECEIVED_AT_RETURN_CENTER: "rto_in_transit", RETURN_OFD: "rto_in_transit", RETURN_DELIVERED: "rto_delivered", LOST: "lost", CANCELLED: "cancelled",
};
export const mapB2bStatus = (s: string): NormalizedStatus => STATUS[s.toUpperCase().replace(/\s+/g, "_")] ?? "in_transit";

const LABEL_SIZE: Partial<Record<LabelFormat, string>> = { a4: "a4", thermal_4x4: "md", thermal_3x4: "std", thermal_2x4: "sm" };

export const delhiveryB2bAdapter: ShippingAdapter = {
  key: "delhivery_b2b",
  displayName: "Delhivery Direct B2B",
  implemented: ["authenticate", "health", "warehouse_sync", "serviceability", "quote", "book", "booking_lookup", "label", "pickup", "track", "cancel", "reconciliation"],
  paymentModes: ["prepaid", "cod", "fod"],

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

    const divisor = Number(ctx.config.volDivisor ?? 5000);
    const volG = req.packages.reduce((t, p) => t + Math.ceil(((p.lengthMm / 10) * (p.breadthMm / 10) * (p.heightMm / 10) * 1000) / divisor) * p.count, 0);
    let components: ProviderQuoteComponent[]; let chargeable = Math.max(totalG, volG); let source: string;

    if (ctx.config.rateSource === "rate_card") {
      const rc = (ctx.config.rateCard ?? {}) as { perKgPaise?: number; minKg?: number; docketPaise?: number; fuelPct?: number; codFeePaise?: number; codPct?: number; fodFeePaise?: number };
      if (!rc.perKgPaise) return { ok: false, error: { category: "unsupported", message: "Delhivery B2B contract rate card is not configured", retryable: false } };
      const kg = Math.max(rc.minKg ?? 20, Math.ceil(chargeable / 1000)); chargeable = kg * 1000;
      const freight = kg * rc.perKgPaise;
      components = [{ code: "freight", label: "Base freight", amount: freight }];
      if (rc.fuelPct) components.push({ code: "fuel", label: "Fuel surcharge", amount: Math.round((freight * rc.fuelPct) / 100) });
      if (rc.docketPaise) components.push({ code: "docket", label: "Docket charge", amount: rc.docketPaise });
      if (req.paymentType === "cod") components.push({ code: "cod_fee", label: "COD charge", amount: Math.max(rc.codFeePaise ?? 0, Math.round(((req.codAmount ?? 0) * (rc.codPct ?? 0)) / 100)) });
      if (req.paymentType === "fod" && rc.fodFeePaise) components.push({ code: "other", label: "FOD charge", amount: rc.fodFeePaise });
      source = "contract_rate_card";
    } else {
      const est = await call(ctx, "/freight/estimate", {
        method: "POST",
        body: JSON.stringify({
          dimensions: req.packages.map((p) => ({ length_cm: p.lengthMm / 10, width_cm: p.breadthMm / 10, height_cm: p.heightMm / 10, box_count: p.count })),
          weight_g: totalG, cheque_payment: false, source_pin: req.originPincode, consignee_pin: req.destinationPincode,
          payment_mode: req.paymentType === "cod" ? "cod" : "prepaid", ...(req.paymentType === "cod" ? { cod_amount: rupees(req.codAmount ?? 0) } : {}),
          inv_amount: rupees(req.declaredValue ?? 0), ...freightMode(ctx, req.paymentType), rov_insurance: !!ctx.config.rovInsurance,
        }),
      });
      if (!est.ok) return est;
      const parsed = b2bCharges(est.value.json);
      if (!parsed) return { ok: false, error: { category: "upstream", message: "Delhivery returned no freight breakup for this route — rate unavailable (not ₹0). Retry, or configure a contract rate card.", retryable: true } };
      components = parsed.components;
      if (parsed.chargeableGrams) chargeable = parsed.chargeableGrams;
      source = "freight_estimate_api";
    }
    if (!components.some((c) => c.code === "freight" && c.amount > 0)) return { ok: false, error: { category: "upstream", message: "Delhivery base freight unavailable for this route", retryable: true } };

    let etaDays: number | undefined;
    const tat = await call(ctx, `/tat/estimate?origin_pin=${req.originPincode}&destination_pin=${req.destinationPincode}`, { timeoutMs: 8_000 });
    if (tat.ok) { const d = Number(firstString(tat.value.json, ["tat", "data.tat", "data.expected_tat", "expected_tat", "data"])); if (d > 0 && d < 60) etaDays = Math.round(d); }

    const q: ProviderQuote = {
      provider: "delhivery_b2b", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "Delhivery B2B Surface (LTL)", mode: "B2B", etaDays,
      components, taxInclusive: false, taxRateBps: 1800, chargeableWeightGrams: chargeable, providerQuoteRef: `${source}:${req.paymentType}`,
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
    fd.set("payment_mode", req.paymentType === "cod" ? "cod" : "prepaid");
    if (req.paymentType === "cod") fd.set("cod_amount", String(rupees(req.codAmount)));
    fd.set("weight", String(totalG));
    fd.set("dropoff_location", JSON.stringify({ consignee_name: req.consignee.name, address: [req.consignee.line1, req.consignee.line2].filter(Boolean).join(", "), city: req.consignee.city, state: req.consignee.state, zip: req.consignee.pincode, phone: req.consignee.mobile, email: req.consignee.email ?? "" }));
    fd.set("shipment_details", JSON.stringify(req.packages.map((p, i) => ({ order_id: `${req.vishwashipOrderId}-${i + 1}`, box_count: p.count, description: req.products.map((x) => x.name).join(", ").slice(0, 100) || "Goods", weight: p.actualWeightGrams * p.count, waybills: [], master: false }))));
    fd.set("dimensions", JSON.stringify(req.packages.map((p) => ({ length_cm: p.lengthMm / 10, width_cm: p.breadthMm / 10, height_cm: p.heightMm / 10, box_count: p.count }))));
    fd.set("invoices", JSON.stringify([{ ewaybill: req.ewayBill ?? "", inv_num: req.invoiceNumber ?? req.orderNumber, inv_amt: rupees(req.declaredValue), inv_qr_code: "" }]));
    fd.set("rov_insurance", ctx.config.rovInsurance ? "True" : "False");
    const fm = freightMode(ctx, req.paymentType).freight_mode;
    if (fm) fd.set("freight_mode", fm);
    fd.set("fm_pickup", "True");
    if (ctx.config.billingAddress) fd.set("billing_address", JSON.stringify(ctx.config.billingAddress));
    const r = await call(ctx, "/manifest", { method: "POST", body: fd, timeoutMs: 30_000 });
    if (!r.ok) return r.error.category === "timeout" ? { ok: false, error: { ...r.error, category: "ambiguous" } } : r;
    const jobId = firstString(r.value.json, ["job_id", "data.job_id", "request_id", "data.request_id", "jobId"]);
    if (!jobId) return { ok: false, error: { category: "ambiguous", message: "Delhivery accepted the manifest but returned no job ID", retryable: false } };
    const res: BookResult = { providerOrderRef: jobId, awb: null, lrNumber: null, state: "pending_async", labelAvailable: false };
    return { ok: true, value: res };
  },

  async lookupBooking(ctx, ref) {
    if (!ref.providerOrderRef) return { ok: false, error: { category: "ambiguous", message: "No Delhivery job ID stored — manual check in Delhivery ONE needed", retryable: true } };
    if (/^\d{6,}$/.test(ref.providerOrderRef)) return { ok: true, value: { providerOrderRef: ref.providerOrderRef, awb: ref.providerOrderRef, lrNumber: ref.providerOrderRef, state: "confirmed", labelAvailable: true } };
    const r = await call(ctx, `/manifest?job_id=${encodeURIComponent(ref.providerOrderRef)}`);
    if (!r.ok) return r;
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
    const r = await call(ctx, `/label/get_urls/${size}/${encodeURIComponent(ref.awb)}`);
    if (!r.ok) return r;
    const list = (Array.isArray(r.value.json) ? r.value.json : ((r.value.json as Record<string, unknown>)?.data ?? (r.value.json as Record<string, unknown>)?.urls ?? [])) as unknown[];
    const images = list.map((x) => (typeof x === "string" ? x : firstString(x, ["url", "label", "image", "data"]) ?? "")).filter(Boolean)
      .map((s) => (s.startsWith("http") || s.startsWith("data:") ? s : `data:image/png;base64,${s}`));
    if (!images.length) return { ok: false, error: { category: "not_found", message: "Delhivery has not generated labels for this LR yet", retryable: true } };
    return { ok: true, value: { images, formatsAvailable } };
  },

  async schedulePickup(ctx, ref, date) {
    if (!ref.pickupLocation) return { ok: false, error: { category: "validation", message: "Pickup warehouse is not registered with Delhivery", retryable: false } };
    const r = await call(ctx, "/pickup_requests/", {
      method: "POST", headers: { "x-request-id": `${ref.providerOrderRef}:${date}` },
      body: JSON.stringify({ client_warehouse: ref.pickupLocation, pickup_date: date, start_time: String(ctx.config.pickupStartTime ?? "11:00:00"), expected_package_count: ref.packageCount ?? 1 }),
    });
    if (!r.ok) return r;
    return { ok: true, value: { pickupRef: firstString(r.value.json, ["pickup_id", "data.pickup_id", "pr_id", "data.pr_id", "id", "data.id"]) ?? undefined, scheduledFor: date } };
  },

  async track(ctx, awb) {
    const r = await call(ctx, `/lrn/track?lrnum=${encodeURIComponent(awb)}`);
    if (!r.ok) return r;
    const raw = firstString(r.value.json, ["status", "data.status", "data.0.status", "current_status", "data.current_status"]) ?? "";
    if (!raw) return { ok: false, error: { category: "not_found", message: "No tracking status yet", retryable: true } };
    const at = firstString(r.value.json, ["status_time", "data.status_time", "updated_at", "data.updated_at", "data.0.status_time"]) ?? new Date().toISOString();
    const loc = firstString(r.value.json, ["location", "data.location", "data.0.location"]) ?? undefined;
    const status = mapB2bStatus(raw);
    return { ok: true, value: { awb, carrierName: "Delhivery", status, events: [{ status, rawStatus: raw, location: loc, occurredAt: new Date(at).toISOString() }] } };
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
