"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FileText, Home, Link2, Menu, Package, Users, X } from "lucide-react";
import { SidebarBrand } from "@/components/BrandLogo";

const NAV = [
  { href: "/franchise/", label: "Dashboard", icon: Home },
  { href: "/franchise/customers/", label: "My customers", icon: Users },
  { href: "/franchise/shipments/", label: "Shipments", icon: Package },
  { href: "/franchise/referral/", label: "Referral link", icon: Link2 },
  { href: "/franchise/agreement/", label: "Agreement", icon: FileText },
];

/** Franchise dashboard frame (same look as the admin portal, own menu). */
export function FranchiseShell({ user, franchise, logout, children }: { user: { name: string }; franchise: { code: string; name: string; status: string }; logout: () => Promise<void>; children: React.ReactNode }) {
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const isOn = (href: string) => (href === "/franchise/" ? path === "/franchise" || path === "/franchise/" : path.startsWith(href.replace(/\/$/, "")));
  return (
    <div className="shell admin-shell">
      <aside className={drawer ? "side open" : "side"} aria-label="Franchise navigation">
        <SidebarBrand href="/franchise/" label="FRANCHISE" onClick={() => setDrawer(false)} />
        <nav>
          <div className="grp">{franchise.code}</div>
          {NAV.map((i) => <Link key={i.href} href={i.href} className={isOn(i.href) ? "item on" : "item"} aria-current={isOn(i.href) ? "page" : undefined} onClick={() => setDrawer(false)}><i.icon aria-hidden />{i.label}</Link>)}
        </nav>
      </aside>
      {drawer && <div className="backdrop on" onClick={() => setDrawer(false)} aria-hidden />}
      <div className="main">
        <header className="top">
          <button className="icon-btn show-sm-flex" aria-label={drawer ? "Close menu" : "Open menu"} onClick={() => setDrawer((d) => !d)}>{drawer ? <X size={20} /> : <Menu size={20} />}</button>
          <b className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{franchise.name}</b>
          <div className="grow" />
          <div style={{ position: "relative" }}>
            <button className="row" style={{ gap: 8, background: "none", border: 0, cursor: "pointer" }} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <span className="avatar">{user.name.split(" ").map((s) => s[0]).join("").slice(0, 2)}</span>
              <span className="hide-sm" style={{ textAlign: "left" }}><span className="small b" style={{ display: "block" }}>{user.name}</span><span className="tiny muted">Franchise partner</span></span>
            </button>
            {menu && <div className="dropdown" role="menu"><form action={logout}><button className="dd" role="menuitem">Log out</button></form></div>}
          </div>
        </header>
        <div className="content" id="main">
          {franchise.status === "suspended" && <p className="err-box small mb12" role="status">Your franchise is suspended. You can see your customers, but new customers are not linked through your referral link until Vishwaship re-activates it.</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-outline" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }); }}>
      {done ? "Copied" : label}
    </button>
  );
}
