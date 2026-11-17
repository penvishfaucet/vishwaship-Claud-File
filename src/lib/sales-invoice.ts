import { formatINR } from "@/lib/money";

/** Seller → buyer sales invoice HTML. Used by the real invoice download and by the settings preview. */
export interface InvoiceLook {
  businessName: string; gstin?: string; address?: string; phone?: string; email?: string; logo?: string;
  prefix?: string; footer?: string; signatureText?: string; showHsn?: boolean; color?: string;
}
export interface InvoiceData {
  number: string; date: string; consignee: { name: string; line1: string; city: string; state: string; pincode: string }; buyerGstin?: string | null;
  items: Array<{ name: string; qty: number; unitPrice: number; hsn?: string }>; payment: string; shippedVia?: string; ewayBill?: string | null;
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeColor = (c?: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#0b1f3a");
const safeLogo = (l?: string) => (l && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(l) ? l : "");

export function invoiceBodyHtml(look: InvoiceLook, d: InvoiceData) {
  const total = d.items.reduce((t, i) => t + i.qty * i.unitPrice, 0);
  const col = safeColor(look.color);
  const logo = safeLogo(look.logo);
  const hsn = look.showHsn !== false;
  return `<div class="inv" style="--c:${col}">
<div class="hd"><div>${logo ? `<img src="${logo}" alt="" style="max-height:48px;max-width:180px">` : ""}<div class="bn">${esc(look.businessName)}</div>
<div>${esc(look.address ?? "")}</div>${look.gstin ? `<div>GSTIN ${esc(look.gstin)}</div>` : ""}${look.phone || look.email ? `<div>${esc([look.phone, look.email].filter(Boolean).join(" · "))}</div>` : ""}</div>
<div class="r"><h2>Invoice</h2><div>No. ${esc(`${look.prefix ?? ""}${d.number}`)}</div><div>Date ${esc(d.date)}</div></div></div>
<div class="g"><div><b>Bill / ship to</b><br>${esc(d.consignee.name)}<br>${esc(d.consignee.line1)}, ${esc(d.consignee.city)}, ${esc(d.consignee.state)} ${esc(d.consignee.pincode)}${d.buyerGstin ? `<br>GSTIN ${esc(d.buyerGstin)}` : ""}</div>
<div><b>Payment</b><br>${esc(d.payment)}${d.shippedVia ? `<br>${esc(d.shippedVia)}` : ""}${d.ewayBill ? `<br>E-way bill ${esc(d.ewayBill)}` : ""}</div></div>
<table><thead><tr><th>Item</th>${hsn ? "<th>HSN</th>" : ""}<th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
${d.items.map((i) => `<tr><td>${esc(i.name)}</td>${hsn ? `<td>${esc(i.hsn ?? "")}</td>` : ""}<td class="r">${i.qty}</td><td class="r">${esc(formatINR(i.unitPrice))}</td><td class="r">${esc(formatINR(i.qty * i.unitPrice))}</td></tr>`).join("")}
<tr><th colspan="${hsn ? 4 : 3}" class="r">Total</th><th class="r">${esc(formatINR(total))}</th></tr></tbody></table>
<div class="ft"><div>${esc(look.footer ?? "")}</div><div class="r"><div style="height:36px"></div>${esc(look.signatureText ?? "Authorised signatory")}<br>for ${esc(look.businessName)}</div></div></div>`;
}

export const INVOICE_CSS = `.inv{font:12px/1.5 Arial,sans-serif;color:#111}.inv table{width:100%;border-collapse:collapse}.inv td,.inv th{border:1px solid #bbb;padding:6px;text-align:left}.inv th{background:color-mix(in srgb,var(--c) 10%,#fff)}.inv .r{text-align:right}.inv .g{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.inv .hd{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid var(--c);padding-bottom:10px}.inv .bn{font-weight:700;font-size:15px;color:var(--c)}.inv h2{margin:0;color:var(--c)}.inv .ft{display:flex;justify-content:space-between;gap:16px;margin-top:16px}`;

export function invoiceDocHtml(look: InvoiceLook, d: InvoiceData) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(d.number)}</title><style>@page{size:A4;margin:14mm}body{margin:0}${INVOICE_CSS}</style></head><body onload="window.print()">${invoiceBodyHtml(look, d)}</body></html>`;
}
