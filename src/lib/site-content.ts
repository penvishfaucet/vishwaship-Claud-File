import { z } from "zod";
import { CARRIERS, SITE } from "@/lib/site";

/**
 * Admin-editable public website content (Admin → Website Content). Each section is saved as a draft and
 * published separately; public pages show the published version merged over these defaults, so a missing
 * field never breaks a page. Shared by server and client (no server-only imports).
 */

const url = z.string().trim().max(500);
const text = (max = 300) => z.string().trim().max(max);

export const LinksSchema = z.object({
  customerLogin: url,
  signUp: url,
  franchiseLogin: url,
});

export const FooterSchema = z.object({
  tagline: text(200),
  phone: text(40),
  email: text(120),
  hours: text(80),
});

export const HomeSchema = z.object({
  heroLine1: text(60),
  heroLine2: text(60),
  heroText: text(300),
  primaryCta: text(60),
  secondaryCta: text(60),
  loginCta: text(40),
  dashboardCta: text(40),
  trackHeading: text(80),
  heroVideoUrl: url,
  heroPosterUrl: url,
  /** Portrait crop for phones (falls back to heroPosterUrl). */
  heroMobileUrl: url,
  offerLine: text(160),
  partnersHeading: text(80),
  servicesHeading: text(120),
  b2cTitle: text(80),
  b2cText: text(400),
  b2bTitle: text(80),
  b2bText: text(400),
  calcHeading: text(120),
  calcText: text(300),
  journeyHeading: text(120),
  featuresHeading: text(120),
  careHeading: text(120),
  careText: text(300),
  ctaTitle: text(120),
  ctaText: text(300),
});

export const AboutSchema = z.object({
  heading: text(120),
  intro: text(300),
  paragraphs: z.array(text(1200)).max(8),
  imageUrl: url,
  closingText: text(300),
});

export const CareSchema = z.object({
  heading: text(120),
  intro: text(400),
  officeHeading: text(80),
});

export const TeamMemberSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: text(80),
  role: text(120),
  region: text(60),
  /** Indian mobile, digits only. Contact buttons appear only for a complete 10-digit number. */
  phone: z.string().trim().max(20),
  whatsapp: z.string().trim().max(20),
  photoUrl: url,
  featured: z.boolean(),
  visible: z.boolean(),
  note: text(200),
});
export const TeamSchema = z.object({ members: z.array(TeamMemberSchema).max(40) });

export const OfficeSchema = z.object({
  name: text(80),
  lines: z.array(text(160)).min(1).max(6),
  mapQuery: text(300),
  lat: z.string().trim().max(20),
  lng: z.string().trim().max(20),
  mapUrl: url,
});

export const PartnerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: text(80),
  logoUrl: url,
  link: url,
  visible: z.boolean(),
});
export const PartnersSchema = z.object({ items: z.array(PartnerSchema).max(200) });

/** Starting-price offer strip (Home, Rate Calculator, Customer Dashboard). Starting prices only; quotes stay live. */
export const OffersSchema = z.object({
  visible: z.boolean(),
  showOnHome: z.boolean(),
  showOnCalculator: z.boolean(),
  showOnDashboard: z.boolean(),
  codText: text(60),
  parcelLabel: text(80),
  parcelPrice: text(20),
  cargoLabel: text(80),
  cargoPrice: text(20),
  note: text(200),
});

/** Public feature switches (Admin → Website Content → Features). */
export const FeaturesSchema = z.object({
  calculator: z.boolean(),
  tracking: z.boolean(),
  unavailableText: text(200),
});

export const SECTION_SCHEMAS = {
  links: LinksSchema, footer: FooterSchema, home: HomeSchema, about: AboutSchema,
  care: CareSchema, team: TeamSchema, office: OfficeSchema, partners: PartnersSchema,
  offers: OffersSchema, features: FeaturesSchema,
} as const;
export type SectionKey = keyof typeof SECTION_SCHEMAS;
export const SECTION_KEYS = Object.keys(SECTION_SCHEMAS) as SectionKey[];

