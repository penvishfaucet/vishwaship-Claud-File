/**
 * Courier integration catalogue (Admin → Settings → Courier Integrations).
 *
 * Everything security-relevant about a provider lives here in code, never in Admin-editable config:
 * the HTTPS hosts an account may call, which fields are secrets, and which capabilities the adapter
 * implements. Admin can only pick an approved base URL, enter credentials and record verification.
 */
import type { Capability } from "@/server/providers/types";

export type Service = "B2C" | "B2B";
export type Route = "direct" | "aggregator";

export interface FieldSpec { key: string; label: string; secret?: boolean; placeholder?: string; help?: string }

export interface CarrierSpec {
  adapter: string;
  name: string;
  /** Logo shown in Admin (customer quotes show the actual courier's logo). */
  logo?: string;
  route: Route;
  services: Service[];
  /** "implemented" = adapter code exists and can be verified; "documentation_required" = no adapter yet. */
  build: "implemented" | "documentation_required";
  /** Approved base URLs per environment. An editable base URL must be one of these hosts. */
  hosts: { test: string[]; live: string[] };
  defaultBaseUrl?: { test?: string; live?: string };
  baseUrlEditable?: boolean;
  /** Credential and account fields (secrets are encrypted, write-only, masked). */
  fields: FieldSpec[];
  /** Is there a sandbox separate from production? */
  sandbox: boolean;
  webhooks: string;
  docs: string;
  /** What is still needed before each capability can be built or verified. */
  missing: Partial<Record<Capability | "general", string>>;
  /** Per-service notes shown on the account page. */
  serviceNotes?: Partial<Record<Service, string>>;
}

export const SHIPMOZO_HOSTS = ["shipping-api.com"];

