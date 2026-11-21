import { z } from "zod";

/**
 * Online store themes. Shared by the storefront (server) and the theme editor (client), so it must stay
 * free of server-only imports. A theme is a starting config; merchants then edit colours, fonts and sections.
 */

export const FONT_CHOICES = ["Poppins", "Inter", "Playfair Display", "Lora", "Montserrat", "DM Sans", "Nunito", "Merriweather"] as const;
export const SECTION_TYPES = ["announcement", "hero", "categories", "featured_products", "image_text", "testimonials", "trust_badges"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_LABEL: Record<SectionType, string> = {
  announcement: "Announcement bar",
  hero: "Sliding banner",
  categories: "Shop by category",
  featured_products: "Featured products",
  image_text: "Image with text",
  testimonials: "Customer reviews",
  trust_badges: "Trust badges",
};

/** Editable text/media fields per section type (all optional strings). */
export type SectionField = { key: string; label: string; kind: "text" | "textarea" | "image" | "select"; options?: string[]; group?: string };
export const SECTION_FIELDS: Record<SectionType, SectionField[]> = {
  announcement: [{ key: "text", label: "Message", kind: "text" }],
  hero: [
    { key: "autoplay", label: "Slide every", kind: "select", options: ["5 seconds", "7 seconds", "10 seconds", "off"] },
    { key: "align", label: "Text alignment", kind: "select", options: ["left", "center"] },
    { key: "heading", label: "Heading", kind: "text", group: "Slide 1" },
    { key: "subheading", label: "Text", kind: "textarea", group: "Slide 1" },
    { key: "image", label: "Image", kind: "image", group: "Slide 1" },
    { key: "button", label: "Button text", kind: "text", group: "Slide 1" },
    { key: "button_link", label: "Button link (blank = Shop page)", kind: "text", group: "Slide 1" },
    { key: "button2", label: "Second button text (optional)", kind: "text", group: "Slide 1" },
    { key: "button2_link", label: "Second button link", kind: "text", group: "Slide 1" },
    ...[2, 3, 4].flatMap((n) => [
      { key: `s${n}_heading`, label: "Heading (blank = slide hidden)", kind: "text" as const, group: `Slide ${n}` },
      { key: `s${n}_text`, label: "Text", kind: "textarea" as const, group: `Slide ${n}` },
      { key: `s${n}_image`, label: "Image", kind: "image" as const, group: `Slide ${n}` },
      { key: `s${n}_button`, label: "Button text", kind: "text" as const, group: `Slide ${n}` },
      { key: `s${n}_link`, label: "Button link", kind: "text" as const, group: `Slide ${n}` },
    ]),
  ],
  categories: [{ key: "heading", label: "Heading", kind: "text" }],
  featured_products: [
    { key: "heading", label: "Heading", kind: "text" },
    { key: "count", label: "Number of products", kind: "select", options: ["4", "8", "12"] },
  ],
  image_text: [
    { key: "heading", label: "Heading", kind: "text" },
    { key: "body", label: "Text", kind: "textarea" },
    { key: "image", label: "Image", kind: "image" },
  ],
  testimonials: [
    { key: "heading", label: "Heading", kind: "text" },
    { key: "items", label: "Reviews (one per line: review — name)", kind: "textarea" },
  ],
  trust_badges: [{ key: "items", label: "Badges (one per line)", kind: "textarea" }],
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a2b3c");
const mediaId = z.string().regex(/^sm_[A-Za-z0-9]{8,40}$/);

export const StoreSection = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  type: z.enum(SECTION_TYPES),
  enabled: z.boolean(),
  settings: z.record(z.string().max(60), z.string().max(2000)).default({}),
});
export type StoreSection = z.infer<typeof StoreSection>;

export const ThemeConfig = z.object({
  colors: z.object({ primary: hex, accent: hex, background: hex, text: hex }),
  fonts: z.object({ heading: z.enum(FONT_CHOICES), body: z.enum(FONT_CHOICES) }),
  radius: z.enum(["none", "soft", "round"]),
  logo: mediaId.nullable(),
  sections: z.array(StoreSection).max(20),
});
export type ThemeConfig = z.infer<typeof ThemeConfig>;

export type ThemeDef = { key: string; name: string; tagline: string; config: ThemeConfig };

const sections = (o: Partial<Record<SectionType, Record<string, string>>>, order: SectionType[]): StoreSection[] =>
  order.map((type) => ({ id: type, type, enabled: true, settings: o[type] ?? {} }));