export type Links = z.infer<typeof LinksSchema>;
export type Footer = z.infer<typeof FooterSchema>;
export type Home = z.infer<typeof HomeSchema>;
export type About = z.infer<typeof AboutSchema>;
export type Care = z.infer<typeof CareSchema>;
export type TeamMember = z.infer<typeof TeamMemberSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type Office = z.infer<typeof OfficeSchema>;
export type Partner = z.infer<typeof PartnerSchema>;
export type Partners = z.infer<typeof PartnersSchema>;
export type Offers = z.infer<typeof OffersSchema>;
export type Features = z.infer<typeof FeaturesSchema>;
export type SiteContent = { links: Links; footer: Footer; home: Home; about: About; care: Care; team: Team; office: Office; partners: Partners; offers: Offers; features: Features };

/** The carousel's original records (the logos already on the Home page). New records are only ever added. */
export const DEFAULT_PARTNERS: Partner[] = CARRIERS.map((c) => ({ id: c.code, name: c.name, logoUrl: `/couriers/${c.code}.webp`, link: "", visible: true }));

export const DEFAULTS: SiteContent = {
  links: {
    customerLogin: "https://vishwaship.in/login/",
    signUp: "https://vishwaship.in/signup/",
    franchiseLogin: "https://vishwaship.in/admin/login/",
  },
  footer: {
    tagline: "Parcels and cargo across India, managed from one account.",
    phone: SITE.phone,
    email: SITE.email,
    hours: SITE.hours,
  },
  home: {
    heroLine1: "Big & Small,",
    heroLine2: "We Ship It All.",
    heroText: "Simple shipping for parcels and cargo.",
    primaryCta: "Calculate Rates",
    secondaryCta: "Create Account",
    loginCta: "Login",
    dashboardCta: "Go to Dashboard",
    trackHeading: "Track a shipment",
    heroVideoUrl: "",
    heroPosterUrl: "/brand/hero-desktop.webp",
    heroMobileUrl: "/brand/hero-mobile.webp",
    offerLine: "COD Available • Parcels from ₹28 • Cargo from ₹8/kg",
    partnersHeading: "Our Courier Partners",
    servicesHeading: "Parcels or cargo — one account for both.",
    b2cTitle: "B2C Parcels",
    b2cText: "Everyday parcels and documents for your buyers, with prepaid and COD options on supported services.",
    b2bTitle: "B2B Cargo",
    b2bText: "Multi-carton and heavier business consignments on surface cargo services, booked from the same account.",
    calcHeading: "Know your rate before you book.",
    calcText: "Enter the pickup and delivery PIN codes with the weight and size to compare available courier rates.",
    journeyHeading: "From rate to doorstep, in four steps.",
    featuresHeading: "Everything you need to manage shipping.",
    careHeading: "Talk to the team for your region.",
    careText: "Our head-office team in Haridwar coordinates support across India.",
    ctaTitle: "Ready to ship?",
    ctaText: "Create your Vishwaship account and book your first shipment.",
  },
  about: {
    heading: "About Vishwaship",
    intro: "One connected platform for parcel and cargo shipping.",
    paragraphs: [
      "Vishwaship helps individuals and businesses manage parcel and cargo shipping through one connected platform. Our services bring together shipping-rate comparison, shipment booking, pickup coordination, tracking, and customer support.",
      "From smaller B2C parcels to larger B2B consignments, we aim to make shipping easier to manage. Customers can access available courier services, organize pickup warehouses, view shipment activity, and use eligible payment and notification features through their Vishwaship account.",
      "Our head-office team in Haridwar coordinates regional and Pan-India support. Led by Tanmay Panchal, Co-Founder and Owner, the team helps customers with their shipping requirements and service enquiries.",
    ],
    imageUrl: "/brand/hero.jpg",
    closingText: "Compare rates, book and track — or talk to our team.",
  },
  care: {
    heading: "Meet Your Vishwaship Support Team",
    intro: "Our head-office team coordinates support across India. Contact the manager responsible for your region.",
    officeHeading: "Head Office",
  },
  team: {
    members: [
      { id: "pan-india", name: "Tanmay Panchal", role: "Co-Founder & Owner — Pan-India Support", region: "Pan-India", phone: "", whatsapp: "", photoUrl: "", featured: true, visible: true, note: "Mobile number pending Admin entry" },
      { id: "north", name: "Ankit Aditya Panchal", role: "Marketing Manager — North", region: "North", phone: "8630982873", whatsapp: "8630982873", photoUrl: "", featured: false, visible: true, note: "" },
      { id: "west", name: "Peehu Panchal", role: "Marketing Manager — West", region: "West", phone: "8929590769", whatsapp: "8929590769", photoUrl: "", featured: false, visible: true, note: "" },
      { id: "south", name: "Ankit Panchal", role: "Marketing Manager — South", region: "South", phone: "786855", whatsapp: "", photoUrl: "", featured: false, visible: true, note: "Draft: only a partial number (786855) was supplied — complete it to publish contact buttons" },
      { id: "east", name: "Sanu Panchal", role: "Marketing Manager — East", region: "East", phone: "9756381094", whatsapp: "9756381094", photoUrl: "", featured: false, visible: true, note: "" },
    ],
  },
  office: {
    name: "Vishwaship Head Office",
    lines: ["House No. 15, Pink City & Green City,", "Bhadarabad / Ranipur Jhal,", "Haridwar, Uttarakhand — 249402"],
    mapQuery: "Pink City Green City, Bhadarabad, Ranipur Jhal, Haridwar, Uttarakhand 249402",
    lat: "",
    lng: "",
    mapUrl: "",
  },
  partners: { items: DEFAULT_PARTNERS },
  offers: {
    visible: true, showOnHome: true, showOnCalculator: true, showOnDashboard: true,
    codText: "COD Available",
    parcelLabel: "Parcel Shipping Starting from", parcelPrice: "₹28",
    cargoLabel: "Cargo Shipping Starting from", cargoPrice: "₹8/kg",
    note: "Final charges depend on route, weight, dimensions, service, and applicable taxes.",
  },
  features: { calculator: true, tracking: true, unavailableText: "This service is temporarily unavailable. Please contact Customer Care." },
};

