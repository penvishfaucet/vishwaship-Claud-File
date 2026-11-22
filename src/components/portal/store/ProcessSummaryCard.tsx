import Link from "next/link";
import { Boxes, ChevronRight, Printer, Timer, Truck } from "lucide-react";
import { processQueue } from "@/server/store/process";

/** Dashboard: today's store dispatch work at a glance (only for accounts with an Online Store). */
export async function ProcessSummaryCard({ orgId }: { orgId: string }) {
  let s: Awaited<ReturnType<typeof processQueue>>["summary"];
  try { s = (await processQueue(orgId, {})).summary; } catch { return null; }
  const steps = [
    { k: "print", label: "Print", n: s.print, icon: Printer, href: "/portal/store/dispatch/?tab=pending&step=print" },
    { k: "pack", label: "Pack", n: s.pack, icon: Boxes, href: "/portal/store/dispatch/?tab=pending&step=pack" },
    { k: "handover", label: "Handover", n: s.handover, icon: Truck, href: "/portal/store/dispatch/?tab=pending&step=handover" },
    { k: "delayed", label: "Delayed", n: s.delayed, icon: Timer, href: "/portal/store/dispatch/?tab=pending&delayed=1", hot: s.delayed > 0 },
  ];
  return (
    <section className="card mb16 pcard" aria-label="Process Orders">
      <Link href="/portal/store/dispatch/" className="pcard-h">
        <span><b>Process Orders</b><span className="small muted"> · {s.total} store order{s.total === 1 ? "" : "s"} to dispatch</span></span>
        <span className="small orange pcard-open">Open <ChevronRight size={14} aria-hidden /></span>
      </Link>
      <div className="pcard-steps">
        {steps.map((x) => (
          <Link key={x.k} href={x.href} className={`pcard-step${x.hot ? " hot" : ""}`}>
            <x.icon size={18} aria-hidden /><b>{x.n}</b><span>{x.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
