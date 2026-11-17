import Link from "next/link";

/**
 * Original Vishwaship logo (public/brand/logo-full.png, 640×124, orange box + navy/orange wordmark)
 * used unmodified — no colour filters. On the navy sidebar it sits on a white card so the navy
 * "vishwa" and ".com" stay readable. Icon-only asset: public/brand/logo-icon.png.
 */
/**
 * Light-on-dark variant for the navy sidebar (owner-approved): original orange box icon
 * (logo-icon.png) + wordmark with white "vishwa", orange "ship", white ".com".
 */
export function SidebarBrand({ href, label, onClick }: { href: string; label: string; onClick?: () => void }) {
  return (
    <div className="brand">
      <Link href={href} onClick={onClick} className="brand-dark" aria-label={`vishwaship.com — ${label}`}>
        <img src="/brand/logo-icon.png" alt="" width={157} height={160} />
        <span className="wm" aria-hidden="true">vishwa<span className="o">ship</span><small>.com</small></span>
      </Link>
      <div className="portal">{label}</div>
    </div>
  );
}

/** Compact logo for the mobile top bar: full logo, icon-only below 380 px. */
export function TopbarBrand({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="show-sm topbar-brand" aria-label={label}>
      <img className="tb-full" src="/brand/logo-full.png" alt="vishwaship.com" width={640} height={124} />
      <img className="tb-icon" src="/brand/logo-icon.png" alt="vishwaship.com" width={157} height={160} />
    </Link>
  );
}
