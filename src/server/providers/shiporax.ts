import type { ProviderQuote } from "@/server/pricing/engine";
import { amountToPaise, firstString, jsonOrNull } from "./delhivery-common";
import { carrierFromName } from "./shipmozo";
import { type NormalizedStatus, type ProviderContext, type PushedUpdate, type Result, type ShippingAdapter, type TrackingEvent, unsupported } from "./types";

/**
 * Shipora X (aggregator), https://shiporax.com — header `X-Api-Key`, JSON envelope { success, message, data }.
 * Verified against the live account on 2026-11-18 (read-only calls):
 *   GET  /api/couriers                → data.couriers[{ id, name, supports_cod, min_weight, max_weight }]
 *   POST /api/orders/calc-rate        { weight (kg), pickup_pincode, delivery_pincode, length, breadth, height (cm) }
 *                                     → data.rates[{ courierId, courierName, base_rate, fuel_surcharge, shippingCost, codCharge,
 *                                        total, chargeableWeight (kg), estimatedDays "3-5", rateId }]
 *   POST /api/orders/webhook/import   requires customer_name, customer_phone (other fields not documented yet)
 *   PATCH /api/orders/:id/ship        requires courierId (order ids are UUIDs)
 *   GET  /api/orders/track-by-awb/:awb, GET /api/orders/:id/label, GET /api/ndr
 * Tracking push (supplied by the owner): { waybillDetails: { waybill, currentStatus, statusDate }, Status: "SUCCESS" }
 *   currentStatus: IN_TRANSIT | DELIVERED | RTO | RETURN_RECEIVED. Authenticated by our own secret token in the URL.
 *
 * Not yet known, so not built: the order-create body, the ship / label / track response shapes, how COD charges
 * are quoted (codCharge stayed 0 for every COD form tried) and whether `total` includes GST (no GST field).
 */
const DEFAULT_BASE = "https://shiporax.com";
const base = (ctx: ProviderContext) => {
  const b = ctx.config.baseUrl as Record<string, string> | undefined;
  return (b?.[ctx.mode] || DEFAULT_BASE).replace(/\/+$/, "");
};
type Env = { success?: boolean; message?: string; data?: unknown };

async function call(ctx: ProviderContext, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Result<Env>> {
  if (!ctx.secrets.apiKey) return { ok: false, error: { category: "auth", message: "Shipora X API key not configured", retryable: false } };
  let r: Response;
  try {
    r = await ctx.fetch(`${base(ctx)}${path}`, { timeoutMs: 15_000, ...init, headers: { "X-Api-Key": ctx.secrets.apiKey, "content-type": "application/json", accept: "application/json" } });
  } catch (e) { return { ok: false, error: { category: "timeout", message: `Shipora X did not respond: ${(e as Error).message}`.slice(0, 200), retryable: true } }; }
  const j = (await jsonOrNull(r)) as Env | null;
  if (r.status === 401 || r.status === 403) return { ok: false, error: { category: "auth", message: "Shipora X rejected the API key", retryable: false } };
  if (r.status === 429) return { ok: false, error: { category: "rate_limited", message: "Shipora X rate limit reached", retryable: true } };
  if (r.status >= 500) return { ok: false, error: { category: "upstream", message: `Shipora X error HTTP ${r.status}`, retryable: true } };
  if (!j || j.success !== true) return { ok: false, error: { category: r.status === 404 ? "not_found" : "validation", message: String(j?.message ?? `HTTP ${r.status}`).slice(0, 240), retryable: false } };
  return { ok: true, value: j };
}

const digits10 = (s: string) => s.replace(/\D/g, "").slice(-10);
const awbOf = (d: Record<string, unknown>) => firstString(d, ["awbNumber", "awb_number"]);

async function getOrder(ctx: ProviderContext, id: string): Promise<Result<Record<string, unknown>>> {
  const r = await call(ctx, `/api/orders/${encodeURIComponent(id)}`);
  return r.ok ? { ok: true, value: (r.value.data ?? {}) as Record<string, unknown> } : r;
}

/** Find an order we created earlier by our reference (stored in product_sku), newest first. */
async function findByRef(ctx: ProviderContext, ref: string): Promise<Result<Record<string, unknown> | null>> {
  const r = await call(ctx, "/api/orders?limit=100");
  if (!r.ok) return r;
  const list = (((r.value.data as { orders?: unknown[] })?.orders ?? []) as Array<Record<string, unknown>>);
  return { ok: true, value: list.find((o) => String(o.product_sku ?? "") === ref && o.status !== "cancelled") ?? null };
}

function toBooking(d: Record<string, unknown>) {
  if (d.status === "cancelled") return null;
  const awb = awbOf(d);
  // Imported but never shipped (no courier): nothing will move, so it counts as not booked.
  if (!awb && !d.assignedCourier && !d.courier_name) return null;
  return { providerOrderRef: String(d.id), awb, state: awb ? "confirmed" as const : "pending_async" as const, labelAvailable: !!awb };
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,₹\s]/g, "")); return Number.isFinite(n) ? n : NaN; };

