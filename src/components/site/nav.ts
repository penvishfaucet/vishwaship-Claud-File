/**
 * Shared public-site navigation: desktop header, mobile drawer, hero and footer all read from here, so
 * destinations stay identical. Account links come from Admin → Website Content (links section).
 */
export const SITE_NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/shipping-rate-calculator/", label: "Rate Calculator", icon: "calc" },
  { href: "/track/", label: "Track Shipment", icon: "track" },
  { href: "/customer-care/", label: "Customer Care", icon: "care" },
  { href: "/about-us/", label: "About Us", icon: "about" },
] as const;

export const CUSTOMER_DASHBOARD = "/portal/";
export const ADMIN_DASHBOARD = "/admin/";
export const KNOWN_KEY = "vs-known";

export const isCurrent = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** "Returning visitor" = this browser completed a login/sign-up before (set by the Customer Portal). No cross-device tracking. */
export function isKnownBrowser(): boolean {
  try { return localStorage.getItem(KNOWN_KEY) === "1"; } catch { return false; }
}
export function rememberBrowser() {
  try { localStorage.setItem(KNOWN_KEY, "1"); } catch { /* storage blocked */ }
}
