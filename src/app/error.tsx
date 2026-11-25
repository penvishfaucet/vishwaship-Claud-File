"use client";
import { useEffect } from "react";

/** Something failed while showing a page: a calm message and a retry, never a raw error. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "32px 16px", fontFamily: "Archivo, system-ui, sans-serif", color: "#051C46" }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong</h1>
        <p style={{ color: "#4b5563", margin: "0 0 20px" }}>Please try again. If it keeps happening, contact support@vishwaship.com{error.digest ? ` and mention code ${error.digest}` : ""}.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={reset} style={{ padding: "11px 18px", borderRadius: 10, border: 0, background: "#c2410c", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Try again</button>
          <a href="/" style={{ padding: "10px 18px", borderRadius: 10, border: "1.5px solid #051C46", color: "#051C46", fontWeight: 700, textDecoration: "none" }}>Home</a>
        </div>
      </div>
    </main>
  );
}
