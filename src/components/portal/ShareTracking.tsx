"use client";
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, MessageCircle, Share2 } from "lucide-react";

/**
 * Share a shipment's buyer tracking link (the seller's branded page with their name and contact details).
 * WhatsApp opens a chat with the buyer when their mobile is known, otherwise the contact picker.
 */
export function ShareTracking({ url, orderNumber, business, buyerMobile }: { url: string; orderNumber: string; business: string; buyerMobile: string | null }) {
  const [copied, setCopied] = useState(false);
  const text = `Hi! Your order ${orderNumber} from ${business} has been shipped. Track it here: ${url}`;
  const digits = (buyerMobile ?? "").replace(/\D/g, "").slice(-10);
  const wa = `https://wa.me/${digits.length === 10 ? `91${digits}` : ""}?text=${encodeURIComponent(text)}`;
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  const copy = () => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
  return (
    <div className="row wrap mt12" style={{ gap: 8, alignItems: "center" }} aria-label="Share tracking link">
      <span className="small b">Share tracking:</span>
      <a className="btn btn-sm" style={{ background: "#25D366", color: "#fff", border: 0 }} href={wa} target="_blank" rel="noopener"><MessageCircle size={15} aria-hidden /> WhatsApp{digits.length === 10 ? " buyer" : ""}</a>
      <button type="button" className="btn btn-sm btn-outline" onClick={copy}>{copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? "Copied" : "Copy link"}</button>
      {canShare && <button type="button" className="btn btn-sm btn-outline" onClick={() => navigator.share({ title: `Track order ${orderNumber}`, text, url }).catch(() => undefined)}><Share2 size={15} aria-hidden /> Share</button>}
      <a className="btn btn-sm btn-outline" href={url} target="_blank" rel="noopener"><ExternalLink size={15} aria-hidden /> Open</a>
      <span className="sr-only" role="status">{copied ? "Link copied" : ""}</span>
    </div>
  );
}
