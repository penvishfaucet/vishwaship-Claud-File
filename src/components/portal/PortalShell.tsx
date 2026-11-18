"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  MessageCircleMore, Bell, ChevronDown, Clock, CornerUpLeft, Home, LayoutGrid, Lock, Menu, Package, Phone, Pin, PinOff, Plus, RefreshCw, Search, ShieldCheck, Ticket, Wallet, X, Zap, Calculator, Truck, MapPin, LifeBuoy,
} from "lucide-react";
import { formatINR } from "@/lib/money";
import { type ModuleState, flatNav, isNavGroup, visibleNav } from "./nav";
import { QuickSearch } from "./QuickSearch";
import { type QuickAction, quickActions } from "./quick-actions";
import { BrandLogo, SidebarBrand } from "@/components/BrandLogo";
import { rememberBrowser } from "@/components/site/nav";

interface Props {
  user: { name: string; orgName: string; kycStatus: string; email?: string | null };
  walletPaise: number;
  credits: number;
  unreadAlerts: Array<{ id: string; title: string; href: string | null; createdAt: string }>;
  tickets: { open: number; recent: Array<{ id: string; number: string; subject: string; status: string; updatedAt: string }> };
  logout: () => Promise<void>;
  /** Feature access for this account (Admin: global / plan / customer). */
  modules: ModuleState;
  /** CMS labels for sidebar entries (nav.<id>). */
  labels: Record<string, string>;
  support: { label: string; phone: string; hours: string };
  children: React.ReactNode;
}

type Menu = null | "quick" | "tickets" | "alerts" | "profile" | "search";
type Locked = { locked?: boolean };

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

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

