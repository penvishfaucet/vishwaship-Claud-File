import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { shiprocketAdapter: sr, parseCourier, parseTrack, _resetShiprocketTokens } = await import("@/server/providers/shiprocket");
const { hideProviders } = await import("@/server/customer-safe");

type Hit = { method: string; path: string; body: unknown; auth: string | null };
function fakeCtx(handler: (h: Hit) => { status?: number; json: unknown }, config: Record<string, unknown> = {}) {
  const hits: Hit[] = [];
  const ctx = {
    accountId: "pa_sr", mode: "live", config, secrets: { email: "api@shop.test", password: "pw" },
    fetch: async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      expect(u.host).toBe("apiv2.shiprocket.in");
      const h: Hit = { method: init.method ?? "GET", path: u.pathname.replace("/v1/external", "") + u.search, body: init.body ? JSON.parse(String(init.body)) : null, auth: (init.headers as Record<string, string>)?.authorization ?? null };
      hits.push(h);
      if (h.path === "/auth/login") return new Response(JSON.stringify({ token: "tok-1" }), { status: 200 });
      const r = handler(h);
      return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
    },
  };
  return { ctx: ctx as never, hits };
}

const ROWS = [
  { courier_company_id: 10, courier_name: "Delhivery Surface", rate: 85.5, freight_charge: 85.5, cod_charges: 0, estimated_delivery_days: "4", charge_weight: 0.5, etd: "Nov 27, 2026" },
  { courier_company_id: 24, courier_name: "Xpressbees Surface", rate: 72, cod_charges: 0, estimated_delivery_days: "5", charge_weight: 1 },
  { courier_company_id: 99, courier_name: "Broken", rate: 0 },
];
const QREQ = { mode: "B2C" as const, direction: "forward" as const, originPincode: "249402", destinationPincode: "411001", paymentType: "prepaid" as const, codAmount: 0, declaredValue: 50000,
  packages: [{ count: 1, lengthMm: 200, breadthMm: 150, heightMm: 100, actualWeightGrams: 400 }] };
const BREQ = {
  vishwashipOrderId: "ord_9", orderNumber: "VS-9", quote: { carrierCode: "delhivery", serviceName: "Delhivery Surface", providerQuoteRef: "shiprocket:10" },
  mode: "B2C" as const, paymentType: "cod" as const, codAmount: 99900, declaredValue: 99900,
  pickup: { name: "Ravi", mobile: "9876543210", line1: "Plot 1", pincode: "249402", city: "Haridwar", state: "Uttarakhand", providerWarehouseRef: "VSWH1" },
  consignee: { name: "Asha Rani Gupta", mobile: "+91 91234 56780", line1: "Flat 4, Sector 1", pincode: "411001", city: "Pune", state: "Maharashtra" },
  packages: [{ count: 1, lengthMm: 200, breadthMm: 150, heightMm: 100, actualWeightGrams: 1200 }], products: [{ name: "Shoes", sku: "SH-1", qty: 1, unitPrice: 99900 }],
};

beforeEach(() => _resetShiprocketTokens());