const ORDER: SectionType[] = ["announcement", "hero", "trust_badges", "categories", "featured_products", "image_text", "testimonials"];
const COMMON = {
  trust_badges: { items: "Cash on Delivery\nFast shipping across India\nSecure payments\nEasy returns" },
  categories: { heading: "Shop by category" },
  featured_products: { heading: "Bestsellers", count: "8" },
  testimonials: { heading: "What customers say", items: "Quality is great and delivery was quick. — Priya, Pune\nPacked well, exactly as shown. — Rahul, Jaipur\nWill order again! — Ayesha, Lucknow" },
};

export const THEMES: ThemeDef[] = [
  {
    key: "bazaar", name: "Bazaar", tagline: "Warm and bold, for fashion and lifestyle",
    config: {
      colors: { primary: "#c2410c", accent: "#7c2d12", background: "#fffaf5", text: "#1c1917" },
      fonts: { heading: "Poppins", body: "Poppins" }, radius: "round", logo: null,
      sections: sections({ ...COMMON, announcement: { text: "Free shipping on prepaid orders" }, hero: { heading: "New season, new favourites", subheading: "Handpicked styles delivered to your door.", button: "Shop now", align: "left", s2_heading: "Festive edit is here", s2_text: "Bright colours and easy fits for every celebration.", s2_button: "See the edit", s3_heading: "Cash on Delivery across India", s3_text: "Pay when your order reaches you. Easy returns.", s3_button: "Start shopping" }, image_text: { heading: "Made with care", body: "Every piece is checked by hand before it ships." } }, ORDER),
    },
  },
  {
    key: "minimal", name: "Minimal", tagline: "Clean black and white, lets products speak",
    config: {
      colors: { primary: "#111111", accent: "#525252", background: "#ffffff", text: "#111111" },
      fonts: { heading: "Inter", body: "Inter" }, radius: "none", logo: null,
      sections: sections({ ...COMMON, announcement: { text: "Cash on Delivery available" }, hero: { heading: "Less, but better.", subheading: "Thoughtfully made everyday essentials.", button: "Explore", align: "center", s2_heading: "Made to last", s2_text: "Quality materials, simple design.", s2_button: "Browse all" }, image_text: { heading: "Our story", body: "We make a small range of products and make them well." } }, ORDER),
    },
  },
  {
    key: "boutique", name: "Boutique", tagline: "Elegant serif style for jewellery and gifts",
    config: {
      colors: { primary: "#14532d", accent: "#a16207", background: "#fbfaf6", text: "#1f2a1f" },
      fonts: { heading: "Playfair Display", body: "Lora" }, radius: "soft", logo: null,
      sections: sections({ ...COMMON, announcement: { text: "Gift wrapping on every order" }, hero: { heading: "Crafted to be treasured", subheading: "Timeless pieces for every occasion.", button: "View collection", align: "center", s2_heading: "Gifts they will remember", s2_text: "Gift wrapping and a handwritten note on every order.", s2_button: "Find a gift" }, image_text: { heading: "Handcrafted in India", body: "Made by skilled artisans using traditional techniques." } }, ORDER),
    },
  },
  {
    key: "fresh", name: "Fresh", tagline: "Bright and friendly, for food, beauty and kids",
    config: {
      colors: { primary: "#0f766e", accent: "#db2777", background: "#f7fdfc", text: "#0f172a" },
      fonts: { heading: "Nunito", body: "Nunito" }, radius: "round", logo: null,
      sections: sections({ ...COMMON, announcement: { text: "Order before 2 PM for same-day dispatch" }, hero: { heading: "Good things, delivered fresh", subheading: "Natural products your family will love.", button: "Start shopping", align: "left", s2_heading: "Fresh stock every week", s2_text: "Order before 2 PM for same-day dispatch.", s2_button: "Shop now" }, image_text: { heading: "Why choose us", body: "Small batches, honest ingredients and quick delivery." } }, ORDER),
    },
  },
];

export const themeByKey = (k: string) => THEMES.find((t) => t.key === k) ?? THEMES[0];
export const defaultTheme = (key = "bazaar"): ThemeConfig => structuredClone(themeByKey(key).config);

/** Parse stored config; falls back to the theme defaults when the stored value is empty or invalid. */
export function readTheme(raw: unknown, themeKey: string): ThemeConfig {
  const p = ThemeConfig.safeParse(raw);
  return p.success ? p.data : defaultTheme(themeKey);
}

export const RADIUS_PX: Record<ThemeConfig["radius"], string> = { none: "0px", soft: "8px", round: "16px" };

export const fontsHref = (c: ThemeConfig) => {
  const fams = Array.from(new Set([c.fonts.heading, c.fonts.body])).map((f) => `family=${f.replace(/ /g, "+")}:wght@400;600;700`);
  return `https://fonts.googleapis.com/css2?${fams.join("&")}&display=swap`;
};

