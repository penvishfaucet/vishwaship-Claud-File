import "server-only";
import type { ProviderQuote } from "@/server/pricing/engine";
import { type LabelFormat, type NormalizedStatus, type ProviderContext, type Result, type ShippingAdapter, type TrackingEvent, unsupported } from "./types";
import { b2cCharges, firstString, jsonOrNull, providerError, rupees } from "./delhivery-common";

/**
 * Delhivery Direct B2C (Express). Endpoints from the Delhivery developer portal (docs/DELHIVERY-API-NOTES.md).
 * Secret: apiToken ("Authorization: Token <apiToken>"). Config: shippingMode "S" (Surface) | "E" (Express), rateSource, rateCard.
 * Documented payment modes: Prepaid, COD (forward), Pickup (reverse), REPL. FOD is not a documented B2C mode.
 */
const base = (ctx: ProviderContext) => (ctx.mode === "live" ? "https://track.delhivery.com" : "https://staging-express.delhivery.com");

async function call(ctx: ProviderContext, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Result<{ status: number; json: unknown }>> {
  if (!ctx.secrets.apiToken) return { ok: false, error: { category: "auth", message: "Delhivery B2C API token not configured", retryable: false } };
  let r: Response;
  try {
    r = await ctx.fetch(`${base(ctx)}${path}`, { timeoutMs: 20_000, ...init, headers: { authorization: `Token ${ctx.secrets.apiToken}`, accept: "application/json", ...(init.headers as Record<string, string> | undefined) } });
  } catch (e) { return { ok: false, error: { category: "timeout", message: `Delhivery B2C timed out: ${(e as Error).message}`, retryable: true } }; }
  const json = await jsonOrNull(r);
  if (r.status === 401 || r.status === 403) return { ok: false, error: { category: "auth", message: "Delhivery rejected the API token", retryable: false } };
  if (r.status === 429) return { ok: false, error: { category: "rate_limited", message: "Delhivery rate limit reached — try again shortly", retryable: true } };
  if (r.status >= 500) return { ok: false, error: { category: "upstream", message: `Delhivery B2C error HTTP ${r.status}`, retryable: true } };
  if (!r.ok) return { ok: false, error: { category: "validation", message: providerError(json, `Delhivery B2C rejected the request (HTTP ${r.status})`), retryable: false } };
  return { ok: true, value: { status: r.status, json } };
}

/** Normalise Delhivery B2C scan status (StatusType + Status). */
export function mapB2cStatus(type: string, status: string, instructions = ""): NormalizedStatus {
  const t = type.toUpperCase(), s = status.toLowerCase(), i = instructions.toLowerCase();
  if (s.includes("cancel")) return "cancelled";
  if (t === "DL") return s.includes("rto") || s.includes("return") ? "rto_delivered" : "delivered";
  if (t === "RT") return "rto_in_transit";
  if (t === "PP" || t === "PU") return s.includes("picked") ? "picked_up" : "pickup_pending";
  if (s.includes("manifest")) return "booked";
  if (s.includes("not picked") || s.includes("pickup")) return "pickup_pending";
  if (s.includes("dispatch") || s.includes("out for delivery")) return "out_for_delivery";
  if (s === "pending" && /(not available|refused|reschedul|address|unable|undeliver)/.test(i)) return "ndr";
  if (s === "pending") return "at_delivery_center";
  if (s.includes("lost")) return "lost";
  return "in_transit";
}

export const delhiveryB2cAdapter: ShippingAdapter = {
  key: "delhivery_b2c",
  displayName: "Delhivery Direct B2C",
  implemented: ["authenticate", "health", "warehouse_sync", "serviceability", "quote", "book", "booking_lookup", "label", "pickup", "track", "cancel"],
  paymentModes: ["prepaid", "cod"],

  async health(ctx) {
    const r = await call(ctx, "/c/api/pin-codes/json/?filter_codes=110001");
    return r.ok ? { ok: true, value: { message: `Connected to Delhivery B2C (${ctx.mode === "live" ? "production" : "staging"}) — token and serviceability OK` } } : r;
  },

  async quote(ctx, req) {
    if (req.mode !== "B2C" || req.paymentType === "fod") return { ok: true, value: [] };
    const boxes = req.packages.reduce((t, p) => t + p.count, 0);
    if (boxes !== 1) return { ok: false, error: { category: "unsupported", message: "Delhivery B2C quotes single-box shipments; use B2B for multiple cartons", retryable: false } };
    const svc = await call(ctx, `/c/api/pin-codes/json/?filter_codes=${req.destinationPincode}`);
    if (!svc.ok) return svc;
    const pc = (svc.value.json as { delivery_codes?: Array<{ postal_code?: Record<string, unknown> }> })?.delivery_codes?.[0]?.postal_code;
    if (!pc) return { ok: false, error: { category: "not_serviceable", message: `Delhivery does not deliver to ${req.destinationPincode}`, retryable: false } };
    if (req.direction !== "reverse" && pc.pre_paid === "N" && req.paymentType === "prepaid") return { ok: false, error: { category: "not_serviceable", message: `Prepaid delivery is not available to ${req.destinationPincode}`, retryable: false } };
    if (req.paymentType === "cod" && pc.cod !== "Y" && pc.cash !== "Y") return { ok: false, error: { category: "not_serviceable", message: `COD is not available to ${req.destinationPincode}`, retryable: false } };

    const p = req.packages[0];
    const divisor = Number(ctx.config.volDivisor ?? 5000);
    const vol = Math.ceil(((p.lengthMm / 10) * (p.breadthMm / 10) * (p.heightMm / 10) * 1000) / divisor);
    const chargeable = Math.max(p.actualWeightGrams, vol);
    const md = ctx.config.shippingMode === "E" ? "E" : "S";
    let components;
    let source = "shipping_cost_api";
    if (ctx.config.rateSource === "rate_card") {
      const rc = (ctx.config.rateCard ?? {}) as { first500Paise?: number; addl500Paise?: number; codFeePaise?: number; codPct?: number };
      if (!rc.first500Paise) return { ok: false, error: { category: "unsupported", message: "Delhivery B2C contract rate card is not configured", retryable: false } };
      const slabs = Math.max(1, Math.ceil(chargeable / 500));
      components = [{ code: "freight" as const, label: "Base freight", amount: rc.first500Paise + (slabs - 1) * (rc.addl500Paise ?? rc.first500Paise) }];
      if (req.paymentType === "cod") components.push({ code: "cod_fee" as never, label: "COD charge", amount: Math.max(rc.codFeePaise ?? 0, Math.round(((req.codAmount ?? 0) * (rc.codPct ?? 0)) / 100)) });
      source = "contract_rate_card";
    } else {
      const qs = new URLSearchParams({ md, ss: req.direction === "reverse" ? "DTO" : "Delivered", d_pin: req.destinationPincode, o_pin: req.originPincode, cgm: String(chargeable), pt: req.paymentType === "cod" ? "COD" : "Pre-paid", l: String(Math.round(p.lengthMm / 10)), b: String(Math.round(p.breadthMm / 10)), h: String(Math.round(p.heightMm / 10)) });
      if (req.paymentType === "cod") qs.set("cod", String(rupees(req.codAmount ?? 0)));
      const c = await call(ctx, `/api/kinko/v1/invoice/charges/.json?${qs}`);
      if (!c.ok) return c;
      components = b2cCharges(c.value.json);
      if (!components) return { ok: false, error: { category: "upstream", message: "Delhivery returned no shipping cost for this route — rate unavailable (not ₹0). Retry shortly.", retryable: true } };
    }
    let etaDays: number | undefined;
    const tat = await call(ctx, `/api/dc/expected_tat?origin_pin=${req.originPincode}&destination_pin=${req.destinationPincode}&mot=${md}&pdt=B2C`, { timeoutMs: 8_000 });
    if (tat.ok) { const d = Number(firstString(tat.value.json, ["data.tat", "tat", "data.expected_tat", "expected_tat"])); if (d > 0 && d < 60) etaDays = Math.round(d); }
    const q: ProviderQuote = {
      provider: "delhivery_b2c", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: `Delhivery B2C ${md === "E" ? "Express" : "Surface"}`, mode: "B2C", etaDays,
      components, taxInclusive: false, taxRateBps: 1800, chargeableWeightGrams: chargeable, providerQuoteRef: `${source}:${req.paymentType}`,
    };
    return { ok: true, value: [q] };
  },

  async registerWarehouse(ctx, w) {
    const name = `VS-${w.code}`.slice(0, 50);
    const r = await call(ctx, "/api/backend/clientwarehouse/create/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, registered_name: name, phone: w.mobile, email: w.email ?? "", address: [w.line1, w.line2].filter(Boolean).join(", "), city: w.city, pin: w.pincode, country: "India",
        return_address: [w.line1, w.line2].filter(Boolean).join(", "), return_pin: w.pincode, return_city: w.city, return_state: w.state, return_country: "India" }),
    });
    if (!r.ok && !/already|exist/i.test(r.error.message)) return r;
    return { ok: true, value: { ref: name } };
  },

  async book(ctx, req) {
    if (req.paymentType === "fod") return { ok: false, error: { category: "unsupported", message: "FOD is not available on Delhivery B2C", retryable: false } };
    if (!req.pickup.providerWarehouseRef) return { ok: false, error: { category: "validation", message: "Pickup warehouse is not registered with Delhivery B2C", retryable: false } };
    const p = req.packages[0];
    const data = {
      pickup_location: { name: req.pickup.providerWarehouseRef },
      shipments: [{
        // our order id is globally unique, so Delhivery's duplicate-order check makes retries safe
        order: req.vishwashipOrderId, name: req.consignee.name, phone: req.consignee.mobile, add: [req.consignee.line1, req.consignee.line2].filter(Boolean).join(", "),
        pin: req.consignee.pincode, city: req.consignee.city, state: req.consignee.state, country: "India",
        payment_mode: req.paymentType === "cod" ? "COD" : "Prepaid", cod_amount: req.paymentType === "cod" ? String(rupees(req.codAmount)) : "0", total_amount: String(rupees(req.declaredValue)),
        weight: String(p.actualWeightGrams), shipment_length: String(p.lengthMm / 10), shipment_width: String(p.breadthMm / 10), shipment_height: String(p.heightMm / 10),
        products_desc: req.products.map((x) => `${x.name} x${x.qty}`).join(", ").slice(0, 200), hsn_code: req.products.map((x) => x.hsn).filter(Boolean).join(","),
        quantity: String(req.products.reduce((t, x) => t + x.qty, 0) || 1), seller_inv: req.invoiceNumber ?? req.orderNumber, ewbn: req.ewayBill ?? "",
        shipping_mode: ctx.config.shippingMode === "E" ? "Express" : "Surface", seller_name: req.pickup.name,
      }],
    };
    const r = await call(ctx, "/api/cmu/create.json", { method: "POST", timeoutMs: 30_000, headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ format: "json", data: JSON.stringify(data) }).toString() });
    if (!r.ok) return r.error.category === "timeout" ? { ok: false, error: { ...r.error, category: "ambiguous" } } : r;
    const pk = (r.value.json as { packages?: Array<{ waybill?: string; status?: string; remarks?: string[] | string }> })?.packages?.[0];
    if (pk?.waybill && /success/i.test(pk.status ?? "")) return { ok: true, value: { providerOrderRef: req.vishwashipOrderId, awb: pk.waybill, state: "confirmed", labelAvailable: true } };
    const remark = Array.isArray(pk?.remarks) ? pk.remarks.join("; ") : pk?.remarks ?? "";
    if (/duplicate/i.test(remark)) {
      const again = await this.lookupBooking(ctx, { vishwashipOrderId: req.vishwashipOrderId });
      if (again.ok && again.value) return { ok: true, value: again.value };
      return { ok: false, error: { category: "ambiguous", message: "Delhivery reports a duplicate order — checking the existing booking", retryable: false } };
    }
    return { ok: false, error: { category: "validation", message: providerError(r.value.json, "Delhivery did not create the shipment"), retryable: false } };
  },

  async lookupBooking(ctx, ref) {
    const r = await call(ctx, `/api/v1/packages/json/?waybill=&ref_ids=${encodeURIComponent(ref.vishwashipOrderId)}`);
    if (!r.ok) return r.error.category === "validation" ? { ok: true, value: null } : r;
    const awb = firstString(r.value.json, ["ShipmentData.0.Shipment.AWB"]);
    return { ok: true, value: awb ? { providerOrderRef: ref.vishwashipOrderId, awb, state: "confirmed", labelAvailable: true } : null };
  },

  async label(ctx, ref, format) {
    const formatsAvailable: LabelFormat[] = ["thermal_4x6", "a4"];
    if (!formatsAvailable.includes(format)) return { ok: true, value: { formatsAvailable } };
    const r = await call(ctx, `/api/p/packing_slip?wbns=${encodeURIComponent(ref.awb)}&pdf=true&pdf_size=${format === "a4" ? "A4" : "4R"}`);
    if (!r.ok) return r;
    const url = firstString(r.value.json, ["packages.0.pdf_download_link", "packages.0.pdf_link", "pdf_download_link"]);
    if (!url) return { ok: false, error: { category: "not_found", message: "Delhivery has not generated the label yet", retryable: true } };
    return { ok: true, value: { url, formatsAvailable } };
  },

  async schedulePickup(ctx, ref, date) {
    if (!ref.pickupLocation) return { ok: false, error: { category: "validation", message: "Pickup warehouse is not registered with Delhivery", retryable: false } };
    const r = await call(ctx, "/fm/request/new/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pickup_time: String(ctx.config.pickupStartTime ?? "11:00:00"), pickup_date: date, pickup_location: ref.pickupLocation, expected_package_count: ref.packageCount ?? 1 }) });
    if (!r.ok) return r;
    return { ok: true, value: { pickupRef: firstString(r.value.json, ["pickup_id", "data.pickup_id", "id"]) ?? undefined, scheduledFor: date } };
  },

  async track(ctx, awb) {
    const r = await call(ctx, `/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`);
    if (!r.ok) return r;
    const sh = (r.value.json as { ShipmentData?: Array<{ Shipment?: Record<string, unknown> }> })?.ShipmentData?.[0]?.Shipment;
    if (!sh) return { ok: false, error: { category: "not_found", message: "No tracking data yet", retryable: true } };
    const scans = ((sh.Scans as Array<{ ScanDetail?: Record<string, string> }>) ?? []).map((x) => x.ScanDetail ?? {});
    const events: TrackingEvent[] = scans.map((d) => ({ status: mapB2cStatus(d.ScanType ?? "", d.Scan ?? "", d.Instructions ?? ""), rawStatus: [d.Scan, d.Instructions].filter(Boolean).join(" — "), location: d.ScannedLocation, occurredAt: new Date(d.ScanDateTime ?? d.StatusDateTime ?? Date.now()).toISOString(), remark: d.Instructions }));
    const st = (sh.Status ?? {}) as Record<string, string>;
    const status = mapB2cStatus(st.StatusType ?? "", st.Status ?? "", st.Instructions ?? "");
    const eta = (sh.ExpectedDeliveryDate ?? sh.PromisedDeliveryDate) as string | undefined;
    return { ok: true, value: { awb, carrierName: "Delhivery", status, events, etaDate: eta ? new Date(eta).toISOString() : undefined } };
  },

  async cancel(ctx, ref) {
    if (!ref.awb) return { ok: false, error: { category: "validation", message: "No waybill to cancel", retryable: false } };
    const r = await call(ctx, "/api/p/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ waybill: ref.awb, cancellation: "true" }) });
    if (!r.ok) return r;
    const j = r.value.json as Record<string, unknown> | null;
    if (j && (j.status === false || j.error)) return { ok: false, error: { category: "validation", message: providerError(j, "Delhivery refused the cancellation"), retryable: false } };
    return { ok: true, value: { acknowledged: true } };
  },

  async ndrAction() { return unsupported("NDR action"); },
};
