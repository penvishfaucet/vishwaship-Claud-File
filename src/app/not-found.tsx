import Link from "next/link";
import type { Metadata } from "next";
import { BrandLogo } from "@/components/BrandLogo";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Page not found — Vishwaship", description: "This page does not exist. Track a shipment, check courier rates or go to the Vishwaship home page.", robots: { index: false, follow: true } };

const btn = (primary: boolean): React.CSSProperties => ({ display: "inline-block", padding: "12px 20px", borderRadius: 10, fontWeight: 700, textDecoration: "none", border: "1.5px solid #051C46", background: primary ? "#c2410c" : "#fff", borderColor: primary ? "#c2410c" : "#051C46", color: primary ? "#fff" : "#051C46" });

/** Custom 404: a way back to the main tasks instead of a dead end. */
export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 16px", background: "#f6f7fb", fontFamily: "Archivo, system-ui, sans-serif", color: "#051C46" }}>
      <div style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
        <Link href="/" aria-label="Vishwaship home"><BrandLogo height={44} /></Link>
        <p style={{ fontSize: 72, fontWeight: 900, margin: "24px 0 0", lineHeight: 1, color: "#c2410c" }}>404</p>
        <h1 style={{ fontSize: 26, margin: "8px 0" }}>This page could not be found</h1>
        <p style={{ color: "#4b5563", margin: "0 0 24px" }}>The link may be old or mistyped. Here is where you can go instead:</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/track/" style={btn(true)}>Track a shipment</Link>
          <Link href="/shipping-rate-calculator/" style={btn(false)}>Check courier rates</Link>
          <Link href="/" style={btn(false)}>Home</Link>
        </div>
        <p style={{ color: "#6b7280", fontSize: 14, marginTop: 28 }}>Need help? <a href={`mailto:${SITE.email}`} style={{ color: "#051C46" }}>{SITE.email}</a> · {SITE.phone}</p>
      </div>
    </main>
  );
}
