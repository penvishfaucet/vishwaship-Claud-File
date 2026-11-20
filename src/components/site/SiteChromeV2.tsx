"use client";
import { BrandLogo } from "@/components/BrandLogo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2, Calculator, ChevronDown, Headset, Home, Info, LayoutDashboard, LogIn, LogOut, Menu, PackageSearch, Shield, Truck, UserCircle2, UserPlus, X,
} from "lucide-react";
import { type Footer, type Links, accountHref } from "@/lib/site-content";
import type { SiteAuth } from "@/server/site/auth";
import { ADMIN_DASHBOARD, CUSTOMER_DASHBOARD, SITE_NAV, isCurrent, isKnownBrowser } from "./nav";

const ICON = { home: Home, calc: Calculator, track: PackageSearch, care: Headset, about: Info } as const;
type Action = () => Promise<void>;

/** Account-derived destinations shared by header, drawer and hero. */
export function accountLinks(links: Links, auth: SiteAuth) {
  const login = accountHref(links.customerLogin, "/login/");
  const signup = accountHref(links.signUp, "/signup/");
  const admin = accountHref(links.franchiseLogin, "/admin/login/");
  const dashboard = auth.customer ? CUSTOMER_DASHBOARD : auth.staff ? ADMIN_DASHBOARD : accountHref(links.customerLogin, "/login/", CUSTOMER_DASHBOARD);
  return { login, signup, admin, dashboard };
}

/** Returning-visitor hint from this browser only (read after mount; unknown until then). */
export function useKnownBrowser() {
  const [known, setKnown] = useState(false);
  useEffect(() => setKnown(isKnownBrowser()), []);
  return known;
}

function AccountMenu({ auth, logoutCustomer, logoutStaff, onNavigate }: { auth: SiteAuth; logoutCustomer: Action; logoutStaff: Action; onNavigate?: () => void }) {
  return (
    <>
      {auth.customer && (
        <>
          <div className="hd">Signed in as {auth.customer.name}</div>
          <Link href={CUSTOMER_DASHBOARD} onClick={onNavigate}><LayoutDashboard size={17} aria-hidden="true" />Dashboard</Link>
          <Link href="/portal/orders/new/" onClick={onNavigate}><Truck size={17} aria-hidden="true" />Create Shipment</Link>
          <Link href="/portal/profile/" onClick={onNavigate}><UserCircle2 size={17} aria-hidden="true" />Profile</Link>
          <form action={logoutCustomer}><button type="submit"><LogOut size={17} aria-hidden="true" />Logout</button></form>
        </>
      )}
      {auth.staff && (
        <>
          {auth.customer && <div className="sep" />}
          <div className="hd">Staff: {auth.staff.name}</div>
          <Link href={ADMIN_DASHBOARD} onClick={onNavigate}><Shield size={17} aria-hidden="true" />Admin Dashboard</Link>
          <form action={logoutStaff}><button type="submit"><LogOut size={17} aria-hidden="true" />Logout (staff)</button></form>
        </>
      )}
    </>
  );
}

