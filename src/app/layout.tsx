import type { Metadata, Viewport } from "next";
import "@/styles/vs-site.css";
import "@/styles/app.css";
import "@/styles/support.css";
import "@/styles/brand.css";
import "@/styles/tracking.css";
import "@/styles/mobile.css";
import { TableScroll } from "@/components/TableScroll";
import { BRAND, DEFAULT_DESCRIPTION, TAGLINE, siteUrl } from "@/lib/seo";
/*
 * Archivo (the site font, owner reference 2026-11-23) is loaded with a plain Google Fonts stylesheet link instead of
 * next/font/google, so builds never need to download fonts (that step failed under Turbopack and can
 * fail on hosting build servers). --font-roboto is set in app.css.
 */
/**
 * Site-wide search and link-preview tags. metadataBase = APP_URL (vishwaship.com) so canonical, og:url and the share
 * image are absolute links on the main domain even when the page is opened on vishwaship.in. Verification codes for
 * Google Search Console / Bing Webmaster Tools can be set as GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION
 * (only needed when the domain is not verified through DNS).
 */
export function generateMetadata(): Metadata {
  const title = `${BRAND} — ${TAGLINE}`;
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  return {
    metadataBase: new URL(siteUrl()),
    title,
    description: DEFAULT_DESCRIPTION,
    applicationName: BRAND,
    authors: [{ name: BRAND }],
    publisher: BRAND,
    category: "logistics",
    icons: { icon: "/favicon.png", apple: "/brand/logo-icon.png" },
    // Open Graph / X tags are set per page (pageMeta in src/lib/seo.ts), so online stores under /s/ keep their own previews.
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    verification: { ...(google ? { google } : {}), ...(bing ? { other: { "msvalidate.01": bing } } : {}) },
  };
}

export const viewport: Viewport = { themeColor: "#13214a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;500;600;700;800;900&display=swap" />
      </head>
      <body>{children}<TableScroll /></body>
    </html>
  );
}
