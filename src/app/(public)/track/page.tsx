import { headers } from "next/headers";
import { OneShipment } from "@/components/tracking/ShipmentTracking";
import Link from "next/link";
import { CheckCircle2, Clock, MapPin, PackageSearch, Search, Truck } from "lucide-react";
import { carrierLogo } from "@/lib/site";
import { rateLimit } from "@/server/security/rate-limit";
import { type PublicTrack, publicTrack } from "@/server/tracking/public";
import { getSiteContent } from "@/server/site/content";

export const dynamic = "force-dynamic";
export const metadata = { title: "Track Shipment — Vishwaship", description: "Track your Vishwaship shipment by AWB or LR number." };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ awb?: string }> }) {
  const { awb } = await searchParams;
  const c = await getSiteContent();
  const q = (awb ?? "").trim().slice(0, 60);
  let result: PublicTrack | null = null;
  let limited = false, failed = false;
  if (q && c.features.tracking) {
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
    // Anti-enumeration: 20 lookups / 10 min per IP; the same "not found" for every unknown number.
    const rl = await rateLimit(`track:${ip}`, 20, 600);
    limited = !rl.ok;
    if (!limited) { try { result = await publicTrack(q); } catch { failed = true; } }
  }
  const r = result?.kind === "found" ? result : null;
  const logo = r ? carrierLogo(r.carrierCode) : null;
  return (
    <section className="w-sec" style={{ paddingTop: 48 }} aria-labelledby="trk-h">
      <div className="w-wrap" style={{ maxWidth: 880 }}>
        <span className="w-eyebrow">Track shipment</span>
        <h1 id="trk-h" className="w-h2" style={{ fontSize: "clamp(30px,4vw,46px)" }}>Where is my shipment?</h1>
        <p className="w-lead">Enter the AWB number from your label or SMS. Business (B2B) consignments can also be tracked by LR / LRN.</p>
        {!c.features.tracking ? (
          <p className="w-card" role="status" style={{ marginTop: 24, padding: 24 }}>{c.features.unavailableText}</p>
        ) : (
          <form className="w-card w-trkform" action="/track/" method="get" role="search">
            <label htmlFor="trk-awb">AWB or LR number</label>
            <div className="f">
              <input id="trk-awb" name="awb" className="w-in" defaultValue={q} placeholder="e.g. 22784714346650" autoComplete="off" maxLength={40} required />
              <button className="w-btn pri" type="submit"><Search size={18} aria-hidden="true" />Track</button>
            </div>
          </form>
        )}

        <div aria-live="polite">
          {limited && <Msg tone="bad" title="Too many lookups">Please wait a few minutes and try again.</Msg>}
          {failed && <Msg tone="bad" title="Tracking is temporarily unavailable">We could not reach the tracking service just now. Please try again shortly.</Msg>}
          {result?.kind === "invalid" && <Msg tone="bad" title="That doesn’t look like a tracking number">AWB and LR numbers have 6–40 letters or digits. Check the number on your label and try again.</Msg>}
          {result?.kind === "not_found" && <Msg tone="bad" title="Shipment not found">We couldn’t find a shipment with “{q}”. Check the number, or contact the seller. If you booked it, <Link href={`/login/?next=${encodeURIComponent("/portal/track/")}`}>log in</Link> to see all your shipments.</Msg>}
          {result?.kind === "awb_pending" && <Msg tone="info" title="Booking received — AWB pending">{result.carrierName} ({result.serviceName}) has accepted the booking and is assigning the AWB. Tracking starts once the courier confirms it.</Msg>}
        </div>

        {r && (
          <article className="w-card w-trk" aria-labelledby="trk-res">
            <header>
              <div className="who">
                {logo ? <img src={logo} alt="" /> : <span className="ph"><Truck size={22} aria-hidden="true" /></span>}
                <div><b id="trk-res">{r.carrierName}</b><span>{r.serviceName}</span></div>
              </div>
              <div className="st"><span className={`pill s-${r.status}`}>{r.statusLabel}</span>{r.isDemo && <span className="demo">Demo shipment</span>}</div>
            </header>
            <dl>
              <div><dt>AWB</dt><dd className="mono">{r.awb}</dd></div>
              {r.lr && <div><dt>LR / LRN</dt><dd className="mono">{r.lr}</dd></div>}
              <div><dt><MapPin size={14} aria-hidden="true" /> Latest scan</dt><dd>{r.lastLocation ?? "—"}{r.lastAt ? <span>{fmt(r.lastAt)}</span> : null}</dd></div>
              {r.deliveredAt
                ? <div><dt><CheckCircle2 size={14} aria-hidden="true" /> Delivered</dt><dd>{fmt(r.deliveredAt)}</dd></div>
                : r.etaDate ? <div><dt><Clock size={14} aria-hidden="true" /> Estimated delivery</dt><dd>{day(r.etaDate)}</dd></div> : null}
            </dl>
            {r.stale && <p className="note">No new scan from the courier for a few days. Updates may be delayed — check again later or contact the seller.</p>}
            <h2>Tracking history</h2>
            <div className="st-public"><OneShipment s={{ id: r.awb, awb: r.awb, carrierName: r.carrierName, statusLabel: r.statusLabel, milestones: r.milestones, scans: r.scans }} labelled={false} /></div>
          </article>
        )}
        {!q && c.features.tracking && <p className="w-trk-hint"><PackageSearch size={18} aria-hidden="true" />Sellers: log in to the dashboard to track every shipment with full details.</p>}
      </div>
    </section>
  );
}

function Msg({ tone, title, children }: { tone: "bad" | "info"; title: string; children: React.ReactNode }) {
  return <div className={`w-card w-msg ${tone}`} role={tone === "bad" ? "alert" : "status"}><b>{title}</b><p>{children}</p></div>;
}
