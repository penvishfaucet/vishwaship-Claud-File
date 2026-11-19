import Link from "next/link";

/**
 * Vishwaship logo — transparent PNGs only, never on a background plate.
 * - Light surfaces: the original artwork with its background removed (navy + orange wordmark).
 * - Dark / navy surfaces (`onDark`): the same artwork with only the navy letters ("vishwa", ".com") in white,
 *   so the full logo stays readable without a white box behind it. The orange box and "ship" are unchanged.
 * The untouched source file stays at /brand/vishwaship-logo.png. Resized proportionally only (height set, width auto).
 */
export const LOGO_SRC = "/brand/vishwaship-logo-transparent.png";
export const LOGO_ON_DARK_SRC = "/brand/vishwaship-logo-on-dark.png";
const W = 2169, H = 725;

export function BrandLogo({ height = 48, onDark = false, className }: { height?: number; onDark?: boolean; className?: string }) {
  const img = <img src={onDark ? LOGO_ON_DARK_SRC : LOGO_SRC} alt="vishwaship.com" width={Math.round((height * W) / H)} height={height} className="brand-logo" style={{ height, width: "auto" }} />;
  return className ? <span className={className}>{img}</span> : img;
}

/** Sidebar header for the portals (navy sidebar): transparent on-dark logo + portal label. */
export function SidebarBrand({ href, label, onClick }: { href: string; label: string; onClick?: () => void }) {
  return (
    <div className="brand">
      <Link href={href} onClick={onClick} className="brand-logo-link" aria-label={`vishwaship.com — ${label}`}>
        <BrandLogo height={56} onDark />
      </Link>
      <div className="portal">{label}</div>
    </div>
  );
}
