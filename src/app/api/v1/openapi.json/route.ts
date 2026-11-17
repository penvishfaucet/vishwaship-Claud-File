import { NextResponse } from "next/server";

const err = { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } };

const spec = {
  openapi: "3.1.0",
  info: { title: "Vishwaship API", version: "1.0.0", description: "Amounts are integer paise (INR). Mutations require an Idempotency-Key header. Sandbox responses carry sandbox: true." },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "<key_id>.<secret>" } },
    schemas: {
      Error: err,
      Package: { type: "object", required: ["count", "lengthCm", "breadthCm", "heightCm", "weightKg"], properties: { count: { type: "integer" }, lengthCm: { type: "number" }, breadthCm: { type: "number" }, heightCm: { type: "number" }, weightKg: { type: "number" } } },
      QuoteRequest: { type: "object", required: ["mode", "originPincode", "destinationPincode", "paymentType", "packages"], properties: { mode: { enum: ["B2C", "B2B"] }, originPincode: { type: "string", pattern: "^[1-9][0-9]{5}$" }, destinationPincode: { type: "string" }, paymentType: { enum: ["prepaid", "cod"] }, codAmountRupees: { type: "number" }, declaredValueRupees: { type: "number" }, packages: { type: "array", items: { $ref: "#/components/schemas/Package" } } } },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    "/quotes": { post: { summary: "Get priced courier offers (scope quotes:read)", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/QuoteRequest" } } } }, responses: { 200: { description: "Offers" }, 401: { description: "Unauthorized", content: { "application/json": { schema: err } } }, 422: { description: "Validation error" } } } },
    "/orders": {
      get: { summary: "List orders (scope orders:read)", parameters: [{ name: "page", in: "query", schema: { type: "integer" } }, { name: "q", in: "query", schema: { type: "string" } }], responses: { 200: { description: "Orders" } } },
      post: { summary: "Create order (scope orders:write)", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }], responses: { 201: { description: "Created" }, 409: { description: "Duplicate order number or idempotency conflict" } } },
    },
    "/orders/{id}/book": { post: { summary: "Book with a quote (scope shipments:write)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }], responses: { 201: { description: "Booked" }, 202: { description: "Ambiguous — funds held while we reconcile with the courier" }, 402: { description: "Insufficient balance" }, 409: { description: "Quote expired / already booked / COD hold" } } } },
    "/tracking/{awb}": { get: { summary: "Tracking timeline (scope tracking:read)", parameters: [{ name: "awb", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "Timeline" }, 404: { description: "Not found in your workspace" } } } },
  },
  "x-webhooks": {
    "shipment.status_changed": { description: "POST to your endpoint. Headers: X-Vishwaship-Event-Id, X-Vishwaship-Timestamp, X-Vishwaship-Signature = hex HMAC-SHA256(secret, timestamp + '.' + rawBody). Reject if timestamp is older than 300 s; dedupe on event id." },
  },
};

export function GET() {
  return NextResponse.json(spec);
}