describe("Shiprocket rates", () => {
  it("logs in once, asks serviceability in kg / cm / rupees and maps every valid courier", async () => {
    const { ctx, hits } = fakeCtx(() => ({ json: { status: 200, data: { available_courier_companies: ROWS } } }));
    const r = await sr.quote(ctx, QREQ as never);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value).toHaveLength(2);
    expect(r.value[0]).toMatchObject({ provider: "shiprocket", carrierCode: "delhivery", serviceName: "Delhivery Surface", etaDays: 4, taxInclusive: false, chargeableWeightGrams: 500, providerQuoteRef: "shiprocket:10", components: [{ code: "freight", amount: 8550 }] });
    expect(r.value[1].chargeableWeightGrams).toBe(1000);
    const q = new URL(`https://x${hits[1].path}`).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ pickup_postcode: "249402", delivery_postcode: "411001", weight: "0.4", cod: "0", declared_value: "500", length: "20", breadth: "15", height: "10" });
    expect(hits[1].auth).toBe("Bearer tok-1");
    await sr.quote(ctx, QREQ as never);
    expect(hits.filter((h) => h.path === "/auth/login")).toHaveLength(1); // token reused
  });

  it("splits the COD fee, honours the courier allow-list and GST basis, and stays out of B2B / FOD / multi-box", async () => {
    const p = parseCourier({ courier_company_id: 5, courier_name: "Ekart", rate: 120, cod_charges: 40 }, { cod: true, gstTreatment: "inclusive", actualGrams: 300 });
    if ("error" in p) throw new Error(p.error);
    expect(p.quote.components).toEqual([{ code: "freight", label: "Freight & surcharges", amount: 8000 }, { code: "cod_fee", label: "COD charge", amount: 4000 }]);
    expect(p.quote.taxInclusive).toBe(true);
    const { ctx } = fakeCtx(() => ({ json: { data: { available_courier_companies: ROWS } } }), { courierIds: ["24"] });
    const r = await sr.quote(ctx, QREQ as never);
    expect(r.ok && r.value.map((x) => x.providerQuoteRef)).toEqual(["shiprocket:24"]);
    for (const bad of [{ mode: "B2B" }, { paymentType: "fod" }, { packages: [{ ...QREQ.packages[0], count: 2 }] }]) {
      const x = await sr.quote(ctx, { ...QREQ, ...bad } as never);
      expect(x.ok && x.value).toEqual([]);
    }
  });

  it("re-logs in once when the token is rejected, and reports a bad API user as auth", async () => {
    let n = 0;
    const { ctx, hits } = fakeCtx(() => (++n === 1 ? { status: 401, json: { message: "Token has expired" } } : { json: { data: { available_courier_companies: ROWS } } }));
    expect((await sr.quote(ctx, QREQ as never)).ok).toBe(true);
    expect(hits.filter((h) => h.path === "/auth/login")).toHaveLength(2);
    const bad = { accountId: "pa_x", mode: "live", config: {}, secrets: { email: "a@b.c", password: "x" }, fetch: async () => new Response(JSON.stringify({ message: "Invalid email and password combination" }), { status: 400 }) };
    const r = await sr.health(bad as never);
    expect(!r.ok && r.error.category).toBe("auth");
  });
});

describe("Shiprocket booking", () => {
  it("creates the order, assigns the quoted courier, requests pickup and returns order/shipment ref + AWB", async () => {
    const { ctx, hits } = fakeCtx((h) => {
      if (h.path === "/orders/create/adhoc") return { json: { order_id: 7001, shipment_id: 8001, status: "NEW", status_code: 1 } };
      if (h.path === "/courier/assign/awb") return { json: { awb_assign_status: 1, response: { data: { awb_code: "1490000123", courier_name: "Delhivery Surface" } } } };
      if (h.path === "/courier/generate/pickup") return { json: { pickup_status: 1, response: { pickup_token_number: "PK-55" } } };
      return { status: 404, json: { message: "nope" } };
    });
    const r = await sr.book(ctx, BREQ as never);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value).toMatchObject({ providerOrderRef: "7001/8001", awb: "1490000123", state: "confirmed", labelAvailable: true, pickupRef: "PK-55", pickupScheduled: true });
    const body = hits.find((h) => h.path === "/orders/create/adhoc")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ order_id: "ord_9", pickup_location: "VSWH1", billing_customer_name: "Asha", billing_last_name: "Rani Gupta", billing_phone: "9123456780", payment_method: "COD", sub_total: 999, weight: 1.2, length: 20, breadth: 15, height: 10 });
    expect(hits.find((h) => h.path === "/courier/assign/awb")!.body).toEqual({ shipment_id: 8001, courier_id: 10 });
  });

  it("cancels the empty order when no AWB can be assigned (e.g. low wallet) and never invents one", async () => {
    const { ctx, hits } = fakeCtx((h) => {
      if (h.path === "/orders/create/adhoc") return { json: { order_id: 7002, shipment_id: 8002 } };
      if (h.path === "/courier/assign/awb") return { json: { awb_assign_status: 0, message: "Insufficient balance in wallet" } };
      if (h.path === "/orders/cancel") return { json: { message: "cancelled" } };
      return { status: 404, json: {} };
    });
    const r = await sr.book(ctx, BREQ as never);
    expect(!r.ok && r.error.message).toMatch(/Insufficient balance/);
    expect(hits.find((h) => h.path === "/orders/cancel")!.body).toEqual({ ids: [7002] });
  });

  it("a timeout while creating is ambiguous, and lookup finds the order by our own id", async () => {
    const { ctx } = fakeCtx((h) => {
      if (h.path === "/orders/create/adhoc") return { status: 502, json: {} };
      if (h.path.startsWith("/orders?search=ord_9")) return { json: { data: [{ id: 7003, channel_order_id: "ord_9", status: "READY TO SHIP", shipments: [{ id: 8003, awb: "149000999" }] }] } };
      return { status: 404, json: {} };
    });
    const r = await sr.book(ctx, BREQ as never);
    expect(!r.ok && r.error.category).toBe("ambiguous");
    const l = await sr.lookupBooking(ctx, { vishwashipOrderId: "ord_9", providerOrderRef: null } as never);
    expect(l.ok && l.value).toMatchObject({ providerOrderRef: "7003/8003", awb: "149000999", state: "confirmed" });
  });

  it("label returns the PDF link, cancel sends the Shiprocket order id", async () => {
    const { ctx, hits } = fakeCtx((h) => {
      if (h.path === "/courier/generate/label") return { json: { label_created: 1, label_url: "https://kr-shipmultichannel.s3.ap-south-1.amazonaws.com/l.pdf" } };
      if (h.path === "/orders/cancel") return { json: { status: 200 } };
      return { status: 404, json: {} };
    });
    const l = await sr.label(ctx, { providerOrderRef: "7001/8001", awb: "1490000123" }, "thermal_4x6");
    expect(l.ok && l.value.url).toMatch(/^https:.*\.pdf$/);
    expect(hits[1].body).toEqual({ shipment_id: [8001] });
    const c = await sr.cancel(ctx, { providerOrderRef: "7001/8001", awb: "1490000123" } as never);
    expect(c.ok).toBe(true);
    expect(hits.at(-1)!.body).toEqual({ ids: [7001] });
  });
});

