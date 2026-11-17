"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { type Footer, type Links, safeHref } from "@/lib/site-content";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/shipping-rate-calculator/", label: "Rate Calculator" },
  { href: "/customer-care/", label: "Customer Care" },
  { href: "/about-us/", label: "About Us" },
];
const isCurrent = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function SiteHeaderV2({ links }: { links: Links }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  const login = safeHref(links.customerLogin, "/login/");
  const signup = safeHref(links.signUp, "/signup/");
  return (
    <header className="w-head">
      <div className="w-wrap in">
        <Link className="w-logo" href="/" aria-label="Vishwaship home"><img src="/brand/logo-full.png" alt="Vishwaship" width={168} height={38} /></Link>
        <nav className="w-nav" aria-label="Main">
          {NAV.map((n) => <Link key={n.href} href={n.href} aria-current={isCurrent(path, n.href) ? "page" : undefined}>{n.label}</Link>)}
        </nav>
        <div className="w-acts">
          <a className="w-btn ghost sm" href={login}>Login</a>
          <a className="w-btn pri sm" href={signup}>Sign Up</a>
        </div>
        <button className="w-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="w-mnav" onClick={() => setOpen((o) => !o)}>
          {open
            ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>}
        </button>
      </div>
      <div id="w-mnav" className={open ? "w-mnav open" : "w-mnav"} aria-hidden={!open}>
        <nav aria-label="Mobile">
          {NAV.map((n) => <Link key={n.href} className="lnk" href={n.href} tabIndex={open ? 0 : -1} aria-current={isCurrent(path, n.href) ? "page" : undefined} onClick={() => setOpen(false)}>{n.label}</Link>)}
        </nav>
        <div className="w-btns">
          <a className="w-btn ghost" href={login} tabIndex={open ? 0 : -1}>Login</a>
          <a className="w-btn pri" href={signup} tabIndex={open ? 0 : -1}>Sign Up</a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooterV2({ links, footer }: { links: Links; footer: Footer }) {
  const tel = footer.phone.replace(/[^\d+]/g, "");
  return (
    <footer className="w-foot">
      <div className="w-wrap">
        <div className="cols">
          <div>
            <span className="logo"><img src="/brand/logo-full.png" alt="Vishwaship" width={132} height={30} /></span>
            <p style={{ margin: "0 0 14px", lineHeight: 1.6 }}>{footer.tagline}</p>
            {footer.phone && <a href={`tel:${tel}`}>{footer.phone}</a>}
            {footer.email && <a href={`mailto:${footer.email}`}>{footer.email}</a>}
          </div>
          <div>
            <b>Shipping</b>
            <Link href="/shipping-rate-calculator/">Rate Calculator</Link>
            <Link href="/track/">Track Shipment</Link>
            <Link href="/book/">Book a Shipment</Link>
            <Link href="/customer-care/">Customer Care</Link>
            <Link href="/about-us/">About Us</Link>
          </div>
          <div>
            <b>Your account</b>
            <a href={safeHref(links.customerLogin, "/login/")}>Customer Login</a>
            <a href={safeHref(links.signUp, "/signup/")}>Sign Up</a>
            <a href={safeHref(links.franchiseLogin, "/admin/login/")}>Franchise Login</a>
          </div>
          <div>
            <b>Policies</b>
            <Link href="/privacy/">Privacy Policy</Link>
            <Link href="/refund-policy/">Refund &amp; Cancellation</Link>
            <Link href="/terms/">Terms &amp; Conditions</Link>
          </div>
        </div>
        <div className="bottom"><span>© {new Date().getFullYear()} Vishwaship. All rights reserved.</span>{footer.hours && <span>Support: {footer.hours}</span>}</div>
      </div>
    </footer>
  );
}
