import type { ProviderQuote, ProviderQuoteComponent } from "@/server/pricing/engine";
import { amountToPaise, firstString, jsonOrNull } from "./delhivery-common";
import { carrierFromName, mapShipmozoStatus } from "./shipmozo";
import { type BookResult, type ProviderContext, type Result, type ShippingAdapter, type TrackingEvent, unsupported } from "./types";

/**
 * Shiprocket (aggregator, B2C). Public API "Shiprocket API (apiv2)":
 *   Base    https://apiv2.shiprocket.in/v1/external
 *   Auth    POST /auth/login { email, password } of an *API user* (Settings → API → Create an API User; it must use an
 *           email different from the panel login) → { token } valid 240 h, sent as `Authorization: Bearer`.
 *   Rates   GET  /courier/serviceability/?pickup_postcode&delivery_postcode&weight(kg)&cod(0|1)&declared_value&length&breadth&height
 *           → data.available_courier_companies[{ courier_company_id, courier_name, rate, freight_charge, cod_charges,
 *              estimated_delivery_days, etd, charge_weight }]
 *   Book    POST /orders/create/adhoc → { order_id, shipment_id } · POST /courier/assign/awb { shipment_id, courier_id }
 *           → response.data.awb_code · POST /courier/generate/pickup { shipment_id: [id] }
 *   Label   POST /courier/generate/label { shipment_id: [id] } → { label_created, label_url (PDF) }
 *   Track   GET  /courier/track/awb/{awb} → tracking_data.shipment_track_activities[]
 *   Cancel  POST /orders/cancel { ids: [order_id] }
 *   Pickup addresses: GET /settings/company/pickup, POST /settings/company/addpickup (by nickname `pickup_location`).
 *
 * Response fields are read defensively; a rate is offered only with a positive charge and a courier id, and nothing
 * gets an invented AWB. Units: Vishwaship grams / mm / paise → Shiprocket kg / cm / rupees.
 * providerOrderRef = "<shiprocket order_id>/<shipment_id>" (both are needed later).
 */
export const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

const tokens = new Map<string, { token: string; exp: number; who: string }>();
/** Tests only. */
export const _resetShiprocketTokens = () => tokens.clear();

const fail = (category: "auth" | "validation" | "upstream" | "timeout" | "not_found" | "rate_limited" | "not_serviceable" | "ambiguous", message: string, retryable = false) =>
  ({ ok: false as const, error: { category, message: message.slice(0, 300), retryable } });

async function login(ctx: ProviderContext, force = false): Promise<Result<string>> {
  const email = ctx.secrets.email?.trim(), password = ctx.secrets.password;
  if (!email || !password) return fail("auth", "Courier partner API user email / password not configured");
  const key = `${ctx.accountId}:${ctx.mode}`;
  const hit = tokens.get(key);
  if (!force && hit && hit.who === email && hit.exp > Date.now()) return { ok: true, value: hit.token };
  let r: Response;
  try {
    r = await ctx.fetch(`${SHIPROCKET_BASE}/auth/login`, { method: "POST", timeoutMs: 15_000, headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email, password }) });
  } catch (e) { return fail("timeout", `Courier partner did not respond: ${(e as Error).message}`, true); }
  const j = (await jsonOrNull(r)) as Record<string, unknown> | null;
  const token = typeof j?.token === "string" ? j.token : null;
  if (!r.ok || !token) {
    if (r.status >= 500) return fail("upstream", `Courier partner login error HTTP ${r.status}`, true);
    if (r.status === 429) return fail("rate_limited", "Courier partner login rate limit reached — try again shortly", true);
    return fail("auth", `Courier partner rejected the API user login: ${srError(j) ?? `HTTP ${r.status}`}`);
  }
  // valid 240 h; refreshed after 9 days so a long booking never runs on an expiring token
  tokens.set(key, { token, exp: Date.now() + 9 * 24 * 3600_000, who: email });
  return { ok: true, value: token };
}

const srError = (j: unknown): string | null => {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const errs = o.errors && typeof o.errors === "object" ? Object.values(o.errors as Record<string, unknown>).flat().map(String).filter(Boolean) : [];
  return (errs[0] ?? firstString(o, ["message", "response.data", "error", "data.message"]) ?? null)?.slice(0, 240) ?? null;
};