export function PortalShell({ user, walletPaise, credits, unreadAlerts, tickets, logout, modules, labels, support, children }: Props) {
  const path = usePathname();
  const nav = useMemo(() => visibleNav(modules, labels), [modules, labels]);
  const links = useMemo(() => flatNav(nav), [nav]);
  const qa = useMemo(() => quickActions(modules), [modules]);
  const [sheet, setSheet] = useState(false);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [drawer, setDrawer] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [qs, setQs] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const close = () => setMenu(null);
  const ref = useClickAway(menu !== null, close);
  const matches = (href: string) => (href === "/portal/" ? path === "/portal" || path === "/portal/" : path.startsWith(href.replace(/\/$/, "")));
  const best = links.map((n) => n.href).filter(matches).sort((a, b) => b.length - a.length)[0];
  const active = (href: string) => href === best || (!links.some((n) => n.href === href) && matches(href));
  const activeGroup = nav.find((e) => isNavGroup(e) && e.items.some((n) => n.href === best))?.id;
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  useEffect(() => { if (activeGroup) setOpenGroups((s) => (s.has(activeGroup) ? s : new Set([...s, activeGroup]))); }, [activeGroup]);
  useEffect(() => { setDrawer(false); setMenu(null); }, [path]);
  useEffect(() => {
    try {
      const m = localStorage.getItem("vs-theme");
      const dark = m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      setPinned(localStorage.getItem("vs-side-pinned") === "1");
      rememberBrowser(); // signed-in on this browser → public site shows Login first next time
    } catch { /* storage blocked: defaults */ }
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); setQs(true); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);
  const togglePinned = () => setPinned((p) => { try { localStorage.setItem("vs-side-pinned", p ? "0" : "1"); } catch { /* ignore */ } return !p; });
  /** Hamburger: drawer on touch / narrow screens, pin the expanded sidebar on desktop. */
  const onHamburger = () => (window.matchMedia("(max-width: 900px)").matches ? setDrawer((d) => !d) : togglePinned());
  const toggleGroup = (id: string) => setOpenGroups((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const searchMenu = useMemo(() => nav.flatMap((e) => (isNavGroup(e)
    ? e.items.map((i) => ({ href: i.href, label: i.label, parent: e.group, locked: (i as Locked).locked }))
    : [{ href: e.href, label: e.label, locked: (e as Locked).locked }])), [nav]);
  const initials = user.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const cls = (href: string, locked?: boolean) => `${active(href) ? "item on" : "item"}${locked ? " locked" : ""}`;

  // header search (AWB default, Order ID, LR)
  const [sType, setSType] = useState<"awb" | "order" | "lr">("awb");
  const [sq, setSq] = useState("");
  const [sRes, setSRes] = useState<Array<{ href: string; title: string; sub: string }> | null>(null);
  const [sState, setSState] = useState<"idle" | "loading" | "error">("idle");
  useEffect(() => {
    const t = sq.trim();
    if (t.length < 3) { setSRes(null); return; }
    setSState("loading");
    const ctl = new AbortController();
    const h = setTimeout(() => {
      fetch(`/api/portal/search?type=${sType}&q=${encodeURIComponent(t)}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j) => { setSRes(j.results); setSState("idle"); setMenu("search"); }).catch((e) => { if ((e as Error).name !== "AbortError") setSState("error"); });
    }, 250);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [sq, sType]);

  return (
    <div className={`shell rail${pinned ? " pinned" : ""}`}>
      <aside className={drawer ? "side open" : "side"} aria-label="Portal navigation">
        <div className="side-top">
          <SidebarBrand href="/portal/" label="CUSTOMER PORTAL" onClick={() => setDrawer(false)} />
          <button type="button" className="side-close show-sm-flex" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={20} /></button>
        </div>
        <nav>
          {nav.map((e) => isNavGroup(e) ? (
            <div key={e.id} className={`grp${e.items.some((n) => active(n.href)) ? " has-on" : ""}`}>
              <button type="button" className="item grp-h" aria-expanded={openGroups.has(e.id)} aria-controls={`grp-${e.id}`} title={e.group} onClick={() => toggleGroup(e.id)}>
                <e.icon aria-hidden /><span className="lbl">{e.group}</span><ChevronDown className="chev" aria-hidden />
              </button>
              <div id={`grp-${e.id}`} className="sub" hidden={!openGroups.has(e.id)}>
                {e.items.map((n) => (
                  <Link key={n.id} href={n.href} className={cls(n.href, (n as Locked).locked)} aria-current={active(n.href) ? "page" : undefined}>
                    <n.icon aria-hidden /><span className="lbl">{n.label}</span>{(n as Locked).locked && <Lock className="lock" aria-label="Locked, upgrade to use" />}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <Link key={e.id} href={e.href} className={cls(e.href, (e as Locked).locked)} aria-current={active(e.href) ? "page" : undefined} title={e.label}>
              <e.icon aria-hidden /><span className="lbl">{e.label}</span>{(e as Locked).locked && <Lock className="lock" aria-label="Locked, upgrade to use" />}
            </Link>
          ))}
        </nav>
        <div className="side-bottom">
          <button type="button" className="item qs-btn" onClick={() => setQs(true)} title="Quick Search (Ctrl+B)" aria-keyshortcuts="Control+B">
            <Search aria-hidden /><span className="lbl">Quick Search</span><kbd className="lbl">Ctrl+B</kbd>
          </button>
          <a className="side-support" href={`tel:${support.phone.replace(/[^\d+]/g, "")}`} title={`${support.label}: ${support.phone}`}>
            <Phone aria-hidden size={18} />
            <span className="lbl"><small>{support.label}</small><b>{support.phone}</b><small><Clock size={11} aria-hidden style={{ verticalAlign: -1 }} /> {support.hours}</small></span>
          </a>
          <button type="button" className="side-pin hide-sm" onClick={togglePinned} aria-pressed={pinned} title={pinned ? "Unpin sidebar" : "Keep sidebar open"}>
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}<span className="lbl">{pinned ? "Unpin sidebar" : "Keep open"}</span>
          </button>
        </div>
      </aside>
      {drawer && <div className="backdrop on" onClick={() => setDrawer(false)} aria-hidden />}
      <QuickSearch open={qs} onClose={() => setQs(false)} menu={searchMenu} />
      <div className="main">
        <header className="top top2" ref={ref}>
          <Link href="/portal/" className="m-brand" aria-label="vishwaship.com home"><BrandLogo height={46} /></Link>
          <button className="icon-btn hide-xs" aria-label={drawer ? "Close menu" : "Open menu"} aria-expanded={drawer || pinned} onClick={onHamburger}><Menu size={20} /></button>
          <div className="hsearch" role="search">
            <label className="sr-only" htmlFor="hs-type">Search by</label>
            <select id="hs-type" value={sType} onChange={(e) => setSType(e.target.value as typeof sType)}><option value="awb">AWB ID</option><option value="order">Order ID</option><option value="lr">LR / LRN</option></select>
            <label className="sr-only" htmlFor="hs-q">Search</label>
            <input id="hs-q" value={sq} onChange={(e) => setSq(e.target.value)} onFocus={() => sRes && setMenu("search")} placeholder={`Search order by ${sType === "awb" ? "AWB ID" : sType === "order" ? "Order ID" : "LR / LRN"}`}
              onKeyDown={(e) => { if (e.key === "Enter" && sRes?.[0]) { router.push(sRes[0].href); setSq(""); setSRes(null); close(); } }} autoComplete="off" />
            {menu === "search" && sRes && (
              <div className="dropdown hs-res" role="listbox" aria-label="Search results">
                {sRes.length === 0 && <p className="small muted" style={{ padding: 10 }}>No {sType === "awb" ? "AWB" : sType === "order" ? "order" : "LR"} matches “{sq}”.</p>}
                {sRes.map((r) => <Link key={r.href} role="option" aria-selected={false} href={r.href} onClick={() => { setSq(""); setSRes(null); close(); }}><b>{r.title}</b><span className="tiny muted" style={{ display: "block" }}>{r.sub}</span></Link>)}
              </div>
            )}
            {sState === "error" && <span className="tiny t-debit" role="alert" style={{ position: "absolute", top: "100%" }}>Search failed — try again</span>}
          </div>
          <div className="grow" />
          <Link href="/portal/billing/notification-credits/" className="hcredits hide-md" title="Notification credit history">Notification Credits: <b>{credits.toLocaleString("en-IN")}</b></Link>
          <button type="button" className="hdr-ico hide-xs" aria-label="Refresh dashboard data" title="Refresh" onClick={() => startRefresh(() => router.refresh())}><RefreshCw size={18} className={refreshing ? "spin" : undefined} /></button>
          <div className="hwallet hide-xs">
            <Link href="/portal/billing/passbook/" className="hw-bal" aria-label={`Wallet balance ${formatINR(walletPaise)} — open Passbook`}><Wallet size={15} aria-hidden /><span>{formatINR(walletPaise)}</span></Link>
            <Link href="/portal/billing/passbook/?recharge=1" className="hw-rech">Recharge</Link>
          </div>
          <div style={{ position: "relative" }} className="hide-xs">
            <button className="btn btn-navy btn-sm hq" aria-label="Quick Actions" aria-haspopup="menu" aria-expanded={menu === "quick"} onClick={() => setMenu(menu === "quick" ? null : "quick")}><Zap size={15} /><span className="hide-md">Quick Actions</span><ChevronDown size={14} className="hide-xs" /></button>
            {menu === "quick" && (
              <div className="dropdown" role="menu">
                {qa.map((a) => <QaItem key={a.id} a={a} role="menuitem" onPick={close} />)}
              </div>
            )}
          </div>
          <Link href="/portal/support/" className="hdr-ico hchat" aria-label={`Support Chat${tickets.open ? `, ${tickets.open} open tickets` : ""}`} title="Support Chat"><MessageCircleMore size={19} aria-hidden />{tickets.open > 0 && <i>{tickets.open > 9 ? "9+" : tickets.open}</i>}</Link>
          <div style={{ position: "relative" }}>
            <button className="hdr-ico" aria-label={`Notifications${unreadAlerts.length ? `, ${unreadAlerts.length} unread` : ""}`} aria-haspopup="menu" aria-expanded={menu === "alerts"} onClick={() => setMenu(menu === "alerts" ? null : "alerts")}>
              <Bell size={19} />{unreadAlerts.length > 0 && <i>{unreadAlerts.length > 9 ? "9+" : unreadAlerts.length}</i>}
            </button>
            {menu === "alerts" && (
              <div className="dropdown wide" role="menu">
                <div className="dd-h"><b className="small">Notifications</b><span className="tiny muted">{unreadAlerts.length} unread</span></div>
                {unreadAlerts.length === 0 && <p className="small muted" style={{ padding: 10 }}>You’re all caught up.</p>}
                {unreadAlerts.slice(0, 8).map((a) => <Link key={a.id} role="menuitem" href={a.href ?? "/portal/alerts/"}><span className="small" style={{ display: "block" }}>{a.title}</span><span className="tiny muted">{ago(a.createdAt)}</span></Link>)}
                <div className="dd-f"><Link href="/portal/alerts/" className="btn btn-sm btn-outline">View all</Link></div>
              </div>
            )}
          </div>
          <div style={{ position: "relative" }} className="hide-xs">
            <button className="avatar" aria-label="Account menu" aria-haspopup="menu" aria-expanded={menu === "profile"} onClick={() => setMenu(menu === "profile" ? null : "profile")}>{initials}</button>
            {menu === "profile" && (
              <div className="dropdown" role="menu">
                <div style={{ padding: "8px 12px" }}><div className="b small">{user.name}</div><div className="tiny muted">{user.orgName}</div>{user.email && <div className="tiny muted">{user.email}</div>}</div>
                <Link role="menuitem" href="/portal/profile/">Profile &amp; business</Link>
                <Link role="menuitem" href="/portal/kyc/"><ShieldCheck size={14} style={{ verticalAlign: -2 }} /> KYC {user.kycStatus !== "approved" && <span className="chip c-pending" style={{ marginLeft: 6 }}>{user.kycStatus.replace("_", " ")}</span>}</Link>
                <Link role="menuitem" href="/portal/settings/">Account settings</Link>
                <form action={logout}><button className="dd" role="menuitem">Sign out</button></form>
              </div>
            )}
          </div>
        </header>
        <div className="content has-bnav" id="main">{children}</div>
        <button type="button" className="qa-fab" aria-label="Quick Actions" aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}><Zap size={26} aria-hidden /></button>
        {sheet && <QaSheet items={qa} onClose={() => setSheet(false)} />}
        <nav className="bnav" aria-label="Quick navigation">
          {[
            { href: "/portal/", label: "Home", icon: Home },
            { href: "/portal/orders/", label: "Orders", icon: Package },
            { href: "/portal/ndr/", label: "NDR", icon: CornerUpLeft },
            { href: "/portal/more/", label: "More", icon: LayoutGrid },
          ].map((n) => (
            <Link key={n.href} href={n.href} className={matches(n.href) && (n.href !== "/portal/" || path.length <= 8) ? "on" : ""} aria-current={matches(n.href) ? "page" : undefined}><span className="bi"><n.icon size={20} /></span>{n.label}</Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** One Quick Action: a link to its route, or the Support Chat sheet. */
function QaItem({ a, onPick, role, className }: { a: QuickAction; onPick: () => void; role?: string; className?: string }) {
  const body = <><a.icon size={16} aria-hidden /> <span>{a.label}</span></>;
  return <Link role={role} className={className} href={a.href!} onClick={onPick}>{body}</Link>;
}

/** Mobile Quick Actions bottom sheet (closes on pick, close button, backdrop or Escape). */
function QaSheet({ items, onClose }: { items: QuickAction[]; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sc-backdrop" onClick={onClose}>
      <section className="sc-sheet qa-sheet" role="dialog" aria-modal="true" aria-labelledby="qa-h" onClick={(e) => e.stopPropagation()}>
        <span className="sc-grip" aria-hidden />
        <header className="sc-h"><Zap size={22} aria-hidden /><h2 id="qa-h">Quick Actions</h2><button type="button" className="sc-x" aria-label="Close" onClick={onClose}><X size={22} /></button></header>
        <div className="qa-grid">
          {items.map((a) => <QaItem key={a.id} a={a} onPick={onClose} className={`qa-tile${a.primary ? " primary" : ""}`} />)}
        </div>
      </section>
    </div>
  );
}
