"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";

/** Filter icon → search box for Ticket ID, Order ID or AWB (kept in the URL so Back restores it). */
export function TicketFilter({ q, tab }: { q: string; tab: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!q);
  const [v, setV] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setV(q); }, [q]);
  useEffect(() => { if (open && !q) input.current?.focus(); }, [open, q]);
  const go = (next: string) => {
    const p = new URLSearchParams({ ...(tab !== "open" ? { tab } : {}), ...(next.trim() ? { q: next.trim() } : {}) }).toString();
    router.push(`/portal/support/${p ? `?${p}` : ""}`);
  };
  return (
    <>
      <button type="button" className={`tk-filter${open ? " on" : ""}`} aria-label="Filter tickets" aria-expanded={open} aria-controls="tk-search" onClick={() => setOpen((o) => !o)}><SlidersHorizontal size={22} aria-hidden /></button>
      {open && (
        <form id="tk-search" className="tk-search" role="search" onSubmit={(e) => { e.preventDefault(); go(v); }}>
          <label className="sr-only" htmlFor="tk-q">Search by Ticket ID, Order ID or AWB</label>
          <input id="tk-q" ref={input} value={v} onChange={(e) => setV(e.target.value)} placeholder="Ticket ID, Order ID or AWB" maxLength={60} autoComplete="off" inputMode="search" />
          {v && <button type="button" aria-label="Clear search" onClick={() => { setV(""); go(""); }}><X size={18} aria-hidden /></button>}
          <button type="submit" className="go">Search</button>
        </form>
      )}
    </>
  );
}