async function call(ctx: ProviderContext, path: string, init: RequestInit & { timeoutMs?: number } = {}, retried = false): Promise<Result<Record<string, unknown>>> {
  const t = await login(ctx, retried);
  if (!t.ok) return t;
  let r: Response;
  try {
    r = await ctx.fetch(`${SHIPROCKET_BASE}${path}`, {
      timeoutMs: 15_000, ...init,
      headers: { authorization: `Bearer ${t.value}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
    });
  } catch (e) { return fail("timeout", `Courier partner did not respond: ${(e as Error).message}`, true); }
  const j = (await jsonOrNull(r)) as Record<string, unknown> | null;
  if (r.status === 401 && !retried) return call(ctx, path, init, true); // token revoked or expired early: log in again once
  if (r.status === 401 || r.status === 403) return fail("auth", `Courier partner rejected the API user: ${srError(j) ?? `HTTP ${r.status}`}`);
  if (r.status === 429) return fail("rate_limited", "Courier partner rate limit reached — try again shortly", true);
  if (r.status >= 500) return fail("upstream", `Courier partner error HTTP ${r.status}${srError(j) ? `: ${srError(j)}` : ""}`, true);
  if (!j || typeof j !== "object") return fail("upstream", `Courier partner returned an unreadable response (HTTP ${r.status})`, true);
  if (r.status === 404) return fail("not_found", srError(j) ?? "Not found");
  if (r.status >= 400) return fail("validation", srError(j) ?? `HTTP ${r.status}`);
  const code = Number(j.status_code ?? 0);
  if (code >= 400) return fail(code === 404 ? "not_found" : "validation", srError(j) ?? `status ${code}`);
  return { ok: true, value: j };
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[,₹\s]/g, "")) : NaN; return Number.isFinite(n) ? n : NaN; };
const rupees = (paise: number) => Math.round(paise) / 100;
const kg = (g: number) => Math.max(0.01, Math.round(g) / 1000);
const cm = (mm: number) => Math.max(1, Math.ceil(mm / 10));
const digits10 = (s: string) => s.replace(/\D/g, "").slice(-10);
const clean = (s: string | null | undefined, max = 190) => String(s ?? "").replace(/[<>"`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const istStamp = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
export const srRef = (orderId: string | number, shipmentId: string | number) => `${orderId}/${shipmentId}`;
export const parseRef = (ref: string) => { const [orderId, shipmentId] = String(ref ?? "").split("/"); return { orderId: orderId || null, shipmentId: shipmentId || null }; };
/** Pickup nickname on the Shiprocket account (letters/digits only, ≤ 36). */
export const srPickupName = (code: string) => `VS${code}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 36);

/** One courier from serviceability → priced quote. GST basis from config.gstTreatment (default exclusive: GST is added on top). */
export function parseCourier(row: Record<string, unknown>, ctx: { cod: boolean; gstTreatment: string; actualGrams: number }): { quote: ProviderQuote; courierId: string } | { error: string } {
  const courierId = firstString(row, ["courier_company_id", "id", "courier_id"]);
  const name = firstString(row, ["courier_name", "name"]) ?? "";
  if (!courierId) return { error: `${name || "A courier"} has no courier_company_id` };
  const total = num(row.rate ?? row.total_charge ?? row.total);
  const cod = ctx.cod ? num(row.cod_charges) : 0;
  if (!(total > 0)) return { error: `${name || courierId}: no positive rate` };
  const inclusive = ctx.gstTreatment === "inclusive";
  let components: ProviderQuoteComponent[] = [{ code: "freight", label: "Freight & surcharges", amount: amountToPaise(total) }];
  if (cod > 0 && cod < total) components = [{ code: "freight", label: "Freight & surcharges", amount: amountToPaise(total) - amountToPaise(cod) }, { code: "cod_fee", label: "COD charge", amount: amountToPaise(cod) }];
  const etaN = num(row.estimated_delivery_days);
  const etd = firstString(row, ["etd"]);
  const etaDays = etaN > 0 && etaN < 60 ? Math.round(etaN) : etd && !Number.isNaN(new Date(etd).getTime()) ? Math.max(1, Math.ceil((new Date(etd).getTime() - Date.now()) / 86400_000)) : undefined;
  const cwKg = num(row.charge_weight);
  const carrier = carrierFromName(name);
  return {
    courierId,
    quote: {
      provider: "shiprocket", carrierCode: carrier.code.replace(/^sm-/, "sr-"), carrierName: carrier.name, serviceName: name || carrier.name, mode: "B2C", etaDays,
      components, taxInclusive: inclusive, taxRateBps: 1800, chargeableWeightGrams: Math.max(cwKg > 0 ? Math.round(cwKg * 1000) : 0, ctx.actualGrams),
      providerQuoteRef: `shiprocket:${courierId}`,
    },
  };
}

export function shiprocketQuoteQuery(req: import("./types").QuoteRequest) {
  const grams = req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
  const big = [...req.packages].sort((a, b) => b.lengthMm * b.breadthMm * b.heightMm - a.lengthMm * a.breadthMm * a.heightMm)[0];
  const q = new URLSearchParams({
    pickup_postcode: req.originPincode, delivery_postcode: req.destinationPincode, weight: String(kg(grams)), cod: req.paymentType === "cod" ? "1" : "0",
    declared_value: String(rupees(req.declaredValue || req.codAmount || 10_000)), is_return: req.direction === "reverse" ? "1" : "0",
    ...(big ? { length: String(cm(big.lengthMm)), breadth: String(cm(big.breadthMm)), height: String(cm(big.heightMm)) } : {}),
  });
  return { query: q.toString(), grams };
}

export function parseTrack(j: Record<string, unknown>, awb: string) {
  const td = (j.tracking_data ?? j) as Record<string, unknown>;
  const acts = (Array.isArray(td.shipment_track_activities) ? td.shipment_track_activities : []) as Array<Record<string, unknown>>;
  const at = (t: string | null) => {
    if (!t) return null;
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.replace(" ", "T")}+05:30`; // Shiprocket times are IST
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  };
  const events: TrackingEvent[] = [];
  for (const a of acts) {
    const raw = firstString(a, ["sr-status-label", "activity", "status"]) ?? "";
    const when = at(firstString(a, ["date"]));
    if (!raw || !when) continue;
    const activity = firstString(a, ["activity"]) ?? undefined;
    events.push({ status: mapShipmozoStatus(raw), rawStatus: raw.slice(0, 200), location: firstString(a, ["location"]) ?? undefined, occurredAt: when, remark: activity && activity !== raw ? activity.slice(0, 200) : undefined });
  }
  const track0 = (Array.isArray(td.shipment_track) ? td.shipment_track[0] : null) as Record<string, unknown> | null;
  const current = firstString(track0, ["current_status"]) ?? "";
  const eta = firstString(td, ["etd"]) ?? firstString(track0, ["edd"]);
  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const status = current ? mapShipmozoStatus(current) : events.at(-1)?.status ?? "booked";
  return { awb: firstString(track0, ["awb_code"]) ?? awb, carrierName: firstString(track0, ["courier_name"]) ?? "Courier", status, events, etaDate: eta && !Number.isNaN(new Date(eta).getTime()) ? new Date(eta).toISOString() : undefined, current };
}

/** The AWB of a Shiprocket order (orders/show), if one is assigned. */
function bookingFromOrder(o: Record<string, unknown>): BookResult | null {
  const d = (o.data ?? o) as Record<string, unknown>;
  const shipments = d.shipments;
  const sh = (Array.isArray(shipments) ? shipments[0] : shipments) as Record<string, unknown> | undefined;
  const orderId = firstString(d, ["id", "order_id"]);
  const shipmentId = firstString(sh, ["id", "shipment_id"]) ?? firstString(d, ["shipment_id"]);
  if (!orderId || !shipmentId) return null;
  const status = (firstString(d, ["status"]) ?? "").toUpperCase();
  if (/CANCEL/.test(status)) return null;
  const awb = firstString(sh, ["awb", "awb_code"]) ?? firstString(d, ["awb_data.awb", "awb_code"]);
  return { providerOrderRef: srRef(orderId, shipmentId), awb: awb || null, lrNumber: null, state: awb ? "confirmed" : "pending_async", labelAvailable: !!awb };
}

export const shiprocketAdapter: ShippingAdapter = {
  key: "shiprocket",
  displayName: "Shiprocket",
  implemented: ["authenticate", "health", "warehouse_sync", "serviceability", "quote", "book", "booking_lookup", "label", "pickup", "track", "cancel"],
  paymentModes: ["prepaid", "cod"],
  pickupScope: "shipment",

  async health(ctx) {
    const r = await call(ctx, "/settings/company/pickup", { timeoutMs: 10_000 });
    if (!r.ok) return r;
    const list = (r.value.data as Record<string, unknown> | undefined)?.shipping_address;
    const n = Array.isArray(list) ? list.length : 0;
    return { ok: true, value: { message: `Courier partner API user accepted (${n} pickup address${n === 1 ? "" : "es"} on the account)` } };
  },

  async quote(ctx, req) {
    if (req.mode !== "B2C" || req.paymentType === "fod") return { ok: true, value: [] };
    if (req.packages.reduce((t, p) => t + p.count, 0) > 1) return { ok: true, value: [] }; // one parcel per order on this route
    const { query, grams } = shiprocketQuoteQuery(req);
    const r = await call(ctx, `/courier/serviceability/?${query}`);
    if (!r.ok) return r.error.category === "not_found" ? fail("not_serviceable", `No courier from ${req.originPincode} to ${req.destinationPincode}`) : r;
    const rows = ((r.value.data as Record<string, unknown> | undefined)?.available_courier_companies ?? []) as Array<Record<string, unknown>>;
    const allow = new Set(((ctx.config.courierIds as string[] | undefined) ?? []).map(String).filter(Boolean));
    const quotes: ProviderQuote[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row && (row.blocked === 1 || row.blocked === true)) continue;
      const p = parseCourier(row, { cod: req.paymentType === "cod", gstTreatment: String(ctx.config.gstTreatment ?? "exclusive"), actualGrams: grams });
      if ("error" in p) { skipped.push(p.error); continue; }
      if ((allow.size && !allow.has(p.courierId)) || seen.has(p.courierId)) continue;
      seen.add(p.courierId);
      quotes.push(p.quote);
    }
    if (!quotes.length) return fail(skipped.length ? "upstream" : "not_serviceable", skipped.length ? `Courier partner rate could not be verified: ${skipped[0]}` : `Courier partner has no courier from ${req.originPincode} to ${req.destinationPincode} for this shipment`);
    return { ok: true, value: quotes };
  },

  async registerWarehouse(ctx, w) {
    const name = srPickupName(w.code);
    const list = await call(ctx, "/settings/company/pickup");
    if (!list.ok) return list;
    const rows = ((list.value.data as Record<string, unknown> | undefined)?.shipping_address ?? []) as Array<Record<string, unknown>>;
    const list2 = Array.isArray(rows) ? rows : [];
    if (list2.some((x) => String(x.pickup_location ?? "") === name)) return { ok: true, value: { ref: name } };
    // The owner adds (and OTP-verifies) pickup addresses in the Shiprocket panel: reuse one only when BOTH the PIN code
    // and the contact mobile match this warehouse — never another customer's address at the same PIN.
    const samePin = list2.filter((x) => String(x.pin_code ?? "").trim() === w.pincode && digits10(String(x.phone ?? "")) === digits10(w.mobile) && x.pickup_location);
    const pick = samePin.find((x) => Number(x.status ?? 2) === 2 || x.phone_verified === 1) ?? samePin[0];
    if (pick) return { ok: true, value: { ref: String(pick.pickup_location) } };
    const line1 = clean(w.line1, 80);
    const add = await call(ctx, "/settings/company/addpickup", {
      method: "POST",
      body: JSON.stringify({
        pickup_location: name, name: clean(w.contactName, 60), email: w.email ?? "", phone: digits10(w.mobile),
        // Shiprocket wants address line 1 of at least 10 characters with a house / flat number
        address: line1.length >= 10 ? line1 : `${line1}, ${clean(w.line2, 60)}`.slice(0, 80), address_2: clean(w.line2, 80),
        city: clean(w.city, 40), state: clean(w.state, 40), country: "India", pin_code: w.pincode,
      }),
    });
    if (!add.ok) return /already|exist/i.test(add.error.message) ? { ok: true, value: { ref: name } } : add;
    return { ok: true, value: { ref: name } };
  },

  async book(ctx, req) {
    const [kind, courierId] = (req.quote.providerQuoteRef ?? "").split(":");
    if (kind !== "shiprocket" || !courierId) return fail("validation", "This quote has no Courier partner courier id — refresh rates");
    if (!req.pickup.providerWarehouseRef) return fail("validation", "Pickup address is not registered with the courier partner");
    if (req.packages.reduce((t, p) => t + p.count, 0) > 1) return fail("validation", "This courier partner books one package per order");
    const p = req.packages[0];
    const items = req.products.length ? req.products : [{ name: "Goods", qty: 1, unitPrice: req.declaredValue }];
    const [first, ...rest] = clean(req.consignee.name, 80).split(" ");
    const create = await call(ctx, "/orders/create/adhoc", {
      method: "POST", timeoutMs: 25_000,
      body: JSON.stringify({
        order_id: req.vishwashipOrderId, order_date: istStamp(), pickup_location: req.pickup.providerWarehouseRef,
        billing_customer_name: first || "Customer", billing_last_name: rest.join(" "), billing_address: clean(req.consignee.line1), billing_address_2: clean(req.consignee.line2),
        billing_city: clean(req.consignee.city, 60), billing_pincode: req.consignee.pincode, billing_state: clean(req.consignee.state, 60), billing_country: "India",
        billing_email: req.consignee.email ?? "", billing_phone: digits10(req.consignee.mobile), shipping_is_billing: true,
        order_items: items.map((x) => ({ name: clean(x.name, 100) || "Goods", sku: clean(x.sku ?? "", 40) || clean(x.name, 40) || "item", units: x.qty, selling_price: rupees(x.unitPrice), hsn: x.hsn ?? "" })),
        payment_method: req.paymentType === "cod" ? "COD" : "Prepaid", sub_total: rupees(req.paymentType === "cod" ? req.codAmount : req.declaredValue),
        length: cm(p.lengthMm), breadth: cm(p.breadthMm), height: cm(p.heightMm), weight: kg(p.actualWeightGrams),
        ...(req.ewayBill ? { ewaybill_no: req.ewayBill } : {}),
      }),
    });
    if (!create.ok) return create.error.category === "timeout" || create.error.category === "upstream" ? { ok: false, error: { ...create.error, category: "ambiguous" } } : create;
    const orderId = firstString(create.value, ["order_id"]);
    const shipmentId = firstString(create.value, ["shipment_id"]);
    if (!orderId || !shipmentId) return fail("ambiguous", "Courier partner accepted the order but returned no shipment id", true);
    const ref = srRef(orderId, shipmentId);

    const assign = await call(ctx, "/courier/assign/awb", { method: "POST", timeoutMs: 25_000, body: JSON.stringify({ shipment_id: Number(shipmentId) || shipmentId, courier_id: Number(courierId) || courierId }) });
    let awb: string | null = null;
    if (assign.ok) {
      awb = firstString(assign.value, ["response.data.awb_code", "awb_code"]);
      if (!awb && Number(assign.value.awb_assign_status) === 0) {
        // not assigned (e.g. low Shiprocket wallet): cancel the empty order so nothing is left behind
        await call(ctx, "/orders/cancel", { method: "POST", body: JSON.stringify({ ids: [Number(orderId) || orderId] }) });
        return fail("validation", `Courier partner could not assign this courier: ${srError(assign.value) ?? firstString(assign.value, ["response.data.awb_assign_error"]) ?? "no AWB"}`);
      }
    } else if (assign.error.category === "timeout" || assign.error.category === "upstream") {
      return { ok: false, error: { ...assign.error, category: "ambiguous", message: `${assign.error.message} (courier partner order ${orderId})` } };
    } else if (!/already/i.test(assign.error.message)) {
      await call(ctx, "/orders/cancel", { method: "POST", body: JSON.stringify({ ids: [Number(orderId) || orderId] }) });
      return assign;
    }
    if (!awb) {
      const show = await call(ctx, `/orders/show/${encodeURIComponent(orderId)}`);
      if (show.ok) awb = bookingFromOrder(show.value)?.awb ?? null;
    }
    let pickupRef: string | undefined;
    if (awb && ctx.config.autoPickup !== false) {
      const pk = await call(ctx, "/courier/generate/pickup", { method: "POST", timeoutMs: 20_000, body: JSON.stringify({ shipment_id: [Number(shipmentId) || shipmentId] }) });
      if (pk.ok) pickupRef = firstString(pk.value, ["response.pickup_token_number", "pickup_token_number"]) ?? "scheduled";
    }
    return { ok: true, value: { providerOrderRef: ref, awb, lrNumber: null, state: awb ? "confirmed" : "pending_async", labelAvailable: !!awb, pickupRef, pickupScheduled: !!pickupRef } };
  },

  async lookupBooking(ctx, ref) {
    const { orderId } = parseRef(ref.providerOrderRef ?? "");
    if (orderId) {
      const r = await call(ctx, `/orders/show/${encodeURIComponent(orderId)}`);
      if (!r.ok) return r.error.category === "not_found" ? { ok: true, value: null } : r;
      return { ok: true, value: bookingFromOrder(r.value) };
    }
    // order id not known (the create call timed out): find it by our own order id
    const r = await call(ctx, `/orders?search=${encodeURIComponent(ref.vishwashipOrderId)}`);
    if (!r.ok) return r;
    const rows = (Array.isArray(r.value.data) ? r.value.data : []) as Array<Record<string, unknown>>;
    const hit = rows.find((x) => String(x.channel_order_id ?? "") === ref.vishwashipOrderId);
    return { ok: true, value: hit ? bookingFromOrder(hit) : null };
  },

  async label(ctx, ref, format) {
    const formatsAvailable = ["thermal_4x6" as const];
    if (format !== "thermal_4x6") return { ok: true, value: { formatsAvailable } };
    const { shipmentId } = parseRef(ref.providerOrderRef);
    if (!shipmentId) return fail("validation", "Courier partner shipment id not known for this booking");
    const r = await call(ctx, "/courier/generate/label", { method: "POST", timeoutMs: 20_000, body: JSON.stringify({ shipment_id: [Number(shipmentId) || shipmentId] }) });
    if (!r.ok) return r;
    const url = firstString(r.value, ["label_url"]);
    if (!url || !url.startsWith("https://")) return fail("not_found", "Courier partner has not generated the label yet", true);
    return { ok: true, value: { url, formatsAvailable } };
  },

  async schedulePickup(ctx, ref, date) {
    const { shipmentId } = parseRef(ref.providerOrderRef);
    if (!shipmentId) return fail("validation", "Courier partner shipment id not known for this booking");
    const r = await call(ctx, "/courier/generate/pickup", { method: "POST", body: JSON.stringify({ shipment_id: [Number(shipmentId) || shipmentId] }) });
    if (!r.ok && !/already/i.test(r.error.message)) return r;
    return { ok: true, value: { pickupRef: r.ok ? firstString(r.value, ["response.pickup_token_number"]) ?? undefined : undefined, scheduledFor: date } };
  },

  async track(ctx, awb) {
    const r = await call(ctx, `/courier/track/awb/${encodeURIComponent(awb)}`);
    if (!r.ok) return r;
    const t = parseTrack(r.value, awb);
    if (!t.current && !t.events.length) return fail("not_found", "No tracking data yet", true);
    return { ok: true, value: { awb: t.awb, carrierName: t.carrierName, status: t.status, events: t.events, etaDate: t.etaDate } };
  },

  async cancel(ctx, ref) {
    const { orderId } = parseRef(ref.providerOrderRef);
    if (!orderId) return fail("validation", "Courier partner order id not known for this booking");
    const r = await call(ctx, "/orders/cancel", { method: "POST", body: JSON.stringify({ ids: [Number(orderId) || orderId] }) });
    if (!r.ok) return r;
    return { ok: true, value: { acknowledged: true } };
  },

  async ndrAction() { return unsupported("NDR action"); },
};

/** Raw serviceability response for Admin → Rate check (the token travels only in the header). */
export async function shiprocketRaw(ctx: ProviderContext, req: import("./types").QuoteRequest) {
  const r = await call(ctx, `/courier/serviceability/?${shiprocketQuoteQuery(req).query}`);
  return { rates: (r.ok ? JSON.stringify(r.value) : `ERROR: ${r.error.message}`).slice(0, 6000) };
}
