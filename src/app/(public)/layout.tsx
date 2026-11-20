import "@/styles/site-v2.css";
import "@/styles/site-v3.css";
import "@/styles/site-v4.css";
import "@/styles/site-v5.css";
import { SiteFooterV2, SiteHeaderV2 } from "@/components/site/SiteChromeV2";
import { MobileTabBar } from "@/components/site/MobileTabBar";
import { Reveal } from "@/components/site/Reveal";
import { DEFAULTS, accountHref } from "@/lib/site-content";
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
  const signedIn = !!(auth.customer || auth.staff);
  const acct = auth.customer ? "/portal/" : auth.staff ? "/admin/" : accountHref(links.customerLogin, "/login/");
  return (
    <div className="vs wv v4 v5">
      <a className="sr-only" href="#main">Skip to content</a>
      <div className="v4-top">
        <div className="w-wrap in">
          <a className="v5-news" href="/shipping-rate-calculator/"><b>NEW</b><span>Compare B2C parcel and B2B cargo rates together — <u>Check your rates</u></span></a>
          <a className="v5-fr" href={accountHref(links.franchiseLogin, "/admin/login/")}>Franchise Login <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <SiteHeaderV2 links={links} auth={auth} logoutCustomer={customerLogout} logoutStaff={staffLogout} />
      <main id="main">{children}</main>
      <SiteFooterV2 links={links} footer={footer} />
      <MobileTabBar accountHref={acct} signedIn={signedIn} />
      <Reveal />
    </div>
  );
}
