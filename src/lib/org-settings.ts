import { z } from "zod";

/** Per-account settings stored in org_settings, validated identically on client and server. */
const code = z.string().regex(/^[a-z0-9-]{2,40}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const logo = z.string().max(210_000).regex(/^$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Logo must be PNG, JPG or WebP");

/** Default label format choices (the Vishwaship label sizes; see PRINT_FORMATS in order-view). */
export const LABEL_FORMATS = [
  { key: "thermal_4x6", name: "Thermal 4 × 6 in", w: "4in", h: "6in" },
  { key: "thermal_3x4", name: "Thermal 3 × 4 in", w: "3in", h: "4in" },
  { key: "thermal_4x4", name: "Thermal 4 × 4 in", w: "4in", h: "4in" },
  { key: "thermal_2x4", name: "Thermal 2 × 4 in", w: "2in", h: "4in" },
  { key: "thermal_38x100", name: "Thermal 38 × 100 mm", w: "38mm", h: "100mm" },
  { key: "thermal_38x200", name: "Thermal 38 × 200 mm", w: "38mm", h: "200mm" },
  { key: "a4_1up", name: "A4 · 1 label per page", w: "210mm", h: "297mm" },
  { key: "a4_fit", name: "A4 · all labels of a shipment on one page", w: "210mm", h: "297mm" },
  { key: "a4_doc", name: "A4 · label + invoice on one page", w: "210mm", h: "297mm" },
  { key: "a4_2up", name: "A4 · 2 labels per page", w: "210mm", h: "297mm" },
  { key: "a4_4up", name: "A4 · 4 labels per page", w: "210mm", h: "297mm" },
  { key: "original", name: "Courier's own label", w: "4in", h: "6in" },
] as const;

export const ORG_SETTING_SCHEMAS = {
  courier_prefs: z.object({ disabled: z.array(code).max(60).default([]), priority: z.array(code).max(60).default([]) }),
  label_settings: z.object({
    // older saves used "a4" (now A4 2 per page)
    format: z.preprocess((x) => (x === "a4" ? "a4_2up" : x), z.enum(LABEL_FORMATS.map((f) => f.key) as [string, ...string[]])).default("a4_fit"),
    showSellerAddress: z.boolean().default(true), showProducts: z.boolean().default(true), showCodAmount: z.boolean().default(true),
    showOrderValue: z.boolean().default(false), showSellerPhone: z.boolean().default(true), showLogo: z.boolean().default(false),
  }),
  invoice_settings: z.object({
    businessName: z.string().trim().min(2).max(80), gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN").default(""),
    address: z.string().trim().max(300).default(""), phone: z.string().trim().max(20).default(""), email: z.string().trim().email().or(z.literal("")).default(""),
    logo: logo.default(""), prefix: z.string().trim().max(10).regex(/^[A-Za-z0-9/-]*$/).default("INV-"), footer: z.string().trim().max(300).default("Thank you for shopping with us."),
    signatureText: z.string().trim().max(60).default("Authorised signatory"), showHsn: z.boolean().default(true), color: hex.default("#0b1f3a"),
  }),
  edd_widget: z.object({
    enabled: z.boolean().default(false), heading: z.string().trim().max(60).default("Check delivery date"), buttonText: z.string().trim().max(24).default("Check"),
    color: hex.default("#f0712c"), processingDays: z.number().int().min(0).max(10).default(1), cutoffHour: z.number().int().min(0).max(23).default(14),
    allowedOrigins: z.array(z.string().trim().url().max(120)).max(10).default([]), showCourier: z.boolean().default(false),
  }),
  /** WhatsApp COD confirmation: the parts of the approved template the client fills in. */
  cod_message: z.object({
    storeName: z.string().trim().max(40).default(""),
    supportPhone: z.string().trim().max(20).regex(/^$|^[+\d][\d\s-]{6,19}$/, "Enter a phone number").default(""),
    note: z.string().trim().max(120).default(""),
    language: z.enum(["en", "hi"]).default("en"),
  }),
  oms: z.object({
    provider: z.enum(["unicommerce", "easyecom", "vinculum", "browntape", "custom"]), accountName: z.string().trim().min(2).max(80),
    pushShipmentUpdates: z.boolean().default(true), notes: z.string().trim().max(300).default(""),
  }),
} as const;
export type OrgSettingKey = keyof typeof ORG_SETTING_SCHEMAS;
export type OrgSettingValue<K extends OrgSettingKey> = z.output<(typeof ORG_SETTING_SCHEMAS)[K]>;