export const CARRIER_SPECS: Record<string, CarrierSpec> = {
  shipmozo: {
    adapter: "shipmozo", name: "Shipmozo", route: "aggregator", services: ["B2C", "B2B"], build: "implemented",
    hosts: { test: SHIPMOZO_HOSTS, live: SHIPMOZO_HOSTS },
    defaultBaseUrl: { test: "https://shipping-api.com/app/api/v1", live: "https://shipping-api.com/app/api/v1" }, baseUrlEditable: true,
    fields: [
      { key: "publicKey", label: "Public key", secret: true, help: "Shipmozo panel → Profile (or the Login API)" },
      { key: "privateKey", label: "Private key", secret: true },
    ],
    sandbox: false,
    webhooks: "Not in the supplied guide — tracking is polled every 30 minutes until Shipmozo supplies a signed webhook contract.",
    docs: "Shipmozo API Setup Guide (PDF supplied 2026-11-18): info, push-order, assign-courier, schedule-pickup, cancel-order, get-order-detail, rate-calculator, pincode-serviceability, get-order-label, track-order, create/get-warehouses.",
    missing: {
      general: "Shipmozo has no sandbox in the guide: every test call runs on the live account. Confirm the base URL and that API access is enabled for your account.",
      quote: "The guide does not document the rate-calculator response. Field mapping (courier_id, charges, GST, ETA, pickups_automatically_scheduled) is verified from a real response, and a Rate check against the Shipmozo panel with identical inputs must match before rates are marked verified.",
      book: "B2B: push-order documents a single weight and one set of dimensions. Multi-carton B2B bookings need Shipmozo's B2B / MPS push-order fields (per-box dimensions, invoice / e-way bill rules) before B2B booking can be verified.",
      inbound_events: "Webhook payload, signing method and event list for your account.",
    },
    serviceNotes: {
      B2C: "Single-package parcels (type_of_package SPS). Courier IDs come from the rate-calculator response.",
      B2B: "Multi-carton / cargo (type_of_package set below, default MPS; LTL cargo rates — type B2B — are asked for as well). Ask Shipmozo which package type, courier IDs and rate card apply to your B2B account.",
    },
  },
  delhivery_b2c: {
    adapter: "delhivery_b2c", name: "Delhivery Direct B2C", route: "direct", services: ["B2C"], build: "implemented",
    hosts: { test: ["staging-express.delhivery.com", "express-dev-test.delhivery.com"], live: ["track.delhivery.com"] },
    fields: [{ key: "apiToken", label: "API token", secret: true, help: "Delhivery ONE → Settings → API setup" }],
    sandbox: true,
    webhooks: "Delhivery pushes scans only after its webhook form is approved for your client — polled every 30 minutes until then.",
    docs: "Delhivery One B2C developer portal (one.delhivery.com/developer-portal/documents/b2c).",
    missing: { quote: "Confirm whether your contract is billed from the Shipping Cost API or a contracted rate card (set the rate source on the Delhivery settings page)." },
  },
  delhivery_b2b: {
    adapter: "delhivery_b2b", name: "Delhivery Direct B2B", route: "direct", services: ["B2B"], build: "implemented",
    hosts: { test: ["ltl-clients-api-dev.delhivery.com"], live: ["ltl-clients-api.delhivery.com"] },
    fields: [{ key: "username", label: "B2B API username", secret: true }, { key: "password", label: "B2B API password", secret: true }],
    sandbox: true,
    webhooks: "Status push needs Delhivery's webhook form approval — polled every 30 minutes until then.",
    docs: "Delhivery One B2B developer portal + B2B API reference (apidocs.delhivery.in).",
    missing: { quote: "Confirm Freight Estimator access or supply the contracted B2B rate card (set on the Delhivery settings page)." },
  },
  shiporax: {
    adapter: "shiporax", name: "Shipora X", route: "aggregator", services: ["B2C"], build: "implemented",
    hosts: { test: ["shiporax.com"], live: ["shiporax.com"] },
    defaultBaseUrl: { test: "https://shiporax.com", live: "https://shiporax.com" }, baseUrlEditable: true,
    fields: [
      { key: "apiKey", label: "API key (X-Api-Key)", secret: true },
      { key: "webhookToken", label: "Webhook token (any long random text you choose)", secret: true, help: "Put it in the webhook URL you give Shipora X" },
    ],
    sandbox: false,
    webhooks: "Tracking push supported: give Shipora X the webhook URL shown on this page (it carries your webhook token). Payload { waybillDetails: { waybill, currentStatus, statusDate } }. Tracking is also polled every 30 minutes.",
    docs: "Endpoint list from the owner (2026-11-18) + live read-only checks: GET /api/couriers, POST /api/orders/calc-rate (weight kg, pickup_pincode, delivery_pincode, length/breadth/height cm), webhook payload.",
    missing: {
      general: "Ask Shipora X whether they sign webhooks (header + secret); until then the token in the URL authenticates pushes.",
      quote: "Whether calc-rate 'total' includes GST (no GST field is returned) — set the GST basis under Service settings — and how to request COD charges (codCharge stayed 0 for every COD request tried), so COD is off until confirmed.",
      book: "Built from a real test order (2026-11-18): import (customer_* fields, warehouse_id) → read back and check address + pickup warehouse → PATCH /api/orders/:id/ship {courierId, rateId} → AWB from GET /api/orders/:id. Not yet run end-to-end with a real shipment: the first live booking verifies the ship response and charge. B2B: Shipora X's B2B rate/booking parameters are still needed.",
      label: "GET /api/orders/:id/label returns an HTML 4×6 / A4 label; served sandboxed from the order page (not in bulk PDF downloads).",
      cancel: "POST /api/orders/:id/cancel (confirmed on the test order).",
      track: "Response shape of GET /api/orders/track-by-awb/:awb and the full status list (pickup / out-for-delivery codes).",
    },
  },
  ekart: {
    adapter: "ekart", name: "Ekart", route: "direct", services: ["B2C"], build: "documentation_required",
    hosts: { test: [], live: [] }, baseUrlEditable: true,
    fields: [{ key: "clientId", label: "Client ID", secret: true }, { key: "clientSecret", label: "Client secret / password", secret: true }, { key: "merchantCode", label: "Merchant code" }],
    sandbox: true, webhooks: "Unknown until the API contract is supplied.",
    docs: "Not supplied yet (Ekart issues the integration guide with the merchant account).",
    missing: {
      general: "Ekart Logistics API guide for your merchant account, sandbox + production base URLs and auth method.",
      quote: "Rate API access or your contracted rate card (zones, slabs, COD, fuel, GST).",
      book: "Shipment creation payload, tracking-ID allocation and duplicate behaviour.",
      label: "Label API / format.", track: "Tracking API and status code list.", pickup: "Pickup / manifest process.",
    },
  },
  tci: {
    adapter: "tci", name: "TCI Express", route: "direct", services: ["B2B"], build: "documentation_required",
    hosts: { test: [], live: [] }, baseUrlEditable: true,
    fields: [{ key: "username", label: "API username", secret: true }, { key: "password", label: "API password", secret: true }, { key: "customerCode", label: "Customer code" }],
    sandbox: true, webhooks: "Unknown until the API contract is supplied.",
    docs: "Not supplied yet.",
    missing: {
      general: "TCI Express API document for your customer code, with sandbox + production URLs.",
      quote: "Rate API access or the contracted B2B rate card (per-kg, minimum weight, docket, fuel, ODA, GST).",
      book: "Docket / LR creation API, package-level IDs and duplicate behaviour.",
      label: "Docket / box label format.", track: "Docket tracking API and status codes.", pickup: "Pickup request API.",
    },
  },
  bluedart: {
    adapter: "bluedart", name: "Blue Dart", route: "direct", services: ["B2C"], build: "documentation_required",
    hosts: { test: [], live: [] }, baseUrlEditable: true,
    fields: [{ key: "loginId", label: "Login ID", secret: true }, { key: "licenseKey", label: "License key", secret: true }, { key: "customerCode", label: "Customer code" }, { key: "areaCode", label: "Area code" }],
    sandbox: true, webhooks: "Unknown until the API contract is supplied.",
    docs: "Not supplied yet (Blue Dart API gateway access is issued per customer code).",
    missing: {
      general: "Blue Dart API gateway access (JWT client ID / secret, or LoginID + LicenceKey) for your customer code and area, with sandbox + production URLs.",
      quote: "Your contracted rate card or rate API entitlement (Blue Dart does not price from a public API).",
      book: "Waybill generation API version and product / sub-product codes for your contract.",
      label: "Label format returned with the waybill.", track: "Tracking API and status codes.", pickup: "Pickup registration API.",
    },
  },
};

