/**
 * DEMO adapter: deterministic fixtures so every flow can be exercised while live credentials are
 * pending. Every reference it issues is prefixed "DEMO" and every shipment it books is flagged
 * provider="demo". It must never be reported as live or sandbox verification of a carrier.
 */
import type { ProviderQuote } from "@/server/pricing/engine";
import {
  type BookResult, type ShippingAdapter, type TrackingEvent, type NormalizedStatus,
  chargeableWeight,
} from "./types";

const METRO = new Set(["110", "400", "560", "600", "700", "500", "411", "380"]);
export function zoneFor(origin: string, dest: string): "A" | "B" | "C" | "D" | "E" {
  const ne = (p: string) => /^(78|79|18|19)/.test(p);
  if (ne(dest)) return "E";
  if (origin.slice(0, 3) === dest.slice(0, 3)) return "A";
  if (origin.slice(0, 2) === dest.slice(0, 2)) return "B";
  if (METRO.has(origin.slice(0, 3)) && METRO.has(dest.slice(0, 3))) return "C";
  return "D";
}

// Cost-side fixture rates in paise per first 500 g / additional 500 g (pre-tax).
const B2C_SERVICES = [
  { carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "Surface", eta: [3, 4, 4, 5, 7], first: [2600, 3100, 3700, 4700, 5600], add: [2300, 2700, 3200, 4000, 5000] },
  { carrierCode: "xpressbees", carrierName: "Xpressbees", serviceName: "Surface", eta: [3, 4, 5, 5, 8], first: [2500, 3000, 3800, 4800, 5800], add: [2200, 2700, 3300, 4100, 5200] },
  { carrierCode: "blue-dart", carrierName: "Blue Dart", serviceName: "Air Express", eta: [1, 2, 2, 3, 4], first: [3600, 4800, 5800, 7400, 8800], add: [3200, 4400, 5100, 6700, 7900] },
  { carrierCode: "dtdc", carrierName: "DTDC", serviceName: "Express", eta: [2, 2, 3, 3, 5], first: [3300, 4400, 5300, 6800, 8200], add: [2900, 4000, 4700, 6200, 7300] },
];
const B2B_SERVICES = [
  { carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "B2B Surface (LTL)", eta: [3, 4, 5, 6, 9], perKg: [900, 1100, 1300, 1600, 2400], minKg: 20, docket: 10000 },
  { carrierCode: "allcargo-gati", carrierName: "Allcargo Gati", serviceName: "Surface Cargo", eta: [4, 5, 5, 7, 10], perKg: [850, 1050, 1250, 1550, 2300], minKg: 20, docket: 15000 },
  { carrierCode: "tci-express", carrierName: "TCI Express", serviceName: "Surface Express", eta: [3, 4, 4, 6, 9], perKg: [950, 1150, 1350, 1700, 2500], minKg: 20, docket: 10000 },
];

const ZI = { A: 0, B: 1, C: 2, D: 3, E: 4 } as const;

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36).toUpperCase();
}

const DEMO_TIMELINE: NormalizedStatus[] = ["booked", "pickup_pending", "picked_up", "in_transit", "at_delivery_center", "out_for_delivery", "delivered"];

