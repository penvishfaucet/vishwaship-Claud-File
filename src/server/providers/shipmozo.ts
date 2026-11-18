import type { ProviderQuote, ProviderQuoteComponent } from "@/server/pricing/engine";
import { amountToPaise, firstString, jsonOrNull } from "./delhivery-common";
import { type BookResult, type NormalizedStatus, type ProviderContext, type Result, type ShippingAdapter, type TrackingEvent, unsupported } from "./types";

/**
 * Shipmozo (aggregator). Contract: "Shipmozo API Setup Guide" (supplied PDF).
 *   Base URL  https://shipping-api.com/app/api/v1   (no trailing slash — the guide warns it breaks requests)
 *   Auth      headers `public-key` and `private-key` on every request, sent only from the server.
 *   Envelope  { result: "1" | "0", message, data }
 * Units: Vishwaship stores grams / millimetres / paise; Shipmozo takes grams, centimetres and rupees.
 *
 * One Vishwaship provider account = one Shipmozo service (config.service "B2C" | "B2B"), so B2C and B2B
 * are configured, verified and switched on independently even when they share the same keys.
 *
 * The guide documents requests but not the rate-calculator / get-order-detail / track-order response
 * fields beyond the examples, so those are read defensively and a rate is only offered when a positive
 * charge and a courier_id are found. Nothing is ever shown as ₹0 or given an invented AWB.
 */
export const SHIPMOZO_DEFAULT_BASE = "https://shipping-api.com/app/api/v1";

const base = (ctx: ProviderContext) => {
  const b = ctx.config.baseUrl as Record<string, string> | string | undefined;
  const url = typeof b === "string" ? b : b?.[ctx.mode];
  return (url || SHIPMOZO_DEFAULT_BASE).replace(/\/+$/, "");
};

type Envelope = { result?: string | number; message?: string; data?: unknown };