/** Old account links from the previous site (replaced by the confirmed vishwaship.in pages). */
const LEGACY_LINKS: Record<string, string> = {
  "https://customer.vishwaship.com/login": "https://vishwaship.in/login/",
  "https://customer.vishwaship.com/register": "https://vishwaship.in/signup/",
  "https://admin.vishwaship.com": "https://vishwaship.in/admin/login/",
};
export function upgradeLinks(l: Links): Links {
  const up = (v: string) => LEGACY_LINKS[v.trim().replace(/\/$/, "")] ?? v;
  return { customerLogin: up(l.customerLogin), signUp: up(l.signUp), franchiseLogin: up(l.franchiseLogin) };
}

/**
 * Account links point at pages of this same site (https://vishwaship.in/login/ etc.). They are rendered as
 * site-relative paths so the session cookie, the ?next= return path and local testing all keep working;
 * on vishwaship.in the result is the identical URL. Other https links are kept as they are.
 */
export function accountHref(v: string, fallback: string, next?: string) {
  const s = safeHref(v, fallback);
  const m = /^https:\/\/(www\.)?vishwaship\.in(\/[^?#]*)?(\?[^#]*)?/i.exec(s);
  const path = m ? (m[2] || "/") + (m[3] ?? "") : s;
  if (!next || !path.startsWith("/")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}

/** 10-digit Indian mobile (6–9 start) after removing +91/0 and separators, else null. */
export function completeMobile(v: string): string | null {
  const d = v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** Merge stored partner records with the originals: originals missing from storage are appended (additive). */
export function mergePartners(stored: Partner[] | undefined): Partner[] {
  const list = [...(stored ?? [])];
  for (const p of DEFAULT_PARTNERS) if (!list.some((s) => s.id === p.id)) list.push(p);
  return list;
}

export const visiblePartners = (p: Partners) => p.items.filter((x) => x.visible && x.logoUrl);

export function mapEmbedUrl(o: Office) {
  const q = o.lat && o.lng ? `${o.lat},${o.lng}` : o.mapQuery || o.lines.join(" ");
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${o.lat && o.lng ? 17 : 15}&output=embed`;
}
export function mapOpenUrl(o: Office) {
  if (o.mapUrl) return o.mapUrl;
  const q = o.lat && o.lng ? `${o.lat},${o.lng}` : o.mapQuery || o.lines.join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Only same-site paths, https URLs or tel:/mailto: are allowed in editable links. */
export function safeHref(v: string, fallback: string) {
  const s = v.trim();
  if (/^\/(?!\/)/.test(s) || /^https:\/\//i.test(s) || /^(tel|mailto):/i.test(s)) return s;
  return fallback;
}
