import type { Metadata } from "next";
import { CARRIERS, SITE } from "@/lib/site";

/**
 * Search, social-preview and AI-discovery settings for the public site.
 * The site answers on vishwaship.com and vishwaship.in; APP_URL names the main one, so canonical links,
 * the sitemap and llms.txt always point there (search engines then index one copy, not two).
 */
export function siteUrl(): string {
  return (process.env.APP_URL?.trim() || "https://vishwaship.com").replace(/\/+$/, "");
}

export const BRAND = "Vishwaship";
export const TAGLINE = "Big & Small, We Ship It All";
export const DEFAULT_DESCRIPTION =
  "Compare courier rates, book parcels and cargo, schedule pickups and track shipments across India with Vishwaship — one account for B2C parcels and B2B cargo.";

export const KEYWORDS = [
  "courier service India", "courier aggregator", "shipping rate calculator", "compare courier rates", "book courier online",
  "parcel delivery India", "B2B cargo booking", "B2C shipping", "courier tracking", "AWB tracking", "doorstep pickup",
  "ecommerce shipping", "COD shipping", "Delhivery", "Blue Dart", "DTDC", "Xpressbees", "Haridwar courier", "Vishwaship",
];

/** Public pages for the sitemap and llms.txt (paths keep the site's trailing slash). */
export const PUBLIC_PAGES: Array<{ path: string; name: string; about: string; priority: number; freq: "daily" | "weekly" | "monthly" | "yearly" }> = [
  { path: "/", name: "Home", about: "Overview of Vishwaship: rate comparison, booking, pickup and tracking for parcels and cargo.", priority: 1, freq: "weekly" },
  { path: "/shipping-rate-calculator/", name: "Shipping Rate Calculator", about: "Compare B2C parcel and B2B cargo courier rates pincode to pincode, by weight and box size.", priority: 0.9, freq: "weekly" },
  { path: "/book/", name: "Book a Shipment", about: "Book a parcel or cargo shipment and get the AWB instantly.", priority: 0.9, freq: "monthly" },
  { path: "/track/", name: "Track Shipment", about: "Track any Vishwaship shipment by AWB or LR number.", priority: 0.9, freq: "monthly" },
  { path: "/online-store/", name: "Growth Package: Online Store, Ads & Shipping", about: "We build your online store, run Meta and Google ads, make creatives and ship every order.", priority: 0.8, freq: "monthly" },
  { path: "/about-us/", name: "About Us", about: "Who we are and what Vishwaship does.", priority: 0.7, freq: "monthly" },
  { path: "/customer-care/", name: "Customer Care", about: "Regional support managers and the Haridwar head office.", priority: 0.7, freq: "monthly" },
  { path: "/download-app/", name: "Android App", about: "Download the Vishwaship Android app.", priority: 0.6, freq: "monthly" },
  { path: "/signup/", name: "Create Account", about: "Open a free Vishwaship shipping account.", priority: 0.6, freq: "yearly" },
  { path: "/login/", name: "Login", about: "Customer login.", priority: 0.4, freq: "yearly" },
  { path: "/terms/", name: "Terms & Conditions", about: "Terms of service.", priority: 0.3, freq: "yearly" },
  { path: "/privacy/", name: "Privacy Policy", about: "How we handle personal data.", priority: 0.3, freq: "yearly" },
  { path: "/refund-policy/", name: "Refund & Cancellation", about: "Refund and cancellation rules.", priority: 0.3, freq: "yearly" },
  { path: "/shipping-policy/", name: "Shipping & Delivery Policy", about: "Pickups, delivery times, tracking, returns and claims.", priority: 0.3, freq: "yearly" },
];

/** Areas search engines and AI crawlers should not visit (accounts, consoles, APIs, one-time links). */
export const PRIVATE_PATHS = ["/admin/", "/portal/", "/franchise/", "/api/", "/pay/", "/t/", "/r/", "/forgot-password/", "/account-deletion/", "/app/"];

/**
 * Per-page metadata: its own title/description, canonical link on the main domain and matching Open Graph / X
 * (Twitter) tags for link previews on WhatsApp, LinkedIn, Facebook and X, with the share image public/og-image.jpg
 * (1200×630, 65 KB — WhatsApp skips images over ~300 KB).
 */
export const SHARE_IMAGE = { url: "/og-image.jpg", width: 1200, height: 630, type: "image/jpeg", alt: `${BRAND} — ${TAGLINE}. Compare courier rates, book parcels and cargo, pickup and live tracking across India.` };

export function pageMeta(path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    keywords: KEYWORDS,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: BRAND, locale: "en_IN", url: path, title, description, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGE.url] },
  };
}

/** Organization + WebSite structured data (Google knowledge panel, sitelinks search box for tracking). */
export function structuredData() {
  const url = siteUrl();
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: BRAND,
      alternateName: ["Vishwaship.com", "Vishwaship.in"],
      url: `${url}/`,
      logo: `${url}/brand/logo-icon.png`,
      email: SITE.email,
      telephone: SITE.phone,
      slogan: TAGLINE,
      address: { "@type": "PostalAddress", streetAddress: "House No. 15, Pink City & Green City, Bhadarabad / Ranipur Jhal", addressLocality: "Haridwar", addressRegion: "Uttarakhand", postalCode: "249402", addressCountry: "IN" },
      areaServed: { "@type": "Country", name: "India" },
      contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", telephone: SITE.phone, email: SITE.email, areaServed: "IN", availableLanguage: ["en", "hi"] }],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: BRAND,
      url: `${url}/`,
      potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: `${url}/track/?awb={awb}` }, "query-input": "required name=awb" },
    },
  ];
}

/** llms.txt (https://llmstxt.org): a short Markdown guide to the site for ChatGPT, Gemini, Claude and other AI tools. */
export function llmsTxt(): string {
  const url = siteUrl();
  const page = (p: (typeof PUBLIC_PAGES)[number]) => `- [${p.name}](${url}${p.path}): ${p.about}`;
  const main = PUBLIC_PAGES.filter((p) => p.priority >= 0.6);
  const rest = PUBLIC_PAGES.filter((p) => p.priority < 0.6);
  return `# ${BRAND}

> ${BRAND} (${url.replace(/^https?:\/\//, "")}, also vishwaship.in) is an Indian courier and cargo shipping platform. Businesses and individuals compare courier rates, book B2C parcels and B2B cargo, schedule doorstep pickups and track every shipment from one account. Head office: Haridwar, Uttarakhand, India.

## What Vishwaship does
- Rate comparison: see the final price of many courier services for a route, weight and box size before booking.
- Booking: B2C parcels (prepaid and cash on delivery) and B2B cargo from one account; the AWB is generated instantly and the shipping label is ready to print.
- Pickup: doorstep pickup from the customer's saved warehouses.
- Tracking: live status (in transit, out for delivery, delivered, RTO) by AWB, order or LR number, with email and WhatsApp updates.
- Weight discrepancy handling with proof, wallet and invoices, and an API for online stores.
- Growth Package: Vishwaship builds the seller's online store, runs Meta and Google ads, makes creatives and ships every order.
- Franchise programme for local partners.

## Courier partners
${CARRIERS.map((c) => c.name).join(", ")}.

## Main pages
${main.map(page).join("\n")}

## Contact
- Email: ${SITE.email}
- Phone / WhatsApp: ${SITE.phone} (${SITE.hours})
- Address: House No. 15, Pink City & Green City, Bhadarabad / Ranipur Jhal, Haridwar, Uttarakhand 249402, India

## Optional
${rest.map(page).join("\n")}
- [Sitemap](${url}/sitemap.xml)
`;
}
