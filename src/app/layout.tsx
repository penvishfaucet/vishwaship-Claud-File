import type { Metadata, Viewport } from "next";
import "@/styles/vs-site.css";
import "@/styles/app.css";
import "@/styles/support.css";
import "@/styles/brand.css";
import "@/styles/mobile.css";
import { TableScroll } from "@/components/TableScroll";

/*
 * Archivo (the site font, owner reference 2026-11-23) is loaded with a plain Google Fonts stylesheet link instead of
 * next/font/google, so builds never need to download fonts (that step failed under Turbopack and can
 * fail on hosting build servers). --font-roboto is set in app.css.
 */
export const metadata: Metadata = {
  title: "Vishwaship.com — Doorstep Courier & Cargo Across India",
  description: "Ship anywhere in India. Check the final rate, book, get your AWB instantly and track every parcel from one dashboard.",
  icons: { icon: "/favicon.png" },
};

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
