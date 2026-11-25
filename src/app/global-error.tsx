"use client";

/** Last resort when even the root layout fails: plain HTML, no app styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", color: "#051C46", background: "#f6f7fb" }}>
        <div style={{ maxWidth: 520, textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 24 }}>Vishwaship is having a problem</h1>
          <p style={{ color: "#4b5563" }}>Please try again in a minute. Support: support@vishwaship.com{error.digest ? ` (code ${error.digest})` : ""}</p>
          <button type="button" onClick={reset} style={{ padding: "11px 18px", borderRadius: 10, border: 0, background: "#c2410c", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