/** One calc-rate row → provider quote (paise). Comparable rate = `total` (base + fuel + COD charge). */
export function parseShiporaRate(row: Record<string, unknown>, opts: { mode: "B2C" | "B2B"; gstTreatment: string; actualGrams: number }): ProviderQuote | { error: string } {
  const id = firstString(row, ["courierId", "courier_id", "id"]);
  const name = firstString(row, ["courierName", "courier_name", "name"]) ?? "";
  if (!id) return { error: `${name || "A courier"} has no courierId` };
  const base_ = num(row.base_rate), fuel = num(row.fuel_surcharge), cod = num(row.codCharge), total = num(row.total ?? row.shippingCost);
  if (!(total > 0)) return { error: `${name}: no positive rate` };
  if (opts.gstTreatment !== "inclusive" && opts.gstTreatment !== "exclusive") return { error: `${name}: GST basis not set — choose it under Service settings` };
  const comps = [] as ProviderQuote["components"];
  if (base_ > 0) comps.push({ code: "freight", label: "Shipping charges", amount: amountToPaise(base_) });
  if (fuel > 0) comps.push({ code: "fuel", label: "Fuel surcharge", amount: amountToPaise(fuel) });
  if (cod > 0) comps.push({ code: "cod_fee", label: "COD charge", amount: amountToPaise(cod) });
  const sum = comps.reduce((t, c) => t + c.amount, 0);
  if (sum !== amountToPaise(total)) { comps.length = 0; comps.push({ code: "freight", label: "Shipping charges", amount: amountToPaise(total) }); }
  const eta = Number((String(row.estimatedDays ?? row.estimated_days ?? "").match(/\d+/g) ?? []).pop()); // "3-5" → 5 (upper bound)
  const cwKg = num(row.chargeableWeight ?? row.billingWeight);
  const carrier = carrierFromName(name);
  return {
    provider: "shiporax", carrierCode: carrier.code, carrierName: carrier.name, serviceName: name, mode: opts.mode,
    etaDays: eta > 0 && eta < 60 ? eta : undefined, components: comps, taxInclusive: opts.gstTreatment === "inclusive", taxRateBps: 1800,
    chargeableWeightGrams: Math.max(cwKg > 0 ? Math.round(cwKg * 1000) : 0, opts.actualGrams),
    providerQuoteRef: `shiporax:${id}:${firstString(row, ["rateId"]) ?? ""}`,
  };
}

/** Shipora X status text → Vishwaship status. Unknown text never implies pickup. */
export function mapShiporaStatus(raw: string): NormalizedStatus {
  const s = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (s.includes("CANCEL")) return "cancelled";
  if (s === "RETURN_RECEIVED" || s.includes("RTO_DELIVERED")) return "rto_delivered";
  if (s.startsWith("RTO") || s.includes("RETURN")) return "rto_in_transit";
  if (s.includes("OUT_FOR_DELIVERY") || s === "OFD") return "out_for_delivery";
  if (s.includes("UNDELIVERED") || s.includes("NDR")) return "ndr";
  if (s.includes("DELIVERED")) return "delivered";
  if (s.includes("PICKED")) return "picked_up";
  if (s.includes("PICKUP") || s.includes("NOT_PICKED")) return "pickup_pending";
  if (s.includes("TRANSIT") || s.includes("SHIPPED") || s.includes("DISPATCH")) return "in_transit";
  if (s.includes("LOST")) return "lost";
  return "booked";
}

