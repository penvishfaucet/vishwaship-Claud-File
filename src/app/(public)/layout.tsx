import "@/styles/site-v2.css";
import "@/styles/site-v3.css";
import { SiteFooterV2, SiteHeaderV2 } from "@/components/site/SiteChromeV2";
import { DEFAULTS } from "@/lib/site-content";
import { customerLogout, staffLogout } from "@/server/auth/actions";
import { type SiteAuth, siteAuth } from "@/server/site/auth";
import { getSiteContent } from "@/server/site/content";

// Header/footer links come from Admin → Website Content and the account menu from the session, so public pages render per request.
export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  let links = DEFAULTS.links, footer = DEFAULTS.footer;
  let auth: SiteAuth = { customer: null, staff: null };
  try {
    const [c, a] = await Promise.all([getSiteContent(), siteAuth()]);
    links = c.links; footer = c.footer; auth = a;
  } catch (e) {
    console.error("[site] content unavailable, using defaults:", (e as Error).message);
  }
  return (
    <div className="vs wv">
      <a className="sr-only" href="#main">Skip to content</a>
      <SiteHeaderV2 links={links} auth={auth} logoutCustomer={customerLogout} logoutStaff={staffLogout} />
      <main id="main">{children}</main>
      <SiteFooterV2 links={links} footer={footer} />
    </div>
  );
}
