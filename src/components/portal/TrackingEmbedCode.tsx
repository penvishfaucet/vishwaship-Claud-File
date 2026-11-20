"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** "Add to your website": copy-ready code for the branded tracking page and how to paste it. */
export function TrackingEmbedCode({ appUrl, slug, published }: { appUrl: string; slug: string; published: boolean }) {
  const script = `<div id="vishwaship-tracking"></div>\n<script src="${appUrl}/track-embed.js" data-store="${slug}" async></script>`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (k: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(null), 2000); } catch { /* clipboard blocked */ } };
  const Box = ({ k, v }: { k: string; v: string }) => (
    <div className="te-code"><pre>{v}</pre><button type="button" className="btn btn-sm btn-outline" onClick={() => copy(k, v)}>{copied === k ? <><Check size={14} aria-hidden /> Copied</> : <><Copy size={14} aria-hidden /> Copy</>}</button></div>
  );
  return (
    <section className="card mt16" style={{ padding: 18 }} aria-labelledby="te-h">
      <h2 id="te-h" className="b" style={{ fontSize: 16, margin: 0 }}>Add the tracking page to your website</h2>
      <p className="small muted" style={{ margin: "4px 0 12px" }}>Paste this code on a page of your own website (for example “Track Order”). Your buyers track with your logo and colours, on your domain.{!published && <b> Publish the page above first.</b>}</p>
      <Box k="script" v={script} />
      <div className="te-steps">
        <div><b>Shopify</b><span>Online Store → Pages → Add page “Track Order” → click <b>&lt;/&gt;</b> (Show HTML) → paste → Save. Add the page to your menu.</span></div>
        <div><b>WooCommerce / WordPress</b><span>Pages → Add New → add a <b>Custom HTML</b> block → paste → Publish.</span></div>
        <div><b>Wix / Squarespace</b><span>Add an <b>Embed / HTML code</b> element to a page → paste → Publish.</span></div>
        <div><b>Custom website</b><span>Paste the code where the tracker should appear in your page’s HTML.</span></div>
      </div>
      <p className="tiny muted" style={{ margin: "10px 0 6px" }}>Tip: link to <code>yourwebsite.com/track-order?awb=AWB_NUMBER</code> in your emails and the shipment opens directly.</p>
      <p className="tiny muted" style={{ margin: "0" }}>If your website builder does not allow scripts, add a “Track order” button or menu link to your Vishwaship tracking page instead: <a className="link" href={`${appUrl}/t/${slug}/`} target="_blank" rel="noopener">{appUrl}/t/{slug}/</a></p>
    </section>
  );
}
