"use client";
import Link from "next/link";
import {
  BadgeCheck, ChevronDown, ChevronRight, ClipboardList, FileBarChart, Headphones, KeyRound, LifeBuoy, Lock, LogOut, type LucideIcon, Package, Phone, Receipt,
  Settings, ShieldCheck, Store, Ticket, User, Wallet, Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type ModuleState, type NavLink, flatNav, visibleNav } from "./nav";
import { type AvatarData, EditableAvatar } from "./ProfileAvatar";
import { ThemePicker } from "./ThemePicker";

/**
 * Mobile "More": profile card, account summary, appearance, then every portal destination grouped by what people do.
 * A row is either a direct link (right chevron) or a group that opens in place (down chevron). The last opened group
 * and the last tapped link are remembered, so coming back from a page shows where the user was.
 */
type Row =
  | { kind: "nav"; id: string }
  | { kind: "link"; key: string; label: string; href: string; icon: LucideIcon; external?: boolean }
  | { kind: "group"; key: string; label: string; icon: LucideIcon; ids: string[]; extra?: Array<{ key: string; label: string; href: string; icon: LucideIcon }> };
type Section = { key: string; title: string; rows: Row[] };

const SECTIONS = (supportPhone: string): Section[] => [
  { key: "profile", title: "Profile", rows: [
    { kind: "link", key: "profile", label: "My Profile", href: "/portal/profile/", icon: User },
    { kind: "link", key: "kyc", label: "Documents & KYC", href: "/portal/kyc/", icon: ShieldCheck },
    { kind: "link", key: "password", label: "Change Password", href: "/portal/settings/#password", icon: KeyRound },
  ] },
  { key: "ops", title: "Shipping Operations", rows: [
    { kind: "nav", id: "pickups" },
    { kind: "link", key: "manifests", label: "Manifests", href: "/portal/orders/manifests/", icon: ClipboardList },
    { kind: "nav", id: "tools.track" },
    { kind: "nav", id: "tools.weight" },
    { kind: "group", key: "others", label: "Customers, products & tags", icon: Package, ids: ["others.customers", "others.products", "others.packaging", "others.tags"] },
  ] },
  { key: "store", title: "Online Store", rows: [
    { kind: "nav", id: "store.overview" }, { kind: "nav", id: "store.orders" }, { kind: "nav", id: "store.dispatch" }, { kind: "nav", id: "store.inventory" }, { kind: "nav", id: "store.rto_cod" },
    { kind: "group", key: "store-setup", label: "Store setup & marketing", icon: Store, ids: ["store.products", "store.theme", "store.pages", "store.domains", "store.payments", "store.plan", "store.sales", "store.coupons", "store.reviews", "store.marketing", "store.managed_ads", "store.analytics"] },
  ] },
  { key: "money", title: "Billing, Tools & Reports", rows: [
    { kind: "group", key: "billing", label: "Billing", icon: Receipt, ids: ["billing.passbook", "billing.recharges", "billing.cod", "billing.charges", "billing.gst", "billing.invoices", "billing.credit_notes", "billing.debit_notes", "billing.ledgers", "billing.credits"] },
    { kind: "group", key: "tools", label: "Tools", icon: Wrench, ids: ["tools.rates", "tools.price_list", "tools.couriers", "tools.activity", "tools.downloads"] },
    { kind: "group", key: "reports", label: "Reports", icon: FileBarChart, ids: ["reports.shipments", "reports.orders", "reports.ndr", "reports.custom", "store.pnl"] },
  ] },
  { key: "settings", title: "Settings & Warehouse", rows: [
    { kind: "group", key: "settings", label: "Settings", icon: Settings, ids: ["settings.tracking", "settings.label", "settings.invoice", "settings.auto_assign", "settings.notifications", "settings.cod", "settings.early_cod", "settings.cod_bank"],
      extra: [{ key: "account", label: "Account & security", href: "/portal/settings/", icon: BadgeCheck }] },
    { kind: "nav", id: "warehouse" },
  ] },
  { key: "integrations", title: "Integrations", rows: [
    { kind: "nav", id: "integrations.channels" }, { kind: "nav", id: "integrations.oms" }, { kind: "nav", id: "integrations.api" }, { kind: "nav", id: "integrations.edd" }, { kind: "nav", id: "integrations.own" },
  ] },
  { key: "help", title: "Help & Support", rows: [
    { kind: "link", key: "tickets", label: "Support Tickets", href: "/portal/support/", icon: Ticket },
    { kind: "link", key: "chat", label: "Chat Support", href: "/portal/support/new/", icon: Headphones },
    { kind: "link", key: "call", label: `Contact Us · ${supportPhone}`, href: `tel:${supportPhone.replace(/[^\d+]/g, "")}`, icon: Phone, external: true },
  ] },
];

export type AccountSummary = { walletPaise: number | null; status: { label: string; tone: "ok" | "warn" | "bad"; href: string } | null };