/** "Custom" providers added from Admin reuse one of these protocols with their own brand and credentials. */
export const REUSABLE_PROTOCOLS = ["shipmozo"] as const;

export function specFor(adapter: string, protocol?: string): CarrierSpec | null {
  return CARRIER_SPECS[adapter] ?? (protocol ? CARRIER_SPECS[protocol] ?? null : null);
}

/** Validate an Admin-entered base URL against the provider's approved HTTPS hosts. */
export function validateBaseUrl(spec: CarrierSpec, mode: "test" | "live", raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, reason: "Enter a full URL starting with https://" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "Only HTTPS base URLs are allowed" };
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: "The base URL must not contain credentials, a query or a fragment" };
  const hosts = spec.hosts[mode];
  if (!hosts.length) return { ok: false, reason: `${spec.name} has no approved ${mode === "live" ? "production" : "sandbox"} host yet — it is approved in code once the API document is verified` };
  if (!hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return { ok: false, reason: `Host ${u.hostname} is not approved for ${spec.name}. Approved: ${hosts.join(", ")}` };
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, "")}` }; // the guide warns against a trailing slash
}

/** Capabilities that must be verified before an account can take customer bookings. */
export const REQUIRED_CAPS: Capability[] = ["authenticate", "quote", "book", "label", "track"];
export const SHOWN_CAPS: Capability[] = ["authenticate", "serviceability", "quote", "book", "label", "pickup", "track", "cancel"];
export const CAP_LABEL: Partial<Record<Capability, string>> = {
  authenticate: "Authentication", serviceability: "Serviceability", quote: "Rates", book: "Booking", label: "Label", pickup: "Pickup", track: "Tracking", cancel: "Cancellation",
};

/**
 * Courier partner code shown in small print on every customer rate ("Partner code VISW001B2C"), so the owner can
 * tell which provider account a rate came from. Admin can override per account (config.partnerCode).
 */
export const DEFAULT_PARTNER_CODES: Record<string, string> = {
  "shipmozo:B2C": "VISW001B2C", "shipmozo:B2B": "VISW002B2B",
  "delhivery_b2c:B2C": "DHL0001B2C", "delhivery_b2b:B2B": "DHL0002B2B",
  "shiporax:B2C": "VISIPO00B2C", "shiporax:B2B": "VISIPO00B2B",
};

export function partnerCodeFor(adapter: string, config: Record<string, unknown> | null | undefined): string | null {
  const own = typeof config?.partnerCode === "string" ? config.partnerCode.trim() : "";
  if (own) return own;
  const service = config?.service === "B2B" || adapter === "delhivery_b2b" ? "B2B" : "B2C";
  return DEFAULT_PARTNER_CODES[`${adapter}:${service}`] ?? null;
}