// ---------- store settings (pages, checkout basics, SEO) ----------
export const StoreSettings = z.object({
  tagline: z.string().max(140).default(""),
  about: z.string().max(5000).default(""),
  contact: z.object({ email: z.string().max(120).default(""), phone: z.string().max(20).default(""), whatsapp: z.string().max(20).default(""), address: z.string().max(400).default("") }).default({}),
  policies: z.object({ shipping: z.string().max(8000).default(""), refund: z.string().max(8000).default(""), privacy: z.string().max(8000).default(""), terms: z.string().max(8000).default("") }).default({}),
  seo: z.object({ title: z.string().max(70).default(""), description: z.string().max(160).default("") }).default({}),
  social: z.object({ instagram: z.string().max(200).default(""), facebook: z.string().max(200).default(""), youtube: z.string().max(200).default(""), whatsapp: z.string().max(20).default("") }).default({}),
  checkout: z.object({
    codEnabled: z.boolean().default(true),
    codFeePaise: z.number().int().min(0).max(100_000).default(0),
    codMinPaise: z.number().int().min(0).max(10_000_000).default(0),
    codMaxPaise: z.number().int().min(0).max(10_000_000).default(5_000_000),
    shippingFeePaise: z.number().int().min(0).max(100_000).default(0),
    freeShippingAbovePaise: z.number().int().min(0).max(10_000_000).default(0),
    warehouseId: z.string().max(60).nullable().default(null),
  }).default({}),
});
export type StoreSettings = z.infer<typeof StoreSettings>;
export const readSettings = (raw: unknown): StoreSettings => {
  const p = StoreSettings.safeParse(raw ?? {});
  return p.success ? p.data : StoreSettings.parse({});
};

export const POLICY_KINDS = { shipping: "Shipping policy", refund: "Refund & return policy", privacy: "Privacy policy", terms: "Terms of service" } as const;
export type PolicyKind = keyof typeof POLICY_KINDS;

// ---------- onboarding ----------
export const ONBOARDING_STEPS = [
  { n: 1, key: "basics", title: "Store name & URL", optional: false },
  { n: 2, key: "branding", title: "Logo, theme, colours & fonts", optional: false },
  { n: 3, key: "products", title: "Add products", optional: false },
  { n: 4, key: "checkout", title: "Checkout, COD & shipping", optional: false },
  { n: 5, key: "domain", title: "Domain", optional: true },
  { n: 6, key: "marketing", title: "Meta & Google", optional: true },
  { n: 7, key: "launch", title: "Preview & launch", optional: false },
] as const;

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const RESERVED_SLUGS = new Set(["demo", "admin", "api", "app", "www", "portal", "store", "stores", "s", "help", "support", "login", "signup", "vishwaship", "track", "t", "static", "assets", "mail", "blog", "shop", "checkout", "cart"]);
export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** ₹1,299 for whole rupees, ₹219.80 when there are paise. */
export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// ---------- sliding banner ----------
export type HeroSlide = { heading: string; text: string; image: string; buttons: Array<{ label: string; href: string }> };

/** A merchant-typed link: store-relative paths ("/shop/", "products/x") stay inside the store; full links must be https. */
export function storeLink(raw: string | undefined, base: string, fallback: string): string {
  const v = (raw ?? "").trim();
  if (!v) return fallback;
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^\/?[A-Za-z0-9/_\-?=&.#%]*$/.test(v)) return `${base}/${v.replace(/^\/+/, "")}`;
  return fallback;
}

/** Slide 1 uses the original hero fields; slides 2-4 show only when they have a heading. */
export function heroSlides(v: Record<string, string>, base: string, fallbackHeading: string): HeroSlide[] {
  const shop = `${base}/shop/`;
  const first: HeroSlide = {
    heading: v.heading || fallbackHeading, text: v.subheading ?? "", image: v.image ?? "",
    buttons: [{ label: v.button || "Shop now", href: storeLink(v.button_link, base, shop) }, ...(v.button2 ? [{ label: v.button2, href: storeLink(v.button2_link, base, shop) }] : [])],
  };
  const more = [2, 3, 4].filter((n) => v[`s${n}_heading`]).map((n) => ({
    heading: v[`s${n}_heading`], text: v[`s${n}_text`] ?? "", image: v[`s${n}_image`] ?? "",
    buttons: v[`s${n}_button`] ? [{ label: v[`s${n}_button`], href: storeLink(v[`s${n}_link`], base, shop) }] : [],
  }));
  return [first, ...more];
}

/** Every media id a section uses (image fields), so ownership can be checked on save. */
export const sectionMediaIds = (sections: StoreSection[]) =>
  sections.flatMap((s) => SECTION_FIELDS[s.type].filter((f) => f.kind === "image").map((f) => s.settings[f.key])).filter((x): x is string => !!x && x.startsWith("sm_"));