export function MoreMenu(p: {
  user: { name: string; email: string | null; mobile: string | null; role: string; orgName: string }; avatar: AvatarData; summary: AccountSummary;
  modules: ModuleState; labels: Record<string, string>; supportPhone: string; logout: () => Promise<void>;
}) {
  const nav = useMemo(() => flatNav(visibleNav(p.modules, p.labels)) as Array<NavLink & { locked?: boolean }>, [p.modules, p.labels]);
  const byId = useMemo(() => new Map(nav.map((n) => [n.id, n])), [nav]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [last, setLast] = useState("");
  useEffect(() => {
    try { setOpen(new Set(JSON.parse(sessionStorage.getItem("vs-more-open") ?? "[]"))); setLast(sessionStorage.getItem("vs-more-last") ?? ""); } catch { /* ignore */ }
  }, []);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); try { sessionStorage.setItem("vs-more-open", JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  const remember = (href: string) => { try { sessionStorage.setItem("vs-more-last", href); } catch { /* ignore */ } };
  const rs = (x: number) => `₹${(x / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const linkRow = (key: string, label: string, href: string, Icon: LucideIcon, opts: { locked?: boolean; external?: boolean; sub?: boolean } = {}) => {
    const body = <><span className="ic"><Icon size={18} aria-hidden /></span><span className="mr-l">{label}</span>{opts.locked ? <Lock size={14} aria-label="Locked, upgrade to use" /> : <ChevronRight size={16} aria-hidden />}</>;
    const cls = `more-row${opts.sub ? " sub" : ""}${last === href ? " on" : ""}`;
    return opts.external ? <a key={key} className={cls} href={href}>{body}</a> : <Link key={key} className={cls} href={href} onClick={() => remember(href)} aria-current={last === href ? "true" : undefined}>{body}</Link>;
  };
  const navRow = (id: string, sub = false) => { const n = byId.get(id); return n ? linkRow(n.id, n.label, n.href, n.icon, { locked: n.locked, sub }) : null; };

  return (
    <div className="more-v2">
      <section className="card mv-profile">
        <EditableAvatar name={p.user.name} avatar={p.avatar} size={64} />
        <div className="mv-who">
          <b>{p.user.name}</b>
          {p.user.email && <span className="small">{p.user.email}</span>}
          {p.user.mobile && <span className="small muted">{p.user.mobile}</span>}
          <span className="tiny muted">{p.user.role} · {p.user.orgName}</span>
        </div>
      </section>

      {(p.summary.walletPaise !== null || p.summary.status) && (
        <div className="mv-sum">
          {p.summary.walletPaise !== null && <Link href="/portal/billing/passbook/" className="card mv-card"><span className="tiny muted"><Wallet size={14} aria-hidden /> Wallet Balance</span><b>{rs(p.summary.walletPaise)}</b></Link>}
          {p.summary.status && <Link href={p.summary.status.href} className="card mv-card"><span className="tiny muted"><BadgeCheck size={14} aria-hidden /> Profile Status</span>
            <b className={p.summary.status.tone === "ok" ? "green" : p.summary.status.tone === "bad" ? "red" : "orange"}>{p.summary.status.label}</b></Link>}
        </div>
      )}

      <section className="card mv-appear"><span className="small" style={{ fontWeight: 600 }}>Appearance</span><ThemePicker /></section>

      {SECTIONS(p.supportPhone).map((s) => {
        const rows = s.rows.map((r) => {
          if (r.kind === "nav") return navRow(r.id);
          if (r.kind === "link") return linkRow(r.key, r.label, r.href, r.icon, { external: r.external });
          const items = r.ids.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
          if (!items.length && !r.extra?.length) return null;
          const isOpen = open.has(r.key) || items.some((i) => i.href === last);
          return (
            <div key={r.key} className="mv-grp">
              <button type="button" className="more-row" aria-expanded={isOpen} aria-controls={`mg-${r.key}`} onClick={() => toggle(r.key)}>
                <span className="ic"><r.icon size={18} aria-hidden /></span><span className="mr-l">{r.label}</span><span className="tiny muted">{items.length + (r.extra?.length ?? 0)}</span><ChevronDown size={16} className={isOpen ? "rot" : ""} aria-hidden />
              </button>
              <div id={`mg-${r.key}`} hidden={!isOpen}>
                {r.extra?.map((x) => linkRow(x.key, x.label, x.href, x.icon, { sub: true }))}
                {items.map((i) => linkRow(i.id, i.label, i.href, i.icon, { locked: i.locked, sub: true }))}
              </div>
            </div>
          );
        }).filter(Boolean);
        if (!rows.length) return null;
        return (
          <section key={s.key}>
            <h2 className="more-grp">{s.title}</h2>
            <div className="more-card">{rows}</div>
          </section>
        );
      })}

      <form action={p.logout} className="mv-out"><button className="more-row"><span className="ic"><LogOut size={18} aria-hidden /></span><span className="mr-l">Sign Out</span></button></form>
      <p className="tiny muted" style={{ textAlign: "center", margin: "8px 0 0" }}><LifeBuoy size={12} aria-hidden /> Need help? Raise a support ticket any time.</p>
    </div>
  );
}

