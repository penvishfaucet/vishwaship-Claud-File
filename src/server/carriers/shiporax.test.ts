import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { parseShiporaRate, parseShiporaWebhook, mapShiporaStatus } = await import("@/server/providers/shiporax");

// Row shape as returned by the live calc-rate endpoint on 2026-11-18.
const ROW = { courierId: "9b57cccf-e3dc-41ce-a162-7fef1cda5f45", courierName: "Blue-Dart Surface", supportsCod: true, chargeableWeight: 0.5, base_rate: 32, fuel_surcharge: 0, shippingCost: 32, codCharge: 0, total: 32, estimatedDays: "3-5", rateId: "r1" };

describe("Shipora X", () => {
  it("maps a live calc-rate row; refuses until the GST basis is chosen", () => {
    expect("error" in parseShiporaRate(ROW, { mode: "B2C", gstTreatment: "", actualGrams: 500 })).toBe(true);
    const q = parseShiporaRate(ROW, { mode: "B2C", gstTreatment: "exclusive", actualGrams: 300 });
    if ("error" in q) throw new Error(q.error);
    expect(q).toMatchObject({ provider: "shiporax", carrierCode: "blue-dart", etaDays: 5, chargeableWeightGrams: 500, taxInclusive: false, providerQuoteRef: `shiporax:${ROW.courierId}:r1` });
    expect(q.components).toEqual([{ code: "freight", label: "Shipping charges", amount: 3200 }]);
  });
  it("keeps base + fuel as separate lines when they add up to the total", () => {
    const q = parseShiporaRate({ ...ROW, base_rate: 30, fuel_surcharge: 2.5, total: 32.5 }, { mode: "B2C", gstTreatment: "inclusive", actualGrams: 500 });
    expect("components" in q && q.components.map((c) => c.amount)).toEqual([3000, 250]);
  });
  it("parses the tracking webhook (IST time) and maps statuses", () => {
    const r = parseShiporaWebhook({ waybillDetails: { waybill: "1234567890", currentStatus: "IN_TRANSIT", statusDate: "2026-07-14 14:30:00" }, Status: "SUCCESS" });
    expect(r).toEqual({ ok: true, value: [{ awb: "1234567890", events: [{ status: "in_transit", rawStatus: "IN_TRANSIT", occurredAt: "2026-07-14T09:00:00.000Z" }] }] });
    expect(parseShiporaWebhook({ foo: 1 }).ok).toBe(false);
    expect(mapShiporaStatus("DELIVERED")).toBe("delivered");
    expect(mapShiporaStatus("RTO")).toBe("rto_in_transit");
    expect(mapShiporaStatus("RETURN_RECEIVED")).toBe("rto_delivered");
    expect(mapShiporaStatus("SOMETHING_NEW")).toBe("booked");
  });
});

const { shiporaAdapter } = await import("@/server/providers/shiporax");
type Hit = { method: string; path: string; body: unknown };
function fakeCtx(handler: (h: Hit) => unknown) {
  const hits: Hit[] = [];
  const ctx = {
    accountId: "pa_x", mode: "live" as const, config: { service: "B2C", gstTreatment: "exclusive" }, secrets: { apiKey: "k" },
    fetch: async (url: string, init: RequestInit) => {
      const h = { method: String(init.method ?? "GET"), path: new URL(url).pathname + new URL(url).search, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
      hits.push(h);
      return new Response(JSON.stringify(handler(h)), { status: 200 });
    },
  };
  return { ctx: ctx as never, hits };
}
const REQ = {
  vishwashipOrderId: "ord_9", orderNumber: "VS-9", quote: { carrierCode: "blue-dart", serviceName: "Blue-Dart Surface", providerQuoteRef: "shiporax:cour-1:rate-1" },
  mode: "B2C" as const, paymentType: "prepaid" as const, codAmount: 0, declaredValue: 50000,
  pickup: { name: "Ravi", mobile: "9876543210", line1: "Plot 1", pincode: "249402", city: "Haridwar", state: "Uttarakhand", providerWarehouseRef: "wh-1" },
  consignee: { name: "Asha", mobile: "9123456780", line1: "Sector 1", pincode: "411001", city: "Pune", state: "Maharashtra" },
  packages: [{ count: 1, lengthMm: 200, breadthMm: 150, heightMm: 100, actualWeightGrams: 1200 }], products: [{ name: "Shoes", qty: 1, unitPrice: 50000 }],
};
const goodOrder = (awb: string | null) => ({ success: true, data: { id: "11111111-2222-3333-4444-555555555555", status: "pending", recipient: { address: "Sector 1", city: "Pune", pincode: "411001" }, warehouse: { id: "wh-1" }, awb_number: awb } });

describe("Shipora X booking", () => {
  it("imports, checks the stored address + warehouse, ships with the quoted courierId, returns the AWB", async () => {
    let shipped = false;
    const { ctx, hits } = fakeCtx((h) => {
      if (h.path.startsWith("/api/orders?")) return { success: true, data: { orders: [] } };
      if (h.path === "/api/orders/webhook/import") return { success: true, data: { orderId: "11111111-2222-3333-4444-555555555555" } };
      if (h.path.endsWith("/ship")) { shipped = true; return { success: true, data: {} }; }
      return goodOrder(shipped ? "AWB777" : null);
    });
    const r = await shiporaAdapter.book(ctx, REQ);
    expect(r).toMatchObject({ ok: true, value: { awb: "AWB777", state: "confirmed", providerOrderRef: "11111111-2222-3333-4444-555555555555" } });
    const imp = hits.find((h) => h.path === "/api/orders/webhook/import")!.body as Record<string, unknown>;
    expect(imp).toMatchObject({ customer_address: "Sector 1", customer_pincode: "411001", warehouse_id: "wh-1", weight: 1.2, breadth: 15, product_sku: "ord_9" });
    expect(hits.find((h) => h.path.endsWith("/ship"))!.body).toEqual({ courierId: "cour-1", rateId: "rate-1" });
  });
  it("never ships (no charge) when Shipora X did not store the address or pickup warehouse", async () => {
    const { ctx, hits } = fakeCtx((h) => {
      if (h.path.startsWith("/api/orders?")) return { success: true, data: { orders: [] } };
      if (h.path === "/api/orders/webhook/import") return { success: true, data: { orderId: "11111111-2222-3333-4444-555555555555" } };
      return { success: true, data: { id: "11111111-2222-3333-4444-555555555555", recipient: { address: "", city: "", pincode: "411001" }, warehouse: null } };
    });
    const r = await shiporaAdapter.book(ctx, REQ);
    expect(r.ok).toBe(false);
    expect(hits.some((h) => h.path.endsWith("/ship"))).toBe(false);
    expect(hits.some((h) => h.path.endsWith("/cancel"))).toBe(true);
  });
  it("a retry finds the earlier order by reference instead of importing a second one", async () => {
    const { ctx, hits } = fakeCtx((h) => {
      if (h.path.startsWith("/api/orders?")) return { success: true, data: { orders: [{ id: "11111111-2222-3333-4444-555555555555", product_sku: "ord_9", status: "pending" }] } };
      return goodOrder("AWB777");
    });
    const r = await shiporaAdapter.book(ctx, REQ);
    expect(r).toMatchObject({ ok: true, value: { awb: "AWB777" } });
    expect(hits.some((h) => h.path === "/api/orders/webhook/import" || h.path.endsWith("/ship"))).toBe(false);
  });
});
