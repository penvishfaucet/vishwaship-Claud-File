"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";

type Hit = { href: string; title: string; sub: string };

/** Mobile dashboard "Search orders": looks up AWB, Order ID and LR together via the header search API. */
export function DashSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  useEffect(() => {
    const t = q.trim();
    if (t.length < 3) { setHits(null); setState("idle"); return; }
    setState("loading");
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      try {
        const res = await Promise.all((["awb", "order", "lr"] as const).map((type) =>
          fetch(`/api/portal/search?type=${type}&q=${encodeURIComponent(t)}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : { results: [] }))));
        const seen = new Set<string>();
        setHits(res.flatMap((j) => (j.results as Hit[]) ?? []).filter((x) => !seen.has(x.href) && seen.add(x.href)).slice(0, 8));
        setState("idle");
      } catch (e) { if ((e as Error).name !== "AbortError") setState("error"); }
    }, 250);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [q]);
  return (
    <div className="dsearch" role="search">
      <Search size={20} aria-hidden />
      <label className="sr-only" htmlFor="ds-q">Search orders</label>
      <input id="ds-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders" autoComplete="off" inputMode="search"
        onKeyDown={(e) => { if (e.key === "Enter" && hits?.[0]) router.push(hits[0].href); }} />
      {q.trim().length >= 3 && (
        <div className="dsearch-res" role="listbox" aria-label="Search results">
          {state === "loading" && !hits && <p className="small muted">Searching…</p>}
          {state === "error" && <p className="small t-debit" role="alert">Search failed — try again</p>}
          {hits && hits.length === 0 && <p className="small muted">No order, AWB or LR matches “{q.trim()}”.</p>}
          {hits?.map((h) => <Link key={h.href} role="option" aria-selected={false} href={h.href}><b>{h.title}</b><span className="tiny muted">{h.sub}</span></Link>)}
        </div>
      )}
    </div>
  );
}