export const demoAdapter: ShippingAdapter = {
  key: "demo",
  displayName: "Demo carrier network",
  implemented: ["health", "serviceability", "quote", "book", "booking_lookup", "label", "pickup", "track", "cancel", "ndr"],

  async health() {
    return { ok: true, value: { message: "Demo adapter: fixtures only, no carrier is contacted." } };
  },

  async quote(_ctx, req) {
    if (!/^[1-9]\d{5}$/.test(req.originPincode) || !/^[1-9]\d{5}$/.test(req.destinationPincode)) {
      return { ok: false, error: { category: "validation", message: "Pincodes must be 6 digits", retryable: false } };
    }
    const zone = zoneFor(req.originPincode, req.destinationPincode);
    const z = ZI[zone];
    const quotes: ProviderQuote[] = [];
    if (req.mode === "B2C") {
      const w = chargeableWeight(req.packages, { divisor: 5000, roundToGrams: 500, minGrams: 500 });
      const slabs = w.chargeableGrams / 500;
      for (const s of B2C_SERVICES) {
        const freight = s.first[z] + (slabs - 1) * s.add[z];
        const comps: ProviderQuote["components"] = [
          { code: "freight", label: "Freight", amount: freight },
          { code: "fuel", label: "Fuel surcharge", amount: Math.round(freight * 0.1) },
        ];
        if (req.paymentType === "cod") {
          const codFee = Math.max(3500, Math.round((req.codAmount ?? 0) * 0.015));
          comps.push({ code: "cod_fee", label: "COD fee", amount: codFee });
        }
        quotes.push({
          provider: "demo", carrierCode: s.carrierCode, carrierName: s.carrierName, serviceName: s.serviceName,
          mode: "B2C", etaDays: s.eta[z], components: comps, taxInclusive: false, taxRateBps: 1800,
          chargeableWeightGrams: w.chargeableGrams, providerQuoteRef: `DEMOQ-${hash(s.carrierCode + zone + w.chargeableGrams)}`,
        });
      }
    } else {
      const w = chargeableWeight(req.packages, { divisor: 4500, roundToGrams: 1000, minGrams: 20_000 });
      for (const s of B2B_SERVICES) {
        const kg = Math.max(s.minKg, w.chargeableGrams / 1000);
        const freight = kg * s.perKg[z];
        const comps: ProviderQuote["components"] = [
          { code: "freight", label: "Freight", amount: freight },
          { code: "fuel", label: "Fuel surcharge", amount: Math.round(freight * 0.15) },
          { code: "docket", label: "Docket charge", amount: s.docket },
          { code: "fov", label: "FOV (owner's risk)", amount: Math.max(10000, Math.round((req.declaredValue ?? 0) * 0.001)) },
        ];
        if (zone === "E") comps.push({ code: "oda", label: "ODA charge", amount: 75000 });
        if (req.paymentType === "cod") comps.push({ code: "cod_fee", label: "COD fee", amount: Math.max(15000, Math.round((req.codAmount ?? 0) * 0.02)) });
        quotes.push({
          provider: "demo", carrierCode: s.carrierCode, carrierName: s.carrierName, serviceName: s.serviceName,
          mode: "B2B", etaDays: s.eta[z], components: comps, taxInclusive: false, taxRateBps: 1800,
          chargeableWeightGrams: Math.max(w.chargeableGrams, s.minKg * 1000), providerQuoteRef: `DEMOQ-${hash(s.carrierCode + zone + w.chargeableGrams)}`,
        });
      }
    }
    return { ok: true, value: quotes };
  },

  async book(_ctx, req) {
    // Deterministic per order so retries/lookups return the same references (idempotent).
    const h = hash(req.vishwashipOrderId);
    const multi = req.mode === "B2B";
    const boxes = req.packages.reduce((s, p) => s + p.count, 0);
    const result: BookResult = {
      providerOrderRef: `DEMO-ORD-${h}`,
      awb: multi ? null : `DEMO${h.padStart(10, "0").slice(-10)}`,
      lrNumber: multi ? `DEMO-LR-${h}` : null,
      pieceIds: multi ? Array.from({ length: boxes }, (_, i) => `DEMO-PC-${h}-${i + 1}`) : undefined,
      state: "confirmed",
      labelAvailable: true,
    };
    if (multi) result.awb = `DEMO-LR-${h}`;
    return { ok: true, value: result };
  },

  async lookupBooking(_ctx, ref) {
    const r = await demoAdapter.book(_ctx, { vishwashipOrderId: ref.vishwashipOrderId } as never);
    return r.ok ? { ok: true, value: r.value } : r;
  },

  async label() {
    return { ok: true, value: { formatsAvailable: ["a4", "thermal_4x6", "thermal_3x4", "thermal_4x4", "thermal_2x4", "thermal_38x100"] } };
  },

  async schedulePickup(_ctx, _ref, date) {
    return { ok: true, value: { pickupRef: `DEMO-PU-${hash(date)}`, scheduledFor: date } };
  },

  async track(_ctx, awb) {
    if (!awb.startsWith("DEMO")) return { ok: false, error: { category: "not_found", message: "Unknown AWB", retryable: false } };
    // Deterministic progress so the demo shows a realistic timeline.
    const step = parseInt(hash(awb), 36) % DEMO_TIMELINE.length;
    const base = Date.now() - step * 18 * 3600_000;
    const events: TrackingEvent[] = DEMO_TIMELINE.slice(0, step + 1).map((s, i) => ({
      status: s, rawStatus: s.toUpperCase(), location: i < 3 ? "Origin hub" : "Destination hub",
      occurredAt: new Date(base + i * 18 * 3600_000).toISOString(),
    }));
    return { ok: true, value: { awb, carrierName: "Demo", status: DEMO_TIMELINE[step], events, etaDate: new Date(base + 6 * 18 * 3600_000).toISOString() } };
  },

  async cancel() {
    return { ok: true, value: { acknowledged: true } };
  },

  async ndrAction() {
    return { ok: true, value: { acknowledged: true } };
  },
};