describe("Shiprocket tracking and customer text", () => {
  it("maps tracking activities (IST times) to normalised statuses", () => {
    const t = parseTrack({ tracking_data: { track_status: 1, shipment_track: [{ awb_code: "149", courier_name: "Delhivery", current_status: "Delivered", edd: "2026-11-27 18:00:00" }],
      shipment_track_activities: [
        { date: "2026-11-25 19:10:00", status: "X-DLL2F", activity: "Delivered to consignee", location: "Pune", "sr-status-label": "DELIVERED" },
        { date: "2026-11-23 10:00:00", activity: "Shipment picked up", location: "Haridwar", "sr-status-label": "PICKED UP" },
        { date: "2026-11-24 08:00:00", activity: "Bagged", location: "Delhi Hub", "sr-status-label": "IN TRANSIT" },
      ] } }, "149");
    expect(t.status).toBe("delivered");
    expect(t.events.map((e) => e.status)).toEqual(["picked_up", "in_transit", "delivered"]);
    expect(t.events[0].occurredAt).toBe("2026-11-23T04:30:00.000Z");
  });

  it("customer messages never name Shiprocket", () => {
    expect(hideProviders("Shiprocket rejected: see https://apiv2.shiprocket.in/v1/x")).toBe("Courier partner rejected: see courier partner");
    expect(hideProviders("Ship Rocket error")).toBe("Courier partner error");
  });
});

describe("Shiprocket pickup address", () => {
  const W = { code: "WH1", label: "Main", contactName: "Ravi", mobile: "9876543210", line1: "Plot 1, Industrial Area", pincode: "249402", city: "Haridwar", state: "Uttarakhand" };
  it("uses the address the owner already added in Shiprocket at the same PIN, without creating a duplicate", async () => {
    const { ctx, hits } = fakeCtx(() => ({ json: { data: { shipping_address: [{ pickup_location: "Other", pin_code: "110001", status: 2 }, { pickup_location: "OtherCustomer", pin_code: "249402", phone: "9000000001", status: 2 }, { pickup_location: "Home", pin_code: "249402", phone: "+91 98765 43210", status: 2 }] } } }));
    const r = await sr.registerWarehouse!(ctx, W);
    expect(r.ok && r.value.ref).toBe("Home");
    expect(hits.some((h) => h.path.includes("addpickup"))).toBe(false);
  });
  it("a different person at the same PIN gets their own new pickup address", async () => {
    const { ctx, hits } = fakeCtx((h) => (h.path.includes("addpickup") ? { json: { success: true } } : { json: { data: { shipping_address: [{ pickup_location: "Home", pin_code: "249402", phone: "9000000001", status: 2 }] } } }));
    const r = await sr.registerWarehouse!(ctx, W);
    expect(r.ok && r.value.ref).toBe("VSWH1");
    expect(hits.find((h) => h.path.includes("addpickup"))!.body).toMatchObject({ pickup_location: "VSWH1", pin_code: "249402", phone: "9876543210", country: "India" });
  });
});
