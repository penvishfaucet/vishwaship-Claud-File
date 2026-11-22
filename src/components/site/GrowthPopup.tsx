"use client";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

/** Home page: the Growth Package slides in once per browser session after a few seconds; closing it keeps it closed. */
export function GrowthPopup() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem("vs-gp-pop")) return; } catch { /* storage blocked: still show once */ }
    const t = setTimeout(() => setShow(true), 6000);
    return () => clearTimeout(t);
  }, []);
  const close = () => { setShow(false); try { sessionStorage.setItem("vs-gp-pop", "1"); } catch { /* ignore */ } };
  if (!show) return null;
  return (
    <aside className="gp-pop" role="dialog" aria-label="Create your online store">
      <div className="hd"><span>🚀 Create your online store</span><button type="button" onClick={close} aria-label="Close"><X size={18} aria-hidden="true" /></button></div>
      <ul>
        {["Website built for you", "Meta & Google Ads handled", "Shipping from ₹28 · WhatsApp COD confirm", "₹0 monthly · 1.5% only on delivered"].map((x) => <li key={x}><Check size={16} aria-hidden="true" />{x}</li>)}
      </ul>
      <div className="ft"><Link className="gp-btn or" style={{ width: "100%" }} href="/online-store/" onClick={close}>See the package</Link></div>
    </aside>
  );
}