async function call(ctx: ProviderContext, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Result<Envelope>> {
  if (!ctx.secrets.publicKey || !ctx.secrets.privateKey) return { ok: false, error: { category: "auth", message: "Courier partner public / private key not configured", retryable: false } };
  let r: Response;
  try {
    r = await ctx.fetch(`${base(ctx)}${path}`, {
      timeoutMs: 15_000, ...init,
      headers: { "public-key": ctx.secrets.publicKey, "private-key": ctx.secrets.privateKey, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch (e) { return { ok: false, error: { category: "timeout", message: `Courier partner did not respond: ${(e as Error).message}`.slice(0, 200), retryable: true } }; }
  const json = (await jsonOrNull(r)) as Envelope | null;
  if (r.status === 401 || r.status === 403) return { ok: false, error: { category: "auth", message: "Courier partner rejected the public / private key", retryable: false } };
  if (r.status === 429) return { ok: false, error: { category: "rate_limited", message: "Courier partner rate limit reached — try again shortly", retryable: true } };
  if (r.status >= 500) return { ok: false, error: { category: "upstream", message: `Courier partner error HTTP ${r.status}`, retryable: true } };
  if (!json || typeof json !== "object") return { ok: false, error: { category: "upstream", message: `Courier partner returned an unreadable response (HTTP ${r.status})`, retryable: true } };
  if (String(json.result) !== "1") {
    const msg = smError(json);
    const auth = /key|auth|unauthori[sz]ed|invalid user|token/i.test(msg);
    return { ok: false, error: { category: auth ? "auth" : /not found/i.test(msg) ? "not_found" : "validation", message: msg.slice(0, 300), retryable: false } };
  }
  return { ok: true, value: json };
}

const smError = (j: Envelope) => (firstString(j, ["data.error", "data.message", "message", "data.0.error"]) ?? "request failed").slice(0, 240);
const rupees = (paise: number) => Math.round(paise) / 100;
const digits10 = (s: string) => s.replace(/\D/g, "").slice(-10);
const istDate = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const asNum = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[,₹\s]/g, "")) : NaN; return Number.isFinite(n) ? n : NaN; };

/** Map a Shipmozo courier name to a Vishwaship carrier code (logo + Admin courier switches). */
export function carrierFromName(name: string): { code: string; name: string } {
  const n = name.toLowerCase().replace(/[-_]/g, ""); // "Blue-Dart", "E-KART" → bluedart, ekart
  const table: Array<[RegExp, string, string]> = [
    [/delhivery/, "delhivery", "Delhivery"], [/blue ?dart/, "blue-dart", "Blue Dart"], [/xpress ?bees/, "xpressbees", "Xpressbees"], [/ekart/, "ekart", "Ekart"],
    [/dtdc/, "dtdc", "DTDC"], [/ecom/, "ecom-express", "Ecom Express"], [/shadowfax/, "shadowfax", "Shadowfax"], [/amazon|\bats\b/, "amazon-shipping", "Amazon Shipping"],
    [/professional/, "the-professional-couriers", "The Professional Couriers"], [/trackon/, "trackon", "Trackon"], [/maruti/, "shree-maruti", "Shree Maruti"],
    [/gati/, "allcargo-gati", "Allcargo Gati"], [/tci/, "tci-express", "TCI Express"], [/india ?post|speed ?post/, "india-post", "India Post"], [/dhl/, "dhl", "DHL"],
    [/fedex/, "fedex-express", "FedEx Express"], [/aramex/, "aramex", "Aramex"], [/smartr/, "smartr", "Smartr"], [/bluedart/, "blue-dart", "Blue Dart"],
  ];
  const hit = table.find(([re]) => re.test(n));
  return hit ? { code: hit[1], name: hit[2] } : { code: `sm-${n.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "courier"}`, name: name.trim().slice(0, 60) || "Courier" };
}

/** Normalise a Shipmozo / courier status text. Unknown text never implies pickup (kept as "booked"). */
export function mapShipmozoStatus(raw: string): NormalizedStatus {
  const s = raw.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (!s) return "booked";
  if (/cancel/.test(s)) return "cancelled";
  if (/\brto\b|return to origin|returned to (origin|seller|shipper)/.test(s)) {
    if (/deliver/.test(s)) return "rto_delivered";
    if (/initiat|marked/.test(s)) return "rto_initiated";
    return "rto_in_transit";
  }
  if (/\blost\b/.test(s)) return "lost";
  if (/undeliver|not delivered|delivery fail|failed delivery|\bndr\b|attempt(ed)? fail|refused|consignee not available/.test(s)) return "ndr";
  if (/out for delivery|\bofd\b/.test(s)) return "out_for_delivery";
  if (/delivered/.test(s)) return "delivered";
  if (/not picked|pickup (pending|scheduled|generated|requested|queued|cancel)|pending pickup|awaiting pickup|ready to (ship|pickup)|pickup exception/.test(s)) return "pickup_pending";
  if (/picked up|pickup (done|complete|successful)|shipment picked/.test(s)) return "picked_up";
  if (/reached (at )?destination|at destination|destination hub|arrived at delivery|reached delivery/.test(s)) return "at_delivery_center";
  if (/in transit|intransit|dispatched|departed|shipped|connected|bagged|hub|arrived/.test(s)) return "in_transit";
  if (/manifest|booked|awb (assigned|generated)|new|order (placed|created)|courier assigned|label generated/.test(s)) return "booked";
  return "booked";
}

/** One courier option from rate-calculator → priced provider quote (paise, pre-tax unless configured). */
export function parseRateRow(row: Record<string, unknown>, ctx: { mode: "B2C" | "B2B"; gstTreatment: string; actualGrams: number }): { quote: ProviderQuote; courierId: string } | { error: string } {
  const courierId = firstString(row, ["courier_id", "id", "courier_company_id", "service_id"]);
  const name = firstString(row, ["name", "courier_name", "courier", "courier_company", "service_name", "courier_company_service"]) ?? "";
  if (!courierId) return { error: `${name || "A courier"} has no courier_id` };
  const total = asNum(firstString(row, ["total_charges", "total_charge", "total", "total_amount", "rate", "charges"]));
  const gst = asNum(firstString(row, ["gst", "gst_amount", "tax", "tax_amount", "gst_charges"]));
  const preTax = asNum(firstString(row, ["before_tax_total_charges", "before_tax_total", "total_before_tax", "sub_total", "subtotal", "taxable_amount"]));
  const cod = asNum(firstString(row, ["cod_charges", "cod_charge", "cod_fee"]));

  const shipping = asNum(firstString(row, ["shipping_charges", "freight_charges"]));
  const overhead = asNum(firstString(row, ["overhead_charges"]));
  let components: ProviderQuoteComponent[];
  let taxInclusive = false;
  if (preTax > 0 && shipping > 0 && overhead > 0 && Math.abs(shipping + overhead - preTax) < 0.01) {
    components = [{ code: "freight", label: "Shipping charges", amount: amountToPaise(shipping) }, { code: "other", label: "Overhead charges", amount: amountToPaise(overhead) }];
  } else if (preTax > 0) {
    components = [{ code: "freight", label: "Freight & surcharges", amount: amountToPaise(preTax) }];
  } else if (total > 0 && gst >= 0 && Number.isFinite(gst)) {
    components = [{ code: "freight", label: "Freight & surcharges", amount: amountToPaise(total) - amountToPaise(gst) }];
  } else if (total > 0 && (ctx.gstTreatment === "inclusive" || ctx.gstTreatment === "exclusive")) {
    components = [{ code: "freight", label: "Freight & surcharges", amount: amountToPaise(total) }];
    taxInclusive = ctx.gstTreatment === "inclusive";
  } else {
    return { error: `${name || courierId}: the rate basis (GST included or not) is not in the response — set it after a Rate check` };
  }
  // Show the COD fee as its own line when the response separates it (it stays inside the comparable rate).
  if (cod > 0 && components.length === 1 && components[0].amount > amountToPaise(cod)) {
    const codPaise = amountToPaise(cod);
    components = [{ ...components[0], amount: components[0].amount - codPaise }, { code: "cod_fee", label: "COD charge", amount: codPaise }];
  }
  if (!(components.reduce((t, c) => t + c.amount, 0) > 0)) return { error: `${name || courierId}: no positive rate` };

  const etaRaw = firstString(row, ["estimated_delivery_days", "edd_days", "tat", "estimated_delivery", "expected_delivery", "edd"]) ?? "";
  const etaN = Number((etaRaw.match(/\d+(\.\d+)?/) ?? [])[0]);
  const etaDays = /\d{4}-\d{2}-\d{2}/.test(etaRaw)
    ? Math.max(1, Math.ceil((new Date(etaRaw).getTime() - Date.now()) / 86400_000))
    : etaN > 0 && etaN < 60 ? Math.round(etaN) : undefined;
  // e.g. "0.5 KG", "500 gm", 0.5
  const cwText = firstString(row, ["chargeable_weight", "charged_weight", "minimum_chargeable_weight", "applicable_weight"]) ?? "";
  const cwNum = Number((cwText.match(/\d+(\.\d+)?/) ?? [])[0]);
  const isGrams = /\d\s*g(m|ms|ram|rams)?\b/i.test(cwText) && !/kg/i.test(cwText);
  const cw = cwNum > 0 ? (isGrams ? Math.round(cwNum) : /kg/i.test(cwText) || cwNum < 200 ? Math.round(cwNum * 1000) : Math.round(cwNum)) : 0;
  const gstPct = asNum(firstString(row, ["gst_percentage", "gst_percent", "tax_percentage"]));
  const auto = (firstString(row, ["pickups_automatically_scheduled", "pickup_automatically_scheduled", "auto_pickup"]) ?? "").toUpperCase();
  const carrier = carrierFromName(name);
  return {
    courierId,
    quote: {
      provider: "shipmozo", carrierCode: carrier.code, carrierName: carrier.name, serviceName: name || carrier.name, mode: ctx.mode, etaDays,
      components, taxInclusive, taxRateBps: gstPct >= 0 && gstPct <= 28 && Number.isFinite(gstPct) ? Math.round(gstPct * 100) : 1800, chargeableWeightGrams: Math.max(cw, ctx.actualGrams),
      providerQuoteRef: `shipmozo_api:${courierId}:${auto === "NO" || auto === "N" || auto === "FALSE" ? "manual" : auto ? "auto" : "unknown"}`,
    },
  };
}

function dataRows(d: unknown): Record<string, unknown>[] {
  if (Array.isArray(d)) return d.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (d && typeof d === "object") {
    for (const k of ["couriers", "rates", "courier_list", "data", "list"]) { const v = (d as Record<string, unknown>)[k]; if (Array.isArray(v)) return dataRows(v); }
    return [d as Record<string, unknown>];
  }
  return [];
}

const detailRow = (d: unknown) => (Array.isArray(d) ? d[0] : d) as Record<string, unknown> | undefined;

export function parseOrderDetail(env: Envelope, orderId: string): BookResult | null {
  const d = detailRow(env.data);
  if (!d) return null;
  const awb = firstString(d, ["awb_number", "awb", "shipping_details.awb_number", "order_details.awb_number", "courier_details.awb_number"]);
  const lr = firstString(d, ["lr_number", "shipping_details.lr_number", "order_details.lr_number"]);
  const courier = firstString(d, ["courier", "courier_company", "courier_name", "shipping_details.courier_company", "courier_details.courier_company", "assigned_courier"]);
  const ref = firstString(d, ["order_id", "reference_id", "order_details.order_id"]) ?? orderId;
  if (awb) return { providerOrderRef: ref, awb, lrNumber: lr, state: "confirmed", labelAvailable: true };
  if (courier) return { providerOrderRef: ref, awb: null, lrNumber: lr, state: "pending_async", labelAvailable: false };
  return null; // pushed but no courier assigned: nothing will move, safe to treat as not booked
}

export function parseTrack(env: Envelope, awb: string) {
  const d = (detailRow(env.data) ?? {}) as Record<string, unknown>;
  const scansRaw = (d.scan_detail ?? d.scan_details ?? d.scans ?? d.tracking_history ?? []) as unknown;
  const scans = (Array.isArray(scansRaw) ? scansRaw : []) as Array<Record<string, unknown>>;
  const at = (x: Record<string, unknown>) => {
    const t = firstString(x, ["date_time", "status_time", "scan_time", "datetime", "time", "date", "updated_at", "created_at"]);
    if (!t) return null;
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.replace(" ", "T")}+05:30`; // Shipmozo times are IST
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  };
  const events: TrackingEvent[] = [];
  for (const x of scans) {
    const raw = firstString(x, ["status", "scan", "activity", "remark", "remarks", "message", "description"]) ?? "";
    const when = at(x);
    if (!raw || !when) continue;
    events.push({ status: mapShipmozoStatus(raw), rawStatus: raw.slice(0, 200), location: firstString(x, ["location", "city", "scan_location", "place"]) ?? undefined, occurredAt: when, remark: firstString(x, ["remark", "remarks", "instructions"]) ?? undefined });
  }
  const current = firstString(d, ["current_status", "status"]) ?? "";
  const currentAt = at({ status_time: d.status_time } as Record<string, unknown>);
  if (current && currentAt && !events.some((e) => e.rawStatus === current && e.occurredAt === currentAt)) events.push({ status: mapShipmozoStatus(current), rawStatus: current.slice(0, 200), occurredAt: currentAt });
  const eta = firstString(d, ["expected_delivery_date", "edd"]);
  return { awb: firstString(d, ["awb_number"]) ?? awb, carrierName: firstString(d, ["courier"]) ?? "Courier", status: mapShipmozoStatus(current), events, etaDate: eta && !Number.isNaN(new Date(eta).getTime()) ? new Date(eta).toISOString() : undefined, currentStatus: current };
}

export const shipmozoAdapter: ShippingAdapter = {
  key: "shipmozo",
  displayName: "Shipmozo",
  implemented: ["authenticate", "health", "warehouse_sync", "serviceability", "quote", "book", "booking_lookup", "label", "pickup", "track", "cancel", "reconciliation"],
  paymentModes: ["prepaid", "cod"],

  async health(ctx) {
    const info = await call(ctx, "/info", { timeoutMs: 10_000 });
    if (!info.ok) return info;
    // /info only says the API is up; get-warehouses proves the keys work for this account.
    const wh = await call(ctx, "/get-warehouses", { timeoutMs: 10_000 });
    if (!wh.ok) return wh;
    const n = Array.isArray(wh.value.data) ? wh.value.data.length : 0;
    return { ok: true, value: { message: `Courier partner API reachable and keys accepted (${n} warehouse${n === 1 ? "" : "s"} on the account)` } };
  },

  async quote(ctx, req) {
    const service = ctx.config.service === "B2B" ? "B2B" : "B2C";
    if (req.mode !== service || req.paymentType === "fod") return { ok: true, value: [] };
    // Serviceability is decided by rate-calculator: on the live account pincode-serviceability answered
    // "serviceable": false for lanes where rate-calculator returned several couriers (seen 2026-11-18).
    const actualGrams = req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
    const body = shipmozoQuoteBodies(ctx, req).rates;
    const r = await call(ctx, "/rate-calculator", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return r;
    const allow = new Set(((ctx.config.courierIds as string[] | undefined) ?? []).map(String).filter(Boolean));
    const quotes: ProviderQuote[] = [];
    const skipped: string[] = [];
    for (const row of dataRows(r.value.data)) {
      const p = parseRateRow(row, { mode: service, gstTreatment: String(ctx.config.gstTreatment ?? "auto"), actualGrams });
      if ("error" in p) { skipped.push(p.error); continue; }
      if (allow.size && !allow.has(p.courierId)) continue;
      quotes.push(p.quote);
    }
    if (!quotes.length) return { ok: false, error: { category: skipped.length ? "upstream" : "not_serviceable", message: skipped.length ? `Courier partner rate could not be verified: ${skipped[0]}` : `Courier partner has no courier from ${req.originPincode} to ${req.destinationPincode} for this shipment`, retryable: false } };
    return { ok: true, value: quotes };
  },

  async registerWarehouse(ctx, w) {
    // Shipmozo rejects special characters in address_title ("Special characters are not allowed in address title")
    const title = `VS${w.code}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
    const r = await call(ctx, "/create-warehouse", {
      method: "POST",
      body: JSON.stringify({ address_title: title, name: w.contactName, phone: Number(digits10(w.mobile)), email: w.email ?? "", address_line_one: w.line1, address_line_two: w.line2 ?? "", pin_code: Number(w.pincode) }),
    });
    if (r.ok) {
      const id = firstString(r.value.data, ["warehouse_id", "id"]);
      if (id) return { ok: true, value: { ref: id } };
    }
    // The guide: an existing title returns its id, otherwise look it up via get-warehouses.
    const list = await call(ctx, "/get-warehouses");
    if (!list.ok) return list;
    const hit = (Array.isArray(list.value.data) ? list.value.data : []).find((x: Record<string, unknown>) => String(x.address_title ?? "") === title) as Record<string, unknown> | undefined;
    if (hit?.id != null) return { ok: true, value: { ref: String(hit.id) } };
    return r.ok ? { ok: false, error: { category: "upstream", message: "Courier partner created the warehouse but returned no warehouse_id", retryable: true } } : r;
  },

  async book(ctx, req) {
    const service = ctx.config.service === "B2B" ? "B2B" : "B2C";
    const [kind, courierId, pickupMode] = (req.quote.providerQuoteRef ?? "").split(":");
    if (kind !== "shipmozo_api" || !courierId) return { ok: false, error: { category: "validation", message: "This quote has no Courier partner courier_id — refresh rates", retryable: false } };
    if (!req.pickup.providerWarehouseRef) return { ok: false, error: { category: "validation", message: "Pickup address is not mapped to a Courier partner warehouse", retryable: false } };
    const boxes = req.packages.reduce((t, p) => t + p.count, 0);
    if (boxes > 1 && service === "B2C") return { ok: false, error: { category: "validation", message: "Courier partner B2C books one package per order — use B2B for multiple cartons", retryable: false } };
    if (boxes > 1 && !ctx.config.mpsBookingVerified) return { ok: false, error: { category: "unsupported", message: "Courier partner multi-carton booking needs Courier partner's B2B push-order fields (pending documentation)", retryable: false } };
    const big = [...req.packages].sort((a, b) => b.lengthMm * b.breadthMm * b.heightMm - a.lengthMm * a.breadthMm * a.heightMm)[0];
    const orderId = req.vishwashipOrderId; // stable and globally unique → Shipmozo's duplicate check makes retries safe

    const push = await call(ctx, "/push-order", {
      method: "POST", timeoutMs: 25_000,
      body: JSON.stringify({
        order_id: orderId, order_date: istDate(), order_type: String(ctx.config.orderType ?? "NON ESSENTIALS"),
        consignee_name: req.consignee.name, consignee_phone: Number(digits10(req.consignee.mobile)), consignee_email: req.consignee.email ?? "",
        consignee_address_line_one: req.consignee.line1, consignee_address_line_two: req.consignee.line2 ?? "", consignee_pin_code: Number(req.consignee.pincode),
        consignee_city: req.consignee.city, consignee_state: req.consignee.state,
        product_detail: (req.products.length ? req.products : [{ name: "Goods", qty: 1, unitPrice: req.declaredValue }]).map((p) => ({ name: p.name.slice(0, 100), sku_number: p.sku ?? "", quantity: p.qty, discount: "", hsn: p.hsn ?? "", unit_price: rupees(p.unitPrice), product_category: "Other" })),
        payment_type: req.paymentType === "cod" ? "COD" : "PREPAID", cod_amount: req.paymentType === "cod" ? String(rupees(req.codAmount)) : "",
        weight: req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0),
        length: Math.ceil(big.lengthMm / 10), width: Math.ceil(big.breadthMm / 10), height: Math.ceil(big.heightMm / 10),
        warehouse_id: req.pickup.providerWarehouseRef, gst_ewaybill_number: req.ewayBill ?? "", gstin_number: "",
      }),
    });
    if (!push.ok) {
      if (push.error.category === "timeout" || push.error.category === "upstream") return { ok: false, error: { ...push.error, category: "ambiguous" } };
      if (!/already|exist|duplicate/i.test(push.error.message)) return push;
    }

    const assign = await call(ctx, "/assign-courier", { method: "POST", timeoutMs: 25_000, body: JSON.stringify({ order_id: orderId, courier_id: Number(courierId) || courierId }) });
    if (!assign.ok && !/already/i.test(assign.error.message)) {
      return assign.error.category === "timeout" || assign.error.category === "upstream" ? { ok: false, error: { ...assign.error, category: "ambiguous" } } : assign;
    }

    let awb: string | null = assign.ok ? firstString(assign.value.data, ["awb_number", "awb"]) : null;
    let lr: string | null = null;
    let pickupRef: string | undefined;
    if (pickupMode === "manual" && !ctx.config.skipManualPickup) {
      const pk = await call(ctx, "/schedule-pickup", { method: "POST", timeoutMs: 20_000, body: JSON.stringify({ order_id: orderId }) });
      if (pk.ok) { awb = firstString(pk.value.data, ["awb_number"]) ?? awb; lr = firstString(pk.value.data, ["lr_number"]); pickupRef = firstString(pk.value.data, ["pickup_id", "pickup_reference", "reference_id"]) ?? undefined; }
    }
    if (!awb) {
      const det = await call(ctx, `/get-order-detail/${encodeURIComponent(orderId)}`, { timeoutMs: 15_000 });
      if (det.ok) { const d = parseOrderDetail(det.value, orderId); awb = d?.awb ?? null; lr = d?.lrNumber ?? lr; }
    }
    const res: BookResult = {
      providerOrderRef: orderId, awb, lrNumber: lr && lr !== awb ? lr : null, state: awb ? "confirmed" : "pending_async", labelAvailable: !!awb,
      pickupRef, pickupScheduled: pickupMode === "auto" || !!pickupRef,
    };
    return { ok: true, value: res };
  },

  async lookupBooking(ctx, ref) {
    const orderId = ref.vishwashipOrderId;
    const r = await call(ctx, `/get-order-detail/${encodeURIComponent(orderId)}`);
    if (!r.ok) return r.error.category === "not_found" ? { ok: true, value: null } : r;
    return { ok: true, value: parseOrderDetail(r.value, orderId) };
  },

  async label(ctx, ref, format) {
    const formatsAvailable = ["thermal_4x6" as const];
    if (!formatsAvailable.includes(format as "thermal_4x6")) return { ok: true, value: { formatsAvailable } };
    const r = await call(ctx, `/get-order-label/${encodeURIComponent(ref.awb)}`, { timeoutMs: 20_000 });
    if (!r.ok) return r;
    const rows = Array.isArray(r.value.data) ? r.value.data : [r.value.data];
    const images = rows.map((x) => firstString(x, ["label", "image", "label_url"]) ?? "").filter(Boolean)
      .map((s) => (s.startsWith("data:") || s.startsWith("https:") ? s : `data:image/png;base64,${s}`));
    if (!images.length) return { ok: false, error: { category: "not_found", message: "Courier partner has not generated the label yet", retryable: true } };
    return { ok: true, value: { images, formatsAvailable } };
  },

  async schedulePickup(ctx, ref, date) {
    const r = await call(ctx, "/schedule-pickup", { method: "POST", body: JSON.stringify({ order_id: ref.providerOrderRef }) });
    if (!r.ok) return r;
    return { ok: true, value: { pickupRef: firstString(r.value.data, ["pickup_id", "pickup_reference", "awb_number"]) ?? undefined, scheduledFor: date } };
  },

  async track(ctx, awb) {
    const r = await call(ctx, `/track-order?awb_number=${encodeURIComponent(awb)}`);
    if (!r.ok) return r;
    const t = parseTrack(r.value, awb);
    if (!t.currentStatus && !t.events.length) return { ok: false, error: { category: "not_found", message: "No tracking data yet", retryable: true } };
    return { ok: true, value: { awb: t.awb, carrierName: t.carrierName, status: t.status, events: t.events, etaDate: t.etaDate } };
  },

  async cancel(ctx, ref) {
    if (!ref.awb) return { ok: false, error: { category: "validation", message: "No AWB to cancel", retryable: false } };
    const r = await call(ctx, "/cancel-order", { method: "POST", body: JSON.stringify({ order_id: ref.providerOrderRef, awb_number: /^\d+$/.test(ref.awb) ? Number(ref.awb) : ref.awb }) });
    if (!r.ok) return r;
    return { ok: true, value: { acknowledged: true } };
  },

  async ndrAction() { return unsupported("NDR action"); },
};

