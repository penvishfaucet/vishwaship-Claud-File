"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { ADMIN_NAV } from "./nav";
import { SidebarBrand, TopbarBrand } from "@/components/BrandLogo";

export function AdminShell({ user, allowed, logout, children }: { user: { name: string; role: string }; allowed: string[]; logout: () => Promise<void>; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
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
          <TopbarBrand href="/admin/" label="Admin dashboard" />
          <form className="search" role="search" style={{ display: "flex" }} onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); if (q) router.push(`/admin/shipments/?q=${encodeURIComponent(String(q))}`); }}>
            <Search size={16} aria-hidden /><label htmlFor="aq" className="sr-only">Search</label><input id="aq" name="q" placeholder="Customer, order, AWB / LR" />
          </form>
          <div className="grow" />
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
