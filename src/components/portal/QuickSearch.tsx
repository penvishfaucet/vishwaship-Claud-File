"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Package, Search, X } from "lucide-react";

type Item = { href: string; title: string; sub?: string; locked?: boolean; kind: "menu" | "order" };

/** Quick Search (Ctrl+B): menu names + the account's own orders / AWB / LR. */
export function QuickSearch({ menu, open, onClose }: { menu: Array<{ href: string; label: string; parent?: string; locked?: boolean }>; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<Item[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => { if (open) { setQ(""); setOrders([]); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 3) { setOrders([]); setState("idle"); return; }
    setState("loading");
    const ctl = new AbortController();
    const h = setTimeout(() => {
      fetch(`/api/portal/search?q=${encodeURIComponent(t)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { results: Array<{ href: string; title: string; sub: string }> }) => { setOrders(j.results.map((r) => ({ ...r, kind: "order" as const }))); setState("idle"); })
        .catch((e) => { if ((e as Error).name !== "AbortError") setState("error"); });
    }, 250);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const t = q.trim().toLowerCase();
    const m = menu.filter((x) => !t || x.label.toLowerCase().includes(t) || x.parent?.toLowerCase().includes(t))
      .slice(0, t ? 12 : 8).map((x) => ({ href: x.href, title: x.label, sub: x.parent, locked: x.locked, kind: "menu" as const }));
    return [...m, ...orders];
  }, [q, menu, orders]);
  useEffect(() => setSel(0), [items.length]);

  if (!open) return null;
  const go = (it: Item) => { onClose(); router.push(it.href); };
  return (
    <div className="qs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="qs" role="dialog" aria-modal="true" aria-label="Quick search">
        <div className="qs-in">
          <Search size={18} aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menus, order ID, AWB or LR" aria-label="Search menus, order ID, AWB or LR"
            role="combobox" aria-expanded aria-controls="qs-list" aria-activedescendant={items[sel] ? `qs-${sel}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter" && items[sel]) go(items[sel]);
            }} />
          <button className="icon-btn" onClick={onClose} aria-label="Close search"><X size={18} /></button>
        </div>
        <ul id="qs-list" role="listbox" className="qs-list">
          {items.map((it, i) => (
            <li key={`${it.kind}${it.href}${i}`} id={`qs-${i}`} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
              {it.kind === "order" ? <Package size={15} aria-hidden /> : it.locked ? <Lock size={15} aria-hidden /> : <Search size={15} aria-hidden />}
              <span><b>{it.title}</b>{it.sub && <small>{it.kind === "menu" ? `in ${it.sub}` : it.sub}</small>}</span>
              <em>{it.kind === "order" ? "Order" : it.locked ? "Locked" : "Menu"}</em>
            </li>
          ))}
          {state === "loading" && <li className="qs-note">Searching orders…</li>}
          {state === "error" && <li className="qs-note t-debit">Could not search orders. Try again.</li>}
          {items.length === 0 && state === "idle" && <li className="qs-note">No matches. Try an order ID, AWB, LR or a menu name.</li>}
        </ul>
        <p className="qs-foot tiny muted">Ctrl+B to open · ↑↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  );
}
