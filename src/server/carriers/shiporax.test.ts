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
