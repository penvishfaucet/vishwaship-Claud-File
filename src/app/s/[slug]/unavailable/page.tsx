import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { type SfParams, resolveSf } from "../_sf";
import "@/styles/store.css";

export const dynamic = "force-dynamic";

/** Shown instead of every store page while the store's trial / plan is over. Neutral: no products, prices or reasons. */
export async function generateMetadata({ params }: { params: SfParams }): Promise<Metadata> {
  const sf = await resolveSf(params, undefined, { allowUnavailable: true });
  return { title: `${sf.name} — currently unavailable`, robots: { index: false, follow: false } };
}

export default async function StoreUnavailable({ params }: { params: SfParams }) {
  const sf = await resolveSf(params, undefined, { allowUnavailable: true });
  if (!sf.unavailable) redirect(`${sf.base}/`);
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f7fc", color: "#102a5c", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 440, textAlign: "center", background: "#fff", borderRadius: 16, padding: "32px 24px", boxShadow: "0 10px 30px rgba(11,44,106,.08)" }}>
        <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>{sf.name}</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>This store is not available right now. Please check back later.</p>
        <p style={{ margin: "14px 0 0", fontSize: 13, color: "#56637d" }}>Placed an order here already? Your order and its tracking are not affected.</p>
      </div>
    </main>
  );
}
