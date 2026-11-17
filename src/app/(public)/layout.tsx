import "@/styles/site-v2.css";
import { SiteFooterV2, SiteHeaderV2 } from "@/components/site/SiteChromeV2";
import { DEFAULTS } from "@/lib/site-content";
import { getSiteContent } from "@/server/site/content";

// Header/footer links come from Admin → Website Content, so public pages render per request (not at build time).
export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  let links = DEFAULTS.links, footer = DEFAULTS.footer;
  try {
    const c = await getSiteContent();
    links = c.links; footer = c.footer;
  } catch (e) {
    console.error("[site] content unavailable, using defaults:", (e as Error).message);
  }
  return (
    <div className="vs wv">
      <a className="sr-only" href="#main">Skip to content</a>
      <SiteHeaderV2 links={links} />
      <main id="main">{children}</main>
      <SiteFooterV2 links={links} footer={footer} />
    </div>
  );
}