/** Shipora X statusDate "2026-07-14 14:30:00" is IST. */
const istIso = (t: string) => { const ms = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.trim().replace(" ", "T")}+05:30`).getTime(); return Number.isNaN(ms) ? null : new Date(ms).toISOString(); };

export function parseShiporaWebhook(body: unknown): Result<PushedUpdate[]> {
  const list = Array.isArray(body) ? body : [body];
  const out: PushedUpdate[] = [];
  for (const b of list) {
    const w = (b as { waybillDetails?: Record<string, unknown> })?.waybillDetails;
    const awb = String(w?.waybill ?? "").trim(), st = String(w?.currentStatus ?? "").trim(), at = istIso(String(w?.statusDate ?? ""));
    if (!awb || !st || !at) continue;
    out.push({ awb, events: [{ status: mapShiporaStatus(st), rawStatus: st, occurredAt: at }] });
  }
  return out.length ? { ok: true, value: out } : { ok: false, error: { category: "validation", message: "Expected waybillDetails.waybill, currentStatus and statusDate", retryable: false } };
}

export const shiporaAdapter: ShippingAdapter = {
  key: "shiporax",
  displayName: "Shipora X",
  implemented: ["authenticate", "health", "warehouse_sync", "quote", "serviceability", "book", "booking_lookup", "label", "track", "cancel", "inbound_events"],
  // COD stays off until Shipora X confirms how its COD charge is quoted (codCharge was 0 for every COD request tried).
  paymentModes: ["prepaid"],

  async health(ctx) {
    const r = await call(ctx, "/api/couriers", { timeoutMs: 10_000 });
    if (!r.ok) return r;
    const n = ((r.value.data as { couriers?: unknown[] })?.couriers ?? []).length;
    return { ok: true, value: { message: `Shipora X API key accepted (${n} couriers on the account)` } };
  },

  async quote(ctx, req) {
    const service = ctx.config.service === "B2B" ? "B2B" : "B2C";
    if (req.mode !== service || req.paymentType === "fod") return { ok: true, value: [] };
    if (req.packages.reduce((t, p) => t + p.count, 0) !== 1) return { ok: false, error: { category: "unsupported", message: "Shipora X quotes single-package shipments", retryable: false } };
    const p = req.packages[0];
    const actualGrams = p.actualWeightGrams;
    const body = {
      weight: actualGrams / 1000, pickup_pincode: req.originPincode, delivery_pincode: req.destinationPincode,
      length: Math.ceil(p.lengthMm / 10), breadth: Math.ceil(p.breadthMm / 10), height: Math.ceil(p.heightMm / 10),
      payment_mode: req.paymentType === "cod" ? "cod" : "prepaid", cod_amount: req.paymentType === "cod" ? (req.codAmount ?? 0) / 100 : 0,
      order_value: (req.declaredValue ?? 0) / 100,
    };
    const r = await call(ctx, "/api/orders/calc-rate", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return r;
    const rows = ((r.value.data as { rates?: unknown[] })?.rates ?? []) as Record<string, unknown>[];
    const allow = new Set(((ctx.config.courierIds as string[] | undefined) ?? []).map(String));
    const quotes: ProviderQuote[] = []; const skipped: string[] = [];
    for (const row of rows) {
      if (req.paymentType === "cod" && row.supportsCod === false) continue;
      const q = parseShiporaRate(row, { mode: service, gstTreatment: String(ctx.config.gstTreatment ?? ""), actualGrams });
      if ("error" in q) { skipped.push(q.error); continue; }
      if (allow.size && !allow.has(q.providerQuoteRef!.split(":")[1])) continue;
      quotes.push(q);
    }
    if (!quotes.length) return { ok: false, error: { category: skipped.length ? "upstream" : "not_serviceable", message: skipped[0] ?? "Shipora X returned no courier for this shipment", retryable: false } };
    return { ok: true, value: quotes };
  },

  /** Map a Vishwaship pickup address to a Shipora X warehouse (same PIN + phone, else same title, else create). */
  async registerWarehouse(ctx, w) {
    const list = await call(ctx, "/api/warehouses");
    if (!list.ok) return list;
    const all = (((list.value.data as { warehouses?: unknown[] })?.warehouses ?? []) as Array<Record<string, unknown>>).filter((x) => x.is_active !== false);
    const phone = digits10(w.mobile);
    const title = `VS-${w.code}`.slice(0, 60);
    const hit = all.find((x) => String(x.pincode) === w.pincode && digits10(String(x.phone ?? "")) === phone) ?? all.find((x) => String(x.name ?? "") === title);
    if (hit?.id) return { ok: true, value: { ref: String(hit.id) } };
    const r = await call(ctx, "/api/warehouses", { method: "POST", body: JSON.stringify({ name: title, contact_name: w.contactName, phone, email: w.email ?? "", address: [w.line1, w.line2].filter(Boolean).join(", "), city: w.city, state: w.state, pincode: w.pincode }) });
    if (!r.ok) return r;
    const id = firstString(r.value.data, ["warehouse.id", "id", "warehouseId", "warehouse_id"]);
    return id ? { ok: true, value: { ref: id } } : { ok: false, error: { category: "upstream", message: "Shipora X created the warehouse but returned no id", retryable: true } };
  },

  /**
   * import order → read it back and check address + pickup warehouse were stored (fix with PATCH if not) →
   * ship with the quoted courierId (this is the step that charges) → read back the AWB.
   * product_sku carries the Vishwaship order id so an uncertain attempt can be found again before any retry.
   */
  async book(ctx, req) {
    const [kind, courierId, rateId] = (req.quote.providerQuoteRef ?? "").split(":");
    if (kind !== "shiporax" || !courierId) return { ok: false, error: { category: "validation", message: "This quote has no Shipora X courierId — refresh rates", retryable: false } };
    if (!req.pickup.providerWarehouseRef) return { ok: false, error: { category: "validation", message: "Pickup address is not mapped to a Shipora X warehouse", retryable: false } };
    if (req.packages.reduce((t, p) => t + p.count, 0) !== 1) return { ok: false, error: { category: "validation", message: "Shipora X books one package per order", retryable: false } };
    if (req.paymentType !== "prepaid") return { ok: false, error: { category: "unsupported", message: "Shipora X COD is not enabled yet", retryable: false } };
    const existing = await findByRef(ctx, req.vishwashipOrderId);
    if (!existing.ok) return existing;
    let orderId = existing.value ? String(existing.value.id) : "";
    const p = req.packages[0];
    const c = req.consignee;
    const address = [c.line1, c.line2].filter(Boolean).join(", ");
    const product = req.products[0]?.name?.slice(0, 100) || "Goods";
    const fields = {
      customer_name: c.name, customer_phone: digits10(c.mobile), customer_email: c.email ?? "",
      customer_address: address, customer_city: c.city, customer_state: c.state, customer_pincode: c.pincode, delivery_pincode: c.pincode,
      weight: p.actualWeightGrams / 1000, length: Math.ceil(p.lengthMm / 10), breadth: Math.ceil(p.breadthMm / 10), height: Math.ceil(p.heightMm / 10),
      payment_mode: "prepaid", cod_amount: 0, product_name: product, product_sku: req.vishwashipOrderId,
      quantity: req.products.reduce((t, x) => t + x.qty, 0) || 1, product_value: req.declaredValue / 100, total_amount: req.declaredValue / 100,
      warehouse_id: req.pickup.providerWarehouseRef, pickup_pincode: req.pickup.pincode, channel_order_id: req.orderNumber,
    };
    if (!orderId) {
      const imp = await call(ctx, "/api/orders/webhook/import", { method: "POST", timeoutMs: 25_000, body: JSON.stringify(fields) });
      if (!imp.ok) return imp.error.category === "timeout" || imp.error.category === "upstream" ? { ok: false, error: { ...imp.error, category: "ambiguous" } } : imp;
      orderId = firstString(imp.value, ["data.orderId", "orderId", "data.id"]) ?? "";
      if (!orderId) return { ok: false, error: { category: "ambiguous", message: "Shipora X imported the order but returned no order id", retryable: false } };
    }
    // Read back: Shipora X ignores unknown import fields, so confirm the address and pickup warehouse stuck.
    let det = await getOrder(ctx, orderId);
    if (!det.ok) return { ok: false, error: { ...det.error, category: "ambiguous" } };
    const bad = (d: Record<string, unknown>) => {
      const rec = (d.recipient ?? {}) as Record<string, unknown>;
      const wh = (d.warehouse as Record<string, unknown> | null)?.id ?? d.warehouse_id;
      return !rec.address || !rec.city || String(rec.pincode ?? "") !== c.pincode || String(wh ?? "") !== req.pickup.providerWarehouseRef;
    };
    if (bad(det.value)) {
      await call(ctx, `/api/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(fields) });
      det = await getOrder(ctx, orderId);
      if (!det.ok) return { ok: false, error: { ...det.error, category: "ambiguous" } };
      if (bad(det.value)) {
        await call(ctx, `/api/orders/${orderId}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Vishwaship: address or pickup warehouse not stored" }) });
        return { ok: false, error: { category: "validation", message: "Shipora X did not store the delivery address or pickup warehouse — booking stopped before any charge", retryable: false } };
      }
    }
    if (!awbOf(det.value)) {
      const ship = await call(ctx, `/api/orders/${orderId}/ship`, { method: "PATCH", timeoutMs: 30_000, body: JSON.stringify({ courierId, ...(rateId ? { rateId } : {}) }) });
      if (!ship.ok) return ship.error.category === "validation" || ship.error.category === "auth" ? ship : { ok: false, error: { ...ship.error, category: "ambiguous" } };
      const fromShip = firstString(ship.value, ["data.awbNumber", "data.awb_number", "data.awb", "awbNumber", "awb_number", "data.order.awb_number"]);
      det = await getOrder(ctx, orderId);
      if (det.ok && !awbOf(det.value) && fromShip) det.value.awb_number = fromShip;
    }
    const awb = det.ok ? awbOf(det.value) : null;
    return { ok: true, value: { providerOrderRef: orderId, awb, state: awb ? "confirmed" : "pending_async", labelAvailable: !!awb, pickupScheduled: !!awb } };
  },

  async lookupBooking(ctx, ref) {
    if (ref.providerOrderRef && /^[0-9a-f-]{36}$/i.test(ref.providerOrderRef)) {
      const d = await getOrder(ctx, ref.providerOrderRef);
      if (!d.ok) return d.error.category === "not_found" ? { ok: true, value: null } : d;
      return { ok: true, value: toBooking(d.value) };
    }
    const f = await findByRef(ctx, ref.vishwashipOrderId);
    if (!f.ok) return f;
    return { ok: true, value: f.value ? toBooking(f.value) : null };
  },

  /** Shipora X returns its own 4×6 / A4 label as an HTML page; it is served sandboxed from the order page. */
  async label(ctx, ref, format) {
    const formatsAvailable = ["thermal_4x6" as const];
    if (format !== "thermal_4x6") return { ok: true, value: { formatsAvailable } };
    let r: Response;
    try { r = await ctx.fetch(`${base(ctx)}/api/orders/${encodeURIComponent(ref.providerOrderRef)}/label`, { timeoutMs: 20_000, headers: { "X-Api-Key": ctx.secrets.apiKey ?? "" } }); }
    catch (e) { return { ok: false, error: { category: "timeout", message: `Shipora X label: ${(e as Error).message}`, retryable: true } }; }
    const html = await r.text();
    if (!r.ok || !/<html/i.test(html)) return { ok: false, error: { category: "not_found", message: "Shipora X has not generated the label yet", retryable: true } };
    return { ok: true, value: { html, formatsAvailable } };
  },
  async schedulePickup() { return unsupported("pickup (Shipora X schedules pickup when the order is shipped)"); },

  async track(ctx, awb) {
    const r = await call(ctx, `/api/orders/track-by-awb/${encodeURIComponent(awb)}`);
    if (!r.ok) return r;
    const d = (r.value.data ?? {}) as Record<string, unknown>;
    const cur = firstString(d, ["currentStatus", "current_status", "status", "waybillDetails.currentStatus", "tracking.status"]) ?? "";
    const at = istIso(firstString(d, ["statusDate", "status_date", "updatedAt", "updated_at", "waybillDetails.statusDate"]) ?? "") ?? new Date().toISOString();
    const hist = (d.history ?? d.scans ?? d.events ?? d.tracking_history ?? []) as Array<Record<string, unknown>>;
    const events: TrackingEvent[] = (Array.isArray(hist) ? hist : []).flatMap((x) => {
      const st = firstString(x, ["status", "currentStatus", "activity"]); const t = istIso(firstString(x, ["statusDate", "date", "time", "createdAt", "created_at"]) ?? "");
      return st && t ? [{ status: mapShiporaStatus(st), rawStatus: st, occurredAt: t, location: firstString(x, ["location", "city"]) ?? undefined }] : [];
    });
    if (cur && !events.some((e) => e.rawStatus === cur)) events.push({ status: mapShiporaStatus(cur), rawStatus: cur, occurredAt: at });
    if (!events.length) return { ok: false, error: { category: "not_found", message: "No tracking data yet", retryable: true } };
    return { ok: true, value: { awb, carrierName: firstString(d, ["courierName", "courier_name"]) ?? "Courier", status: mapShiporaStatus(cur || events[events.length - 1].rawStatus), events } };
  },

  async cancel(ctx, ref) {
    const r = await call(ctx, `/api/orders/${encodeURIComponent(ref.providerOrderRef)}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Cancelled from Vishwaship" }) });
    return r.ok ? { ok: true, value: { acknowledged: true } } : r;
  },
  parseTrackingWebhook: parseShiporaWebhook,
  async ndrAction() { return unsupported("NDR action"); },
};
