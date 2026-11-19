import { z } from "zod";
import { PACKAGE_TYPES, ROV_TYPES, dimensionLimitCm, toPaise } from "./order-form";

/** Create Order form rules — the same schema validates in the browser and on the server. */
const pin = z.string().trim().regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code");
const mobile = z.string().transform((s) => s.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number"));
const optMobile = z.string().optional().transform((s) => (s ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "")).refine((s) => s === "" || /^[6-9]\d{9}$/.test(s), "Enter a 10-digit mobile number");
const addrText = (label: string) => z.string().trim().min(1, `${label} is required`).max(200).regex(/^[\w\s.,\-/#]*$/, "Only these special characters are allowed: . , - / #");
const optText = z.string().trim().max(200).regex(/^[\w\s.,\-/#]*$/, "Only these special characters are allowed: . , - / #").optional().default("");
const num = (msg: string) => z.coerce.number({ invalid_type_error: msg }).finite(msg);

const Address = {
  line1: addrText("Address Line 1"), line2: optText, pincode: pin,
  city: z.string().trim().min(2, "City is required").max(60), state: z.string().trim().min(2, "State is required").max(60),
};

export const CreateOrderForm = z.object({
  orderNumber: z.string().trim().min(1, "Order ID is required").max(40).regex(/^[\w\-/#]+$/, "Order ID can use letters, numbers, - / #"),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the order date"),
  referenceId: z.string().trim().max(60).optional().default(""),
  invoiceNumber: z.string().trim().max(40).optional().default(""),
  buyer: z.object({
    mobile, name: z.string().trim().min(2, "Buyer/Receiver name is required").max(80), altMobile: optMobile,
    email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")).default(""),
    gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN").optional().default(""),
    ...Address,
  }),
  billingSame: z.boolean().default(true),
  billing: z.object({ name: z.string().trim().min(2, "Billing name is required").max(80), mobile, ...Address }).optional(),
  products: z.array(z.object({
    name: z.string().trim().min(1, "Product name is required").max(120),
    qty: num("Quantity is required").int("Quantity must be a whole number").min(1, "Quantity must be at least 1").max(10_000),
    unitPriceRupees: num("Unit price is required").min(0.01, "Unit price is required").max(50_00_000),
    hsn: z.string().trim().regex(/^$|^\d{4,8}$/, "HSN is 4–8 digits").optional().default(""),
    category: z.string().trim().max(60).optional().default(""), sku: z.string().trim().max(60).optional().default(""),
    discountRupees: num("Discount must be a number").min(0).optional().default(0), taxPct: num("Tax must be a number").min(0).max(28).optional().default(0),
  })).min(1, "Add at least one product").max(100),
  paymentType: z.enum(["prepaid", "cod", "fod"], { errorMap: () => ({ message: "Choose Prepaid, COD or FOD" }) }),
  /** COD only: the amount the courier collects from the receiver — any amount the customer enters (defaults to the invoice value). */
  codAmountRupees: z.union([z.literal(""), z.coerce.number({ invalid_type_error: "Enter the COD amount" })]).optional(),
  warehouseId: z.string().min(1, "Select a pickup address"),
  packageType: z.enum(PACKAGE_TYPES.map((p) => p.key) as ["parcel", "heavy"], { errorMap: () => ({ message: "Select a package type" }) }),
  rovType: z.enum(ROV_TYPES.map((r) => r.key) as ["owner", "carrier"]).optional(),
  boxes: z.array(z.object({
    count: num("No. of boxes is required").int("No. of boxes must be a whole number").min(1, "At least 1 box").max(500),
    weightKg: num("Weight per box is required").positive("Weight per box must be more than 0").max(5000),
    lengthCm: num("Length is required").positive("Length must be more than 0"), breadthCm: num("Width is required").positive("Width must be more than 0"), heightCm: num("Height is required").positive("Height must be more than 0"),
  })).min(1, "Add box details").max(50),
  ewayBill: z.string().trim().optional().default(""),
});

/**
 * Checks across fields. They run on the raw form, always — zod skips object-level refinements while other fields are
 * still invalid, which would hide these errors until a second attempt.
 */
export function crossIssues(raw: unknown): Array<{ path: string; message: string }> {
  const v = (raw ?? {}) as { billingSame?: boolean; billing?: unknown; boxes?: Array<Record<string, unknown>>; products?: Array<Record<string, unknown>> };
  const out: Array<{ path: string; message: string }> = [];
  const n = (x: unknown) => Number(x) || 0;
  if (v.billingSame === false && !v.billing) out.push({ path: "billing.line1", message: "Enter the billing address" });
  const cod = (raw as { paymentType?: string; codAmountRupees?: unknown }) ?? {};
  if (cod.paymentType === "cod" && cod.codAmountRupees !== undefined && cod.codAmountRupees !== "") {
    const amt = Number(cod.codAmountRupees);
    if (!Number.isFinite(amt) || amt <= 0) out.push({ path: "codAmountRupees", message: "COD amount must be more than ₹0" });
    else if (amt > 5_00_000) out.push({ path: "codAmountRupees", message: "COD amount can be up to ₹5,00,000" });
  }
  const boxes = Array.isArray(v.boxes) ? v.boxes : [];
  const limit = dimensionLimitCm(boxes.map((b) => ({ count: n(b.count), weightKg: n(b.weightKg), lengthCm: n(b.lengthCm), breadthCm: n(b.breadthCm), heightCm: n(b.heightCm) })));
  boxes.forEach((b, i) => (["lengthCm", "breadthCm", "heightCm"] as const).forEach((k) => {
    if (n(b[k]) > limit) out.push({ path: `boxes.${i}.${k}`, message: `Can't be greater than ${limit} cm${limit === 306 ? " for each multi-box package" : ""}` });
  }));
  (Array.isArray(v.products) ? v.products : []).forEach((p, i) => {
    if (toPaise(n(p.discountRupees)) > toPaise(n(p.unitPriceRupees)) * Math.max(0, Math.round(n(p.qty)))) out.push({ path: `products.${i}.discountRupees`, message: "Discount can't exceed the line amount" });
  });
  return out;
}
export type CreateOrderFormInput = z.input<typeof CreateOrderForm>;
