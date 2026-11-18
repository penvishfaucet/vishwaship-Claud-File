import Link from "next/link";

/**
 * THE Vishwaship logo: the owner's original file (public/brand/vishwaship-logo.png, 2169×725),
 * used everywhere, unmodified — never cropped, recoloured, redrawn or split into icon / text.
 * Only resized proportionally (height set, width auto). On navy surfaces it sits on a white plate.
 */
export const LOGO_SRC = "/brand/vishwaship-logo.png";
const W = 2169, H = 725;

export function BrandLogo({ height = 48, plate = false, className }: { height?: number; plate?: boolean; className?: string }) {
  const img = <img src={LOGO_SRC} alt="vishwaship.com" width={Math.round((height * W) / H)} height={height} className="brand-logo" style={{ height, width: "auto" }} />;
  return plate ? <span className={`logo-plate${className ? ` ${className}` : ""}`}>{img}</span> : className ? <span className={className}>{img}</span> : img;
}

/** Sidebar header for the portals: full original logo on a white plate + portal label. */
export function SidebarBrand({ href, label, onClick }: { href: string; label: string; onClick?: () => void }) {
  return (
    <div className="brand">
      <Link href={href} onClick={onClick} className="brand-logo-link" aria-label={`vishwaship.com — ${label}`}>
        <BrandLogo height={52} plate />
      </Link>
      <div className="portal">{label}</div>
    </div>
  );
}
