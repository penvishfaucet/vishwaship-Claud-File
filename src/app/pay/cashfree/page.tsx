"use client";
import { useEffect, useState } from "react";

// window.Cashfree is typed once, globally, in src/components/portal/RechargeV2.tsx.

/**
 * Cashfree checkout launcher for the Android app (opened in a Chrome Custom Tab). The app passes the payment
 * session in the URL fragment (#sid=…&mode=…), which never reaches the server. Cashfree then returns to
 * /app/recharge/<id>/, an Android App Link, and the app asks the server for the verified status.
 * Nothing here credits the wallet: only the server's verification (webhook / reconcile) does.
 */
export default function CashfreeLauncher() {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const f = new URLSearchParams(window.location.hash.slice(1));
    const sid = f.get("sid") ?? "";
    const mode = f.get("mode") === "sandbox" ? "sandbox" : "production";
    if (!/^[\w-]{10,400}$/.test(sid)) { setErr("This payment link is incomplete. Go back to the app and try again."); return; }
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.onload = () => { void window.Cashfree?.({ mode }).checkout({ paymentSessionId: sid, redirectTarget: "_self" }); };
    s.onerror = () => setErr("Could not load Cashfree. Check your connection and try again.");
    document.body.appendChild(s);
  }, []);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 480, margin: "0 auto", color: "#051C46" }}>
      <h1 style={{ fontSize: 20 }}>Opening secure payment…</h1>
      <p>{err ?? "You will be taken to Cashfree to complete your wallet recharge."}</p>
    </main>
  );
}
