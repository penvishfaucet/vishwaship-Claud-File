"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronDown, ChevronsLeft, ChevronsRight, Clock, CornerUpLeft, Home, LayoutGrid, Lock, Menu, Package, Phone, Search, ShieldCheck, Ticket, Wallet, X } from "lucide-react";
import { formatINR } from "@/lib/money";
import { type ModuleState, flatNav, isNavGroup, visibleNav } from "./nav";
import { QuickSearch } from "./QuickSearch";
import { SidebarBrand } from "@/components/BrandLogo";

interface Props {
  user: { name: string; orgName: string; kycStatus: string };
  walletPaise: number;
  unreadAlerts: Array<{ id: string; title: string; href: string | null; createdAt: string }>;
  logout: () => Promise<void>;
  /** Feature access for this account (Admin: global / plan / customer). */
  modules: ModuleState;
  /** CMS labels for sidebar entries (nav.<id>). */
  labels: Record<string, string>;
  support: { label: string; phone: string; hours: string };
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

type Locked = { locked?: boolean };

export function PortalShell({ user, walletPaise, unreadAlerts, logout, modules, labels, support, children }: Props) {
  const path = usePathname();
  const nav = useMemo(() => visibleNav(modules, labels), [modules, labels]);
  const links = useMemo(() => flatNav(nav), [nav]);
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [qs, setQs] = useState(false);
  const [menu, setMenu] = useState<null | "tickets" | "alerts" | "profile">(null);
  const close = () => setMenu(null);
  const ref = useClickAway(menu !== null, close);
  const matches = (href: string) => (href === "/portal/" ? path === "/portal" || path === "/portal/" : path.startsWith(href.replace(/\/$/, "")));
  // only the most specific link is active (e.g. Report Download, not also Reports)
  const best = links.map((n) => n.href).filter(matches).sort((a, b) => b.length - a.length)[0];
  const active = (href: string) => href === best || (!links.some((n) => n.href === href) && matches(href));
  const activeGroup = nav.find((e) => isNavGroup(e) && e.items.some((n) => n.href === best))?.id;
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  // keep the parent of the current page expanded on navigation, refresh and direct visits
  useEffect(() => { if (activeGroup) setOpenGroups((s) => (s.has(activeGroup) ? s : new Set([...s, activeGroup]))); }, [activeGroup]);
  useEffect(() => { setDrawer(false); }, [path]);
  useEffect(() => {
    try {
      const m = localStorage.getItem("vs-theme");
      const dark = m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      setCollapsed(localStorage.getItem("vs-side") === "collapsed");
    } catch { /* storage blocked: defaults */ }
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); setQs(true); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);
  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem("vs-side", c ? "open" : "collapsed"); } catch { /* ignore */ } return !c; });
  const toggleGroup = (id: string) => {
    if (collapsed) { toggleCollapsed(); setOpenGroups((s) => new Set([...s, id])); return; }
    setOpenGroups((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const searchMenu = useMemo(() => nav.flatMap((e) => (isNavGroup(e)
    ? e.items.map((i) => ({ href: i.href, label: i.label, parent: e.group, locked: (i as Locked).locked }))
    : [{ href: e.href, label: e.label, locked: (e as Locked).locked }])), [nav]);
  const initials = user.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const cls = (href: string, locked?: boolean) => `${active(href) ? "item on" : "item"}${locked ? " locked" : ""}`;

  return (
    <div className={collapsed ? "shell side-collapsed" : "shell"}>
      <aside className={drawer ? "side open" : "side"} aria-label="Portal navigation">
        <SidebarBrand href="/portal/" label="CUSTOMER PORTAL" onClick={() => setDrawer(false)} />
        <nav>
          {nav.map((e) => isNavGroup(e) ? (
            <div key={e.id} className={`grp${e.items.some((n) => active(n.href)) ? " has-on" : ""}`}>
              <button type="button" className="item grp-h" aria-expanded={openGroups.has(e.id)} aria-controls={`grp-${e.id}`} title={collapsed ? e.group : undefined} onClick={() => toggleGroup(e.id)}>
                <e.icon aria-hidden /><span className="lbl">{e.group}</span><ChevronDown className="chev" aria-hidden />
              </button>
              <div id={`grp-${e.id}`} className="sub" hidden={!openGroups.has(e.id) || collapsed}>
                {e.items.map((n) => (
                  <Link key={n.id} href={n.href} className={cls(n.href, (n as Locked).locked)} aria-current={active(n.href) ? "page" : undefined}>
                    <n.icon aria-hidden /><span className="lbl">{n.label}</span>{(n as Locked).locked && <Lock className="lock" aria-label="Locked, upgrade to use" />}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <Link key={e.id} href={e.href} className={cls(e.href, (e as Locked).locked)} aria-current={active(e.href) ? "page" : undefined} title={collapsed ? e.label : undefined}>
              <e.icon aria-hidden /><span className="lbl">{e.label}</span>{(e as Locked).locked && <Lock className="lock" aria-label="Locked, upgrade to use" />}
            </Link>
          ))}
          <button type="button" className="item qs-btn" onClick={() => setQs(true)} title={collapsed ? "Quick Search (Ctrl+B)" : undefined} aria-keyshortcuts="Control+B">
            <Search aria-hidden /><span className="lbl">Quick Search</span><kbd className="lbl">Ctrl+B</kbd>
          </button>
        </nav>
        <a className="side-support" href={`tel:${support.phone.replace(/[^\d+]/g, "")}`} title={collapsed ? `${support.label}: ${support.phone}` : undefined}>
          <Phone aria-hidden size={16} />
          <span className="lbl"><small>{support.label}</small><b>{support.phone}</b><small><Clock size={11} aria-hidden style={{ verticalAlign: -1 }} /> {support.hours}</small></span>
        </a>
        <button type="button" className="side-collapse hide-sm" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed}>
          {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /><span className="lbl">Collapse</span></>}
        </button>
      </aside>
      <QuickSearch open={qs} onClose={() => setQs(false)} menu={searchMenu} />
      {drawer && <div className="backdrop on" onClick={() => setDrawer(false)} aria-hidden />}
      <div className="main">
        <header className="top" ref={ref}>
          <button className="icon-btn show-sm-flex" aria-label={drawer ? "Close menu" : "Open menu"} onClick={() => setDrawer((d) => !d)}>{drawer ? <X size={20} /> : <Menu size={20} />}</button>
          <Link href="/portal/" className="show-sm" aria-label="Dashboard"><img src="/brand/logo-full.png" alt="vishwaship.com" style={{ height: 24 }} /></Link>
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); if (q) router.push(`/portal/orders/?q=${encodeURIComponent(String(q))}`); }}>
            <Search size={16} aria-hidden /><label htmlFor="gq" className="sr-only">Search orders</label>
            <input id="gq" name="q" placeholder="Order ID, AWB / LR or phone" />
          </form>
          <div className="grow" />
          <Link href="/portal/billing/passbook/?recharge=1" className="walletbtn" aria-label={`Wallet balance ${formatINR(walletPaise)}. Recharge`}>
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
