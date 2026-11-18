"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, Menu, Search, X } from "lucide-react";
import { ADMIN_NAV } from "./nav";
import { SidebarBrand } from "@/components/BrandLogo";

type BellData = { items: Array<{ id: string; title: string; href: string | null; createdAt: string; unseen: boolean }>; unseen: number; pendingRecharges: number };

export function AdminShell({ user, allowed, logout, children, bell, markSeen }: { user: { name: string; role: string }; allowed: string[]; logout: () => Promise<void>; children: React.ReactNode; bell?: BellData; markSeen?: () => Promise<void> }) {
  const [bellOpen, setBellOpen] = useState(false);
  const badge = bell?.unseen ?? 0;
  const path = usePathname();
  const router = useRouter();
  // keep the bell current: refresh server data every minute while visible and nobody is typing
  useEffect(() => {
    const t = setInterval(() => {
      const a = document.activeElement;
      if (document.visibilityState === "visible" && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) router.refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [router]);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const isOn = (href: string) => {
    const base = href.split("?")[0];
    return base === "/admin/" ? path === "/admin" || path === "/admin/" : path.startsWith(base.replace(/\/$/, ""));
  };
  return (
    <div className="shell admin-shell">
      <aside className={drawer ? "side open" : "side"} aria-label="Admin navigation">
        <SidebarBrand href="/admin/" label="ADMIN PORTAL" onClick={() => setDrawer(false)} />
        <nav>
          {ADMIN_NAV.map((g) => {
            const items = g.items.filter((i) => allowed.includes(i.perm));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="grp">{g.group}</div>
                {items.map((i) => <Link key={i.href} href={i.href} className={isOn(i.href) ? "item on" : "item"} aria-current={isOn(i.href) ? "page" : undefined} onClick={() => setDrawer(false)}><i.icon aria-hidden />{i.label}</Link>)}
              </div>
            );
          })}
        </nav>
      </aside>
      {drawer && <div className="backdrop on" onClick={() => setDrawer(false)} aria-hidden />}
      <div className="main">
        <header className="top">
          <button className="icon-btn show-sm-flex" aria-label={drawer ? "Close menu" : "Open menu"} onClick={() => setDrawer((d) => !d)}>{drawer ? <X size={20} /> : <Menu size={20} />}</button>
          <form className="search" role="search" style={{ display: "flex" }} onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); if (q) router.push(`/admin/shipments/?q=${encodeURIComponent(String(q))}`); }}>
            <Search size={16} aria-hidden /><label htmlFor="aq" className="sr-only">Search</label><input id="aq" name="q" placeholder="Customer, order, AWB / LR" />
          </form>
          <div className="grow" />
          {bell && (
            <div style={{ position: "relative" }}>
              <button className="icon-btn" aria-label={`Notifications${badge ? `, ${badge} new` : ""}${bell.pendingRecharges ? `, ${bell.pendingRecharges} recharge requests pending` : ""}`} aria-haspopup="dialog" aria-expanded={bellOpen}
                onClick={() => { const o = !bellOpen; setBellOpen(o); setMenu(false); if (o && badge && markSeen) void markSeen(); }} style={{ position: "relative" }}>
                <Bell size={20} aria-hidden />
                {(badge > 0 || bell.pendingRecharges > 0) && <span className="badge-dot" style={{ position: "absolute", top: 2, right: 2, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--orange)", color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{badge || bell.pendingRecharges}</span>}
              </button>
              {bellOpen && (
                <div className="dropdown wide" role="dialog" aria-label="Notifications" style={{ width: 340, maxHeight: 440, overflowY: "auto" }}>
                  {bell.pendingRecharges > 0 && <Link href="/admin/recharges/?status=open" className="dd" onClick={() => setBellOpen(false)} style={{ display: "block", fontWeight: 700 }}>{bell.pendingRecharges} manual recharge request{bell.pendingRecharges === 1 ? "" : "s"} pending verification →</Link>}
                  {bell.items.length === 0 && <p className="small muted" style={{ padding: 10, margin: 0 }}>No notifications.</p>}
                  {bell.items.map((a) => (
                    <Link key={a.id} href={a.href ?? "/admin/"} className="dd" onClick={() => setBellOpen(false)} style={{ display: "block", borderLeft: a.unseen ? "3px solid var(--orange)" : "3px solid transparent" }}>
                      <span className="small" style={{ display: "block" }}>{a.title}</span>
                      <span className="tiny muted">{new Date(a.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ position: "relative" }}>
            <button className="row" style={{ gap: 8, background: "none", border: 0, cursor: "pointer" }} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <span className="avatar">{user.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}</span>
              <span className="hide-sm" style={{ textAlign: "left" }}><span className="small b" style={{ display: "block" }}>{user.name}</span><span className="tiny muted">{user.role}</span></span>
            </button>
            {menu && <div className="dropdown" role="menu"><form action={logout}><button className="dd" role="menuitem">Log out</button></form></div>}
          </div>
        </header>
        <div className="content" id="main">{children}</div>
      </div>
    </div>
  );
}
