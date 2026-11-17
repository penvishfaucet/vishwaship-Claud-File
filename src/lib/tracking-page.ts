import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #0b1f3a");

/** Logo is stored as a small data URL (PNG/JPEG/WebP ≤ 150 KB). Rendered only via <img>, never as HTML. */
const logo = z.string().max(210_000, "Logo must be under 150 KB")
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Logo must be a PNG, JPG or WebP image").or(z.literal(""));

export const TrackingPageSettings = z.object({
  businessName: z.string().trim().min(2).max(60),
  logo: logo.default(""),
  primaryColor: hex.default("#0b1f3a"),
  accentColor: hex.default("#f0712c"),
  headline: z.string().trim().max(80).default("Track your order"),
  message: z.string().trim().max(400).default(""),
  supportEmail: z.string().trim().email().max(120).or(z.literal("")).default(""),
  supportPhone: z.string().trim().max(20).regex(/^[+\d\s-]*$/, "Digits only").default(""),
  supportHours: z.string().trim().max(60).default(""),
  showCarrier: z.boolean().default(true),
  footerText: z.string().trim().max(120).default(""),
});

export type TrackingPageSettings = z.infer<typeof TrackingPageSettings>;

export const defaultTrackingSettings = (businessName: string): TrackingPageSettings => ({
  businessName, logo: "", primaryColor: "#0b1f3a", accentColor: "#f0712c", headline: "Track your order", message: "",
  supportEmail: "", supportPhone: "", supportHours: "", showCarrier: true, footerText: "",
});

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "store";
