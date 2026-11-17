import { z } from "zod";

/** Field definitions shared by the Others pages (client) and the API (server). UI units: ₹, kg, cm. */
const mobile = z.string().transform((s) => s.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile"));
const pin = z.string().trim().regex(/^[1-9]\d{5}$/, "PIN code must be 6 digits");
const pos = (max: number) => z.coerce.number().min(0).max(max);

export const OTHERS = {
  customers: {
    title: "Customers", singular: "customer", desc: "Your buyers and their saved delivery addresses. Pick a saved customer when creating an order.",
    schema: z.object({
      name: z.string().trim().min(2).max(80), mobile, email: z.string().trim().email().or(z.literal("")).default(""),
      line1: z.string().trim().min(3).max(200), line2: z.string().trim().max(200).default(""), pincode: pin, city: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60),
      altLine1: z.string().trim().max(200).default(""), altPincode: z.string().trim().regex(/^$|^[1-9]\d{5}$/, "PIN code must be 6 digits").default(""), altCity: z.string().trim().max(60).default(""), altState: z.string().trim().max(60).default(""),
      notes: z.string().trim().max(300).default(""),
    }),
    fields: [["name", "Name *"], ["mobile", "Mobile *"], ["email", "Email"], ["line1", "Address *"], ["line2", "Address line 2"], ["pincode", "PIN code *"], ["city", "City *"], ["state", "State *"],
      ["altLine1", "2nd address (optional)"], ["altPincode", "2nd address PIN"], ["altCity", "2nd address city"], ["altState", "2nd address state"], ["notes", "Notes"]] as const,
    columns: [["name", "Name"], ["mobile", "Mobile"], ["email", "Email"], ["address", "Default address"], ["addresses", "Addresses"]] as const,
  },
  products: {
    title: "Products", singular: "product", desc: "Saved products with SKU, declared value, weight and size. Add them to orders in one click.",
    schema: z.object({
      name: z.string().trim().min(1).max(120), sku: z.string().trim().min(1).max(60).regex(/^[\w\-./#]+$/, "SKU can use letters, numbers and - _ . / #"),
      priceRupees: pos(5_00_000), hsn: z.string().trim().regex(/^$|^\d{4,8}$/, "HSN must be 4–8 digits").default(""),
      weightKg: pos(500), lengthCm: pos(500), breadthCm: pos(500), heightCm: pos(500), active: z.coerce.boolean().default(true),
    }),
    fields: [["name", "Product name *"], ["sku", "SKU *"], ["priceRupees", "Declared value per unit (₹) *", "number"], ["hsn", "HSN"], ["weightKg", "Default weight (kg)", "number"], ["lengthCm", "Length (cm)", "number"], ["breadthCm", "Breadth (cm)", "number"], ["heightCm", "Height (cm)", "number"]] as const,
    columns: [["name", "Product"], ["sku", "SKU"], ["price", "Declared value"], ["hsn", "HSN"], ["weight", "Weight"], ["dims", "L × B × H"]] as const,
  },
  packaging: {
    title: "Packaging", singular: "box", desc: "Reusable box / carton sizes with empty (tare) weight. Pick one when entering package details.",
    schema: z.object({ name: z.string().trim().min(1).max(60), lengthCm: z.coerce.number().positive().max(500), breadthCm: z.coerce.number().positive().max(500), heightCm: z.coerce.number().positive().max(500), tareKg: pos(50), isDefault: z.coerce.boolean().default(false) }),
    fields: [["name", "Box name *"], ["lengthCm", "Length (cm) *", "number"], ["breadthCm", "Breadth (cm) *", "number"], ["heightCm", "Height (cm) *", "number"], ["tareKg", "Empty box weight (kg)", "number"], ["isDefault", "Default box", "checkbox"]] as const,
    columns: [["name", "Box"], ["dims", "L × B × H"], ["tare", "Tare weight"], ["volumetric", "Volumetric (÷5000)"], ["isDefault", "Default"]] as const,
  },
  tags: {
    title: "Order Tags", singular: "tag", desc: "Your own labels for orders (e.g. Gift, Fragile, VIP). Filter Orders and reports by tag.",
    schema: z.object({ name: z.string().trim().min(1).max(30), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0b1f3a") }),
    fields: [["name", "Tag name *"], ["color", "Colour", "color"]] as const,
    columns: [["name", "Tag"], ["orders", "Orders"]] as const,
  },
} as const;
export type OthersKind = keyof typeof OTHERS;