export function SiteHeaderV2({ links, auth, logoutCustomer, logoutStaff }: { links: Links; auth: SiteAuth; logoutCustomer: Action; logoutStaff: Action }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [acct, setAcct] = useState(false);
  const known = useKnownBrowser();
  const L = accountLinks(links, auth);
  const signedIn = !!(auth.customer || auth.staff);
  const burger = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const acctRef = useRef<HTMLDivElement>(null);
  const acctRef2 = useRef<HTMLDivElement>(null);

  const close = useCallback(() => { setOpen(false); burger.current?.focus(); }, []);
  useEffect(() => { setOpen(false); setAcct(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    // the drawer becomes focusable once its visibility transition starts
    const t = window.setTimeout(() => closeBtn.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const f = panel.current.querySelectorAll<HTMLElement>("a,button");
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.clearTimeout(t); document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, close]);
  useEffect(() => {
    if (!acct) return;
    const h = (e: MouseEvent | TouchEvent) => { const t = e.target as Node; if (!acctRef.current?.contains(t) && !acctRef2.current?.contains(t)) setAcct(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setAcct(false); };
    document.addEventListener("mousedown", h); document.addEventListener("touchstart", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); document.removeEventListener("keydown", k); };
  }, [acct]);

  const name = auth.customer?.name ?? auth.staff?.name ?? "";
  const first = name.split(" ")[0];

  return (
    <header className="w-head">
      <div className="w-wrap in">
        <Link className="w-logo" href="/" aria-label="Vishwaship home"><BrandLogo height={60} /></Link>
        <nav className="w-nav" aria-label="Main">
          {SITE_NAV.map((n) => <Link key={n.href} href={n.href} aria-current={isCurrent(path, n.href) ? "page" : undefined}>{n.label}</Link>)}
        </nav>
        <div className="w-acts">
          {!signedIn && <a className="w-hlink" href={L.login}><LogIn size={17} aria-hidden="true" />Login</a>}
          {signedIn ? (
            <div className="w-acct" ref={acctRef}>
              <button type="button" className="w-acct-btn" aria-haspopup="menu" aria-expanded={acct} onClick={() => setAcct((a) => !a)}>
                <span className="av" aria-hidden="true">{first.slice(0, 1).toUpperCase()}</span><span className="nm">{first}</span><ChevronDown size={16} aria-hidden="true" />
              </button>
              {acct && <div className="w-pop" role="menu"><AccountMenu auth={auth} logoutCustomer={logoutCustomer} logoutStaff={logoutStaff} onNavigate={() => setAcct(false)} /></div>}
            </div>
          ) : <a className="w-btn pri sm" href={L.signup}>Sign Up</a>}
        </div>
        <div className="w-micons">
          {/* profile icon: signed in → dashboard; signed out → the Login / Sign up page */}
          <a className={`w-prof${signedIn ? " on" : ""}`} href={L.dashboard} aria-label={signedIn ? `My account (${name})` : "Login or sign up"} title={signedIn ? name : "Login / Sign up"}>
            <UserCircle2 size={26} aria-hidden="true" />
          </a>
          <button ref={burger} type="button" className="w-burger" aria-label="Open menu" aria-expanded={open} aria-controls="w-drawer" onClick={() => setOpen(true)}><Menu size={24} aria-hidden="true" /></button>
        </div>
      </div>

      <div className={open ? "w-drawer-wrap open" : "w-drawer-wrap"} aria-hidden={!open} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div id="w-drawer" ref={panel} className="w-drawer" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="top">
            <Link href="/" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1} aria-label="Vishwaship home"><BrandLogo height={52} /></Link>
            <button ref={closeBtn} type="button" className="w-ic" aria-label="Close menu" onClick={close} tabIndex={open ? 0 : -1}><X size={24} aria-hidden="true" /></button>
          </div>
          {signedIn && <p className="who">Signed in as <b>{name}</b></p>}
          <nav aria-label="Mobile">
            {SITE_NAV.map((n) => { const I = ICON[n.icon]; return (
              <Link key={n.href} className="lnk" href={n.href} tabIndex={open ? 0 : -1} aria-current={isCurrent(path, n.href) ? "page" : undefined} onClick={() => setOpen(false)}><I size={20} aria-hidden="true" />{n.label}</Link>
            ); })}
            <Link className="lnk" href={L.dashboard} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}><LayoutDashboard size={20} aria-hidden="true" />Dashboard</Link>
            {auth.customer && <Link className="lnk" href="/portal/profile/" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}><UserCircle2 size={20} aria-hidden="true" />Account</Link>}
            {auth.staff && <Link className="lnk" href={ADMIN_DASHBOARD} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}><Shield size={20} aria-hidden="true" />Admin Dashboard</Link>}
            {!auth.customer && <a className="lnk" href={L.login} tabIndex={open ? 0 : -1}><LogIn size={20} aria-hidden="true" />Login</a>}
            {!auth.customer && <a className="lnk" href={L.signup} tabIndex={open ? 0 : -1}><UserPlus size={20} aria-hidden="true" />Sign Up</a>}
            <a className="lnk" href={L.admin} tabIndex={open ? 0 : -1}><Building2 size={20} aria-hidden="true" />Franchise / Admin Login</a>
          </nav>
          {auth.customer && <form action={logoutCustomer}><button className="w-btn ghost" style={{ width: "100%", marginTop: 16 }} tabIndex={open ? 0 : -1}><LogOut size={18} aria-hidden="true" />Logout</button></form>}
          {!signedIn && (
            <div className="w-btns">
              {known
                ? <><a className="w-btn pri" href={L.login} tabIndex={open ? 0 : -1}>Login</a><a className="w-btn out" href={L.signup} tabIndex={open ? 0 : -1}>Sign Up</a></>
                : <><a className="w-btn pri" href={L.signup} tabIndex={open ? 0 : -1}>Sign Up</a><a className="w-btn out" href={L.login} tabIndex={open ? 0 : -1}>Login</a></>}
            </div>
          )}
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
            <span className="logo"><BrandLogo height={44} /></span>
            <p style={{ margin: "0 0 14px", lineHeight: 1.6 }}>{footer.tagline}</p>
            {footer.phone && <a href={`tel:${tel}`}>{footer.phone}</a>}
            {footer.email && <a href={`mailto:${footer.email}`}>{footer.email}</a>}
          </div>
          <div>
            <b>Shipping</b>
            {SITE_NAV.filter((n) => n.href !== "/").map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
            <Link href="/book/">Book a Shipment</Link>
          </div>
          <div>
            <b>Your account</b>
            <a href={accountHref(links.customerLogin, "/login/")}>Customer Login</a>
            <a href={accountHref(links.signUp, "/signup/")}>Sign Up</a>
            <a href={accountHref(links.franchiseLogin, "/admin/login/")}>Franchise / Admin Login</a>
            <a href={accountHref(links.customerLogin, "/login/", CUSTOMER_DASHBOARD)}>Dashboard</a>
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
