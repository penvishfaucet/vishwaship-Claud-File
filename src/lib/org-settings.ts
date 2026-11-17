import { z } from "zod";

/** Per-account settings stored in org_settings, validated identically on client and server. */
const code = z.string().regex(/^[a-z0-9-]{2,40}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const logo = z.string().max(210_000).regex(/^$|^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Logo must be PNG, JPG or WebP");

export const LABEL_FORMATS = [
  { key: "thermal_4x6", name: "4 × 6 in (thermal)", w: "4in", h: "6in" },
  { key: "thermal_3x4", name: "3 × 4 in (thermal)", w: "3in", h: "4in" },
  { key: "thermal_4x4", name: "4 × 4 in (thermal)", w: "4in", h: "4in" },
  { key: "thermal_2x4", name: "2 × 4 in (thermal)", w: "2in", h: "4in" },
  { key: "thermal_38x100", name: "38 × 100 mm (thermal)", w: "38mm", h: "100mm" },
  { key: "a4", name: "A4 (plain paper)", w: "210mm", h: "297mm" },
] as const;

export const ORG_SETTING_SCHEMAS = {
  courier_prefs: z.object({ disabled: z.array(code).max(60).default([]), priority: z.array(code).max(60).default([]) }),
  label_settings: z.object({
    format: z.enum(LABEL_FORMATS.map((f) => f.key) as [string, ...string[]]).default("thermal_4x6"),
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
  oms: z.object({
    provider: z.enum(["unicommerce", "easyecom", "vinculum", "browntape", "custom"]), accountName: z.string().trim().min(2).max(80),
    pushShipmentUpdates: z.boolean().default(true), notes: z.string().trim().max(300).default(""),
  }),
} as const;
export type OrgSettingKey = keyof typeof ORG_SETTING_SCHEMAS;
export type OrgSettingValue<K extends OrgSettingKey> = z.output<(typeof ORG_SETTING_SCHEMAS)[K]>;
