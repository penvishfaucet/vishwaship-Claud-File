"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bell, CornerUpLeft, Home, LayoutGrid, Menu, Package, Search, ShieldCheck, Ticket, Wallet, X } from "lucide-react";
import { formatINR } from "@/lib/money";
import { CUSTOMER_NAV } from "./nav";
import { SidebarBrand, TopbarBrand } from "@/components/BrandLogo";

interface Props {
  user: { name: string; orgName: string; kycStatus: string };
  walletPaise: number;
  unreadAlerts: Array<{ id: string; title: string; href: string | null; createdAt: string }>;
  logout: () => Promise<void>;
  children: React.ReactNode;
}

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open, close]);
  return ref;
}

export function PortalShell({ user, walletPaise, unreadAlerts, logout, children }: Props) {
  const path = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState<null | "tickets" | "alerts" | "profile">(null);
  const close = () => setMenu(null);
  const ref = useClickAway(menu !== null, close);
  const active = (href: string) => (href === "/portal/" ? path === "/portal" || path === "/portal/" : path.startsWith(href.replace(/\/$/, "")));
  useEffect(() => {
    try {
      const m = localStorage.getItem("vs-theme");
      const dark = m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    } catch { /* storage blocked: stay light */ }
  }, []);
  const initials = user.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="shell">
      <aside className={drawer ? "side open" : "side"} aria-label="Portal navigation">
        <SidebarBrand href="/portal/" label="CUSTOMER PORTAL" onClick={() => setDrawer(false)} />
        <nav>
          {CUSTOMER_NAV.map((n) => (
            <Link key={n.href} href={n.href} className={active(n.href) ? "item on" : "item"} aria-current={active(n.href) ? "page" : undefined} onClick={() => setDrawer(false)}>
              <n.icon aria-hidden />{n.label}
            </Link>
          ))}
        </nav>
      </aside>
      {drawer && <div className="backdrop on" onClick={() => setDrawer(false)} aria-hidden />}
      <div className="main">
        <header className="top" ref={ref}>
          <button className="icon-btn show-sm-flex" aria-label={drawer ? "Close menu" : "Open menu"} onClick={() => setDrawer((d) => !d)}>{drawer ? <X size={20} /> : <Menu size={20} />}</button>
          <TopbarBrand href="/portal/" label="Dashboard" />
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); if (q) router.push(`/portal/orders/?q=${encodeURIComponent(String(q))}`); }}>
            <Search size={16} aria-hidden /><label htmlFor="gq" className="sr-only">Search orders</label>
            <input id="gq" name="q" placeholder="Order ID, AWB / LR or phone" />
          </form>
          <div className="grow" />
          <Link href="/portal/billing/?recharge=1" className="walletbtn" aria-label={`Wallet balance ${formatINR(walletPaise)}. Recharge`}>
            <Wallet size={15} aria-hidden /><span>{formatINR(walletPaise)}</span><span className="r hide-xs">+ Recharge</span>
          </Link>
          <div style={{ position: "relative" }}>
            <button className="hdr-ico" aria-label="Support tickets" aria-haspopup="menu" aria-expanded={menu === "tickets"} onClick={() => setMenu(menu === "tickets" ? null : "tickets")}><Ticket size={19} /></button>
            {menu === "tickets" && (
              <div className="dropdown" role="menu">
                <Link role="menuitem" href="/portal/support/" onClick={close}>My Tickets</Link>
                <Link role="menuitem" href="/portal/support/new/" onClick={close}>Raise Ticket</Link>
              </div>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button className="hdr-ico" aria-label={`Notifications${unreadAlerts.length ? `, ${unreadAlerts.length} unread` : ""}`} aria-haspopup="menu" aria-expanded={menu === "alerts"} onClick={() => setMenu(menu === "alerts" ? null : "alerts")}>
              <Bell size={19} />{unreadAlerts.length > 0 && <i>{unreadAlerts.length > 9 ? "9+" : unreadAlerts.length}</i>}
            </button>
            {menu === "alerts" && (
              <div className="dropdown" role="menu">
                {unreadAlerts.length === 0 && <p className="small muted" style={{ padding: 10 }}>You’re all caught up.</p>}
                {unreadAlerts.slice(0, 5).map((a) => <Link key={a.id} role="menuitem" href={a.href ?? "/portal/alerts/"} onClick={close}>{a.title}</Link>)}
                <Link role="menuitem" href="/portal/alerts/" className="b" onClick={close}>View all</Link>
              </div>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button className="avatar" aria-label="Account menu" aria-haspopup="menu" aria-expanded={menu === "profile"} onClick={() => setMenu(menu === "profile" ? null : "profile")}>{initials}</button>
            {menu === "profile" && (
              <div className="dropdown" role="menu">
                <div style={{ padding: "8px 12px" }}><div className="b small">{user.name}</div><div className="tiny muted">{user.orgName}</div></div>
                <Link role="menuitem" href="/portal/profile/" onClick={close}>Profile &amp; business</Link>
                <Link role="menuitem" href="/portal/kyc/" onClick={close}><ShieldCheck size={14} style={{ verticalAlign: -2 }} /> KYC {user.kycStatus !== "approved" && <span className="chip c-pending" style={{ marginLeft: 6 }}>{user.kycStatus.replace("_", " ")}</span>}</Link>
                <Link role="menuitem" href="/portal/settings/" onClick={close}>Settings &amp; appearance</Link>
                <form action={logout}><button className="dd" role="menuitem">Log out</button></form>
              </div>
            )}
          </div>
        </header>
        <div className="content has-bnav" id="main">{children}</div>
        <nav className="bnav" aria-label="Quick navigation">
          {[
            { href: "/portal/", label: "Home", icon: Home },
            { href: "/portal/orders/", label: "Orders", icon: Package },
            { href: "/portal/ndr/", label: "NDR", icon: CornerUpLeft },
            { href: "/portal/more/", label: "More", icon: LayoutGrid },
          ].map((n) => (
            <Link key={n.href} href={n.href} className={active(n.href) ? "on" : ""} aria-current={active(n.href) ? "page" : undefined}><span className="bi"><n.icon size={20} /></span>{n.label}</Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
