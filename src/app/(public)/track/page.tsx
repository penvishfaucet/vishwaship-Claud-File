import { headers } from "next/headers";
import { TrackForm } from "@/components/public/TrackForm";
import { carrierLogo } from "@/lib/site";
import { rateLimit } from "@/server/security/rate-limit";
import { publicTrack } from "@/server/tracking/public";

export const dynamic = "force-dynamic";
export const metadata = { title: "Track Shipment — Vishwaship.com" };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ awb?: string }> }) {
  const { awb } = await searchParams;
  let result: Awaited<ReturnType<typeof publicTrack>> = null;
  let limited = false;
  if (awb) {
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
    // Anti-enumeration: 20 lookups / 10 min per IP; identical "not found" for invalid and unknown AWBs.
    const rl = await rateLimit(`track:${ip}`, 20, 600);
    limited = !rl.ok;
    if (!limited) result = await publicTrack(awb);
  }
  const logo = result ? carrierLogo(result.carrierCode) : null;
  return (
    <section className="vs-sec">
      <div className="vs-wrap" style={{ maxWidth: 820 }}>
        <span className="vs-eyebrow">TRACK SHIPMENT</span>
        <h1 className="vs-h2">Where’s your shipment?</h1>
        <div className="vs-trackcard mt16"><TrackForm initial={awb ?? ""} /></div>
        {limited && <p className="err mt16" role="alert">Too many lookups. Please try again in a few minutes.</p>}
        {awb && !limited && !result && <p className="card trk-card" role="status">We couldn’t find a shipment with that AWB. Check the number and try again, or log in to see all your shipments.</p>}
        {result && (
          <div className="card trk-card" aria-live="polite">
            <div className="row between wrap" style={{ gap: 16 }}>
              <div className="row" style={{ gap: 12, alignItems: "center" }}>
                {logo && <img src={logo} alt={result.carrierName} style={{ height: 30 }} />}
                <div><div className="tiny muted">AWB</div><div className="b mono">{result.awb}</div></div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="b" style={{ fontSize: 20 }}>{result.statusLabel}</div>
                {result.etaDate && <div className="tiny muted">Expected by {new Date(result.etaDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}</div>}
              </div>
            </div>
            {result.isDemo && <p className="mt8"><span className="demo-badge">DEMO SHIPMENT</span></p>}
            <ol className="trk-tl">
              {[...result.events].reverse().map((e, i) => (
                <li key={i} className={i === 0 ? "cur" : ""}><span className="b small">{e.status}{e.location ? <span className="muted"> · {e.location}</span> : null}</span><span className="tiny muted">{fmt(e.at)}</span></li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
