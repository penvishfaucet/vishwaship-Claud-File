import Link from "next/link";

/**
 * Order ID / AWB shown as blue, underlined links (#0057B8) that open the right record.
 * Missing value → "—". A value without a destination (no record / no access) → plain text.
 * The AWB copy button stays a separate control next to the link (render CopyBtn beside it).
 */
export function OrderIdLink({ value, href, className }: { value?: string | null; href?: string | null; className?: string }) {
  if (!value) return <span className="muted">—</span>;
  if (!href) return <span className={className}>{value}</span>;
  return <Link href={href} className={`id-link${className ? ` ${className}` : ""}`} aria-label={`Open order ${value}`}>{value}</Link>;
}

export function AwbLink({ value, href, className }: { value?: string | null; href?: string | null; className?: string }) {
  if (!value) return <span className="muted">—</span>;
  if (!href) return <span className={`mono${className ? ` ${className}` : ""}`}>{value}</span>;
  return <Link href={href} className={`id-link mono${className ? ` ${className}` : ""}`} aria-label={`Track AWB ${value}`}>{value}</Link>;
}

/** Customer portal destinations. */
export const portalOrderHref = (orderId?: string | null) => (orderId ? `/portal/orders/${orderId}/` : null);
export const portalTrackHref = (awb?: string | null) => (awb ? `/portal/track/?q=${encodeURIComponent(awb)}` : null);
