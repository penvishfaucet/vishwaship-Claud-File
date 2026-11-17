import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "@/styles/vs-site.css";
import "@/styles/app.css";

const roboto = Roboto({ subsets: ["latin"], weight: ["300", "400", "500", "700", "900"], variable: "--font-roboto", display: "swap" });

export const metadata: Metadata = {
  title: "Vishwaship.com — Doorstep Courier & Cargo Across India",
  description: "Ship anywhere in India. Check the final rate, book, get your AWB instantly and track every parcel from one dashboard.",
  icons: { icon: "/favicon.png" },
};

export const viewport: Viewport = { themeColor: "#13214a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.variable}>
      <body>{children}</body>
    </html>
  );
}
