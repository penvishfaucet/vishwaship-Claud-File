"use client";
import { BrandLogo } from "@/components/BrandLogo";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "@/components/icons";
import { SITE } from "@/lib/site";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/#services", label: "Our Services" },
  { href: "/book/", label: "Book a Shipment" },
  { href: "/shipping-rate-calculator/", label: "Rate Calculator" },
  { href: "/track/", label: "Track Shipment" },
  { href: "/customer-care/", label: "Customer Care" },
  { href: "/login/", label: "Account" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="vs-top">
        <div className="in">
          <span>From your doorstep. To anywhere in India.</span>
          <a href="/admin/login/">Franchise Login <ArrowUpRight size={13} /></a>
        </div>
      </div>
      <header className="vs-head">
        <div className="in" style={{ position: "relative" }}>
          <Link className="logo" href="/"><BrandLogo height={56} /></Link>
          <nav className="vs-nav" aria-label="Main">
            {NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
          </nav>
          <div className="grow" />
          <Link className="vs-btn sm" href="/login/">Login</Link>
          <button className="vs-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <div className={open ? "vs-mnav open" : "vs-mnav"} onClick={() => setOpen(false)}>
            {NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
            <Link style={{ color: "var(--orange)" }} href="/signup/">Create an account</Link>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="vs-foot">
      <div className="vs-wrap">
        <div className="cols">
          <div>
            <BrandLogo height={56} onDark />
            <p style={{ margin: "18px 0 6px" }}>Your parcels. Our promise.<br />Doorstep shipping, across India.</p>
            <p style={{ margin: "14px 0 4px" }}>{SITE.phone}</p>
            <a href={`mailto:${SITE.email}`} style={{ color: "var(--navy)", fontWeight: 600 }}>{SITE.email} ↗</a>
          </div>
          <div>
            <b>Ship with us</b>
            <Link href="/book/">Book a shipment</Link>
            <Link href="/shipping-rate-calculator/">Rate calculator</Link>
            <Link href="/track/">Track your shipment</Link>
            <Link href="/#services">Courier &amp; cargo services</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/customer-care/">Customer Care &amp; Complaints</Link>
          </div>
          <div>
            <b>Your account</b>
            <Link href="/login/">Customer Login</Link>
            <Link href="/signup/">Create an account</Link>
            <a href="/admin/login/">Franchise Login</a>
          </div>
          <div>
            <b>Policies</b>
            <Link href="/privacy/">Privacy Policy</Link>
            <Link href="/refund-policy/">Refund &amp; Cancellation</Link>
            <Link href="/terms/">Terms &amp; Conditions</Link>
          </div>
        </div>
        <div className="bottom"><span>© {new Date().getFullYear()} Vishwaship. All rights reserved.</span><span>{SITE.hours}</span></div>
      </div>
    </footer>
  );
}
