"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { COD_DISPLAY, type CodDisplay } from "@/lib/order-view";

export const inr = (p: number | null | undefined) => (p == null ? "—" : `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
export const kg = (g: number | null | undefined) => (g ? `${(g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })}kg` : "—");
export const istDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
export const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
export const istFull = (iso: string | Date | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) : "—");
export const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Close a popover on outside click / Escape; returns a ref for the container. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", h); document.addEventListener("touchstart", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); document.removeEventListener("keydown", k); };
  }, [open, close]);
  return ref;
}

export function CopyBtn({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="ov-copy" aria-label={`Copy ${label}`} title={`Copy ${label}`}
      onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }}>
      {done ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      <span className="sr-only" role="status">{done ? "Copied" : ""}</span>
    </button>
  );
}

/** Native <dialog> (focus trap, Esc, backdrop) opened while mounted. */
export function Dialog({ title, sub, onClose, children, wide }: { title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (!d.open) d.showModal();
    const c = () => onClose();
    d.addEventListener("close", c);
    return () => d.removeEventListener("close", c);
  }, [onClose]);
  return (
    <dialog ref={ref} className="ov-dialog" style={wide ? { width: "min(760px, calc(100vw - 24px))" } : undefined} aria-labelledby="ov-dlg-h"
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <header>
        <div><h2 id="ov-dlg-h" style={{ fontSize: 17 }}>{title}</h2>{sub && <div className="small muted" style={{ marginTop: 2 }}>{sub}</div>}</div>
        <button type="button" className="ov-copy" aria-label="Close" onClick={() => ref.current?.close()}><X size={20} aria-hidden /></button>
      </header>
      <div className="body">{children}</div>
    </dialog>
  );
}

const TONE: Record<string, string> = { muted: "t-muted", info: "t-info", ok: "t-ok", warn: "t-warn", bad: "t-bad" };
export function CodStatusText({ s }: { s: CodDisplay }) {
  const d = COD_DISPLAY[s];
  return <span className={TONE[d.tone]}>{d.label}</span>;
}