/** Request bodies the adapter sends for a quote (shared with Admin → Rate check's raw view). */
export function shipmozoQuoteBodies(ctx: ProviderContext, req: import("./types").QuoteRequest) {
  const service = ctx.config.service === "B2B" ? "B2B" : "B2C";
  const actualGrams = req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
  return {
    serviceability: { pickup_pincode: Number(req.originPincode), delivery_pincode: Number(req.destinationPincode) },
    rates: {
      order_id: "", pickup_pincode: Number(req.originPincode), delivery_pincode: Number(req.destinationPincode),
      payment_type: req.paymentType === "cod" ? "COD" : "PREPAID", shipment_type: req.direction === "reverse" ? "RETURN" : "FORWARD",
      // Shipmozo rejects order_amount 0 ("The selected order amount is invalid"); calculators without a declared value send ₹100.
      // Booking re-quotes with the real declared value, so any ROV difference is shown to the customer before charging.
      order_amount: rupees(req.declaredValue || req.codAmount || 10_000), type_of_package: String(ctx.config.typeOfPackage ?? (service === "B2B" ? "MPS" : "SPS")),
      rov_type: String(ctx.config.rovType ?? "ROV_OWNER"), cod_amount: req.paymentType === "cod" ? String(rupees(req.codAmount ?? 0)) : "",
      weight: actualGrams,
      dimensions: req.packages.map((p) => ({ no_of_box: String(p.count), length: String(Math.ceil(p.lengthMm / 10)), width: String(Math.ceil(p.breadthMm / 10)), height: String(Math.ceil(p.heightMm / 10)) })),
    },
  };
}

/** Raw responses for Admin → Rate check, so the field mapping can be confirmed. Keys travel only in headers, never in the stored text. */
export async function shipmozoRaw(ctx: ProviderContext, req: import("./types").QuoteRequest) {
  const b = shipmozoQuoteBodies(ctx, req);
  const svc = await call(ctx, "/pincode-serviceability", { method: "POST", body: JSON.stringify(b.serviceability) });
  const rates = await call(ctx, "/rate-calculator", { method: "POST", body: JSON.stringify(b.rates) });
  // courier "image" fields are short-lived signed URLs — not stored
  const show = (r: Result<Envelope>) => (r.ok ? JSON.stringify(r.value, (k, v) => (k === "image" ? undefined : v)) : `ERROR: ${r.error.message}`).slice(0, 6000);
  return { serviceability: show(svc), rates: show(rates) };
}
