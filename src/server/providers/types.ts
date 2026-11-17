/**
 * Shared provider contract. Every shipping adapter implements the subset it supports; unsupported
 * operations return { ok: false, error: { category: "unsupported" } } instead of throwing.
 * All amounts are paise, weights grams, dimensions millimetres, timestamps ISO-8601 UTC.
 */
import type { Paise } from "@/lib/money";
import type { ProviderQuote } from "@/server/pricing/engine";

export type Capability =
  | "authenticate" | "health" | "warehouse_sync" | "serviceability" | "quote" | "book"
  | "booking_lookup" | "label" | "manifest" | "pod" | "pickup" | "track" | "cancel"
  | "ndr" | "reverse" | "reconciliation" | "inbound_events";

/** Per-account certification state recorded in provider_accounts.capabilities. */
export type CapabilityState =
  | "demo" | "implemented_awaiting_credentials" | "sandbox_verified" | "live_verified" | "unsupported";

export type ErrorCategory =
  | "unsupported" | "auth" | "validation" | "not_serviceable" | "rate_limited"
  | "timeout" | "upstream" | "ambiguous" | "not_found";

export type Result<T> =
  | { ok: true; value: T; correlationId?: string }
  | { ok: false; error: { category: ErrorCategory; message: string; retryable: boolean }; correlationId?: string };

export const unsupported = <T>(op: string): Result<T> => ({
  ok: false, error: { category: "unsupported", message: `${op} is not supported by this provider account`, retryable: false },
});

export interface Address {
  name: string; mobile: string; line1: string; line2?: string;
  pincode: string; city: string; state: string; email?: string;
}

export interface PackageInput {
  count: number; lengthMm: number; breadthMm: number; heightMm: number; actualWeightGrams: number;
}

export interface QuoteRequest {
  mode: "B2C" | "B2B";
  originPincode: string;
  destinationPincode: string;
  paymentType: "prepaid" | "cod";
  codAmount?: Paise;
  declaredValue?: Paise;
  packages: PackageInput[];
  direction?: "forward" | "reverse";
}

export interface BookRequest {
  vishwashipOrderId: string;
  orderNumber: string;
  quote: { carrierCode: string; serviceName: string; providerQuoteRef?: string };
  mode: "B2C" | "B2B";
  paymentType: "prepaid" | "cod";
  codAmount: Paise;
  declaredValue: Paise;
  pickup: Address & { providerWarehouseRef?: string };
  consignee: Address;
  packages: PackageInput[];
  products: Array<{ name: string; sku?: string; qty: number; unitPrice: Paise; hsn?: string }>;
  invoiceNumber?: string;
  ewayBill?: string;
}

export interface BookResult {
  providerOrderRef: string;
  awb: string | null;          // may be null while async manifestation is pending
  lrNumber?: string | null;
  pieceIds?: string[];
  state: "confirmed" | "pending_async";
  labelAvailable: boolean;
}

export type NormalizedStatus =
  | "booked" | "pickup_pending" | "picked_up" | "in_transit" | "at_delivery_center"
  | "out_for_delivery" | "delivered" | "ndr" | "cancelled"
  | "rto_initiated" | "rto_in_transit" | "rto_delivered" | "lost" | "reverse_in_transit" | "reverse_delivered";

export interface TrackingEvent {
  status: NormalizedStatus;
  rawStatus: string;
  location?: string;
  occurredAt: string;
  remark?: string;
}

export interface TrackResult {
  awb: string;
  carrierName: string;
  status: NormalizedStatus;
  etaDate?: string;
  events: TrackingEvent[];
}

export type LabelFormat = "a4" | "thermal_4x6" | "thermal_3x4" | "thermal_4x4" | "thermal_2x4" | "thermal_38x100";

export interface ProviderContext {
  accountId: string;
  mode: "test" | "live";
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  fetch: SafeFetch;
}

export type SafeFetch = (url: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>;

export interface ShippingAdapter {
  key: string;
  displayName: string;
  /** Capabilities the adapter code implements; the account matrix records verification. */
  implemented: Capability[];
  health(ctx: ProviderContext): Promise<Result<{ message: string }>>;
  quote(ctx: ProviderContext, req: QuoteRequest): Promise<Result<ProviderQuote[]>>;
  book(ctx: ProviderContext, req: BookRequest): Promise<Result<BookResult>>;
  lookupBooking(ctx: ProviderContext, ref: { vishwashipOrderId: string; providerOrderRef?: string }): Promise<Result<BookResult | null>>;
  label(ctx: ProviderContext, ref: { providerOrderRef: string; awb: string }, format: LabelFormat): Promise<Result<{ url?: string; pdf?: Uint8Array; formatsAvailable: LabelFormat[] }>>;
  schedulePickup(ctx: ProviderContext, ref: { providerOrderRef: string; awb: string }, date: string): Promise<Result<{ pickupRef?: string; scheduledFor: string }>>;
  track(ctx: ProviderContext, awb: string): Promise<Result<TrackResult>>;
  cancel(ctx: ProviderContext, ref: { providerOrderRef: string; awb: string | null }): Promise<Result<{ acknowledged: boolean }>>;
  ndrAction(ctx: ProviderContext, ref: { awb: string }, action: { kind: "reattempt" | "update_address" | "rto"; payload?: Record<string, unknown> }): Promise<Result<{ acknowledged: boolean }>>;
}

/** Volumetric weight per provider: L x B x H (cm) / divisor, in grams, rounded up to `roundToGrams`. */
export function chargeableWeight(packages: PackageInput[], opts: { divisor: number; roundToGrams: number; minGrams: number }) {
  let actual = 0, volumetric = 0, boxes = 0;
  const perPackage = packages.map((p) => {
    const volPerBox = Math.ceil(((p.lengthMm / 10) * (p.breadthMm / 10) * (p.heightMm / 10) * 1000) / opts.divisor);
    actual += p.actualWeightGrams * p.count;
    volumetric += volPerBox * p.count;
    boxes += p.count;
    return { volumetricPerBoxGrams: volPerBox, actualPerBoxGrams: p.actualWeightGrams, count: p.count };
  });
  const raw = Math.max(actual, volumetric, opts.minGrams);
  const chargeable = Math.ceil(raw / opts.roundToGrams) * opts.roundToGrams;
  return { boxes, actualGrams: actual, volumetricGrams: volumetric, chargeableGrams: chargeable, perPackage };
}
