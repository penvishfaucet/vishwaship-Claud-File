import { describe, expect, it } from "vitest";
import { OrderInput } from "@/server/orders/create";
import { type ShopifyOrder, type WooOrder, mapShopifyOrder, mapWooOrder } from "./mapping";

const def = { lengthCm: 20, breadthCm: 15, heightCm: 10, weightKg: 0.5 };

const shop: ShopifyOrder = {
  id: 5550001, name: "#1042", currency: "INR", total_price: "1299.00", financial_status: "paid", gateway: "razorpay",
  shipping_address: { name: "Test Buyer", address1: "1 Synthetic Lane", city: "Pune", province: "Maharashtra", zip: "411 001", phone: "+91 98765 43210", country_code: "IN" },
  line_items: [{ title: "Sample mug", quantity: 2, price: "649.50", sku: "MUG-1", grams: 400 }],
};

const woo: WooOrder = {
  id: 77, number: "77", status: "processing", currency: "INR", total: "899.00", payment_method: "cod",
  shipping: { first_name: "Test", last_name: "Buyer", address_1: "2 Synthetic Road", city: "Jaipur", state: "RJ", postcode: "302001", country: "IN" },
  billing: { phone: "09876543210" },
  line_items: [{ name: "Sample lamp", quantity: 1, price: 899, sku: "L1" }],
};

describe("Shopify mapping", () => {
  it("maps a paid order to a valid prepaid B2C order", () => {
    const r = mapShopifyOrder(shop, "wh1", def);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.paymentType).toBe("prepaid");
    expect(r.input.consignee.pincode).toBe("411001");
    expect(r.input.consignee.mobile).toBe("9876543210");
    expect(r.input.packages?.[0].weightKg).toBe(0.8);
    expect(OrderInput.safeParse(r.input).success).toBe(true);
  });
  it("detects COD and skips cancelled / international orders", () => {
    const c = mapShopifyOrder({ ...shop, gateway: "Cash on Delivery (COD)", financial_status: "pending" }, "wh1", def);
    expect(c.ok && c.input.paymentType === "cod" && c.input.codAmountRupees === 1299).toBe(true);
    expect(mapShopifyOrder({ ...shop, cancelled_at: "2026-11-01" }, "wh1", def)).toMatchObject({ ok: false, skip: true });
    expect(mapShopifyOrder({ ...shop, shipping_address: { ...shop.shipping_address!, country_code: "US" } }, "wh1", def)).toMatchObject({ ok: false, skip: true });
  });
});

describe("WooCommerce mapping", () => {
  it("maps a COD processing order, expanding the state code", () => {
    const r = mapWooOrder(woo, "wh1", def);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.paymentType).toBe("cod");
    expect(r.input.codAmountRupees).toBe(899);
    expect(r.input.consignee.state).toBe("Rajasthan");
    expect(r.input.consignee.mobile).toBe("9876543210");
    expect(OrderInput.safeParse(r.input).success).toBe(true);
  });
  it("skips orders that are not ready to ship", () => {
    expect(mapWooOrder({ ...woo, status: "pending" }, "wh1", def)).toMatchObject({ ok: false, skip: true });
  });
});
