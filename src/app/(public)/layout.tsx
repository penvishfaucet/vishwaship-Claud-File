import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="vs">
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
