import { headers } from "next/headers";
import { StoreShell } from "@/components/store/Storefront";
import { rateLimit } from "@/server/security/rate-limit";
import { type PublicTrack, publicTrack } from "@/server/tracking/public";
import { type SfParams, type SfSearch, resolveSf, sfMeta } from "../_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const m = await sfMeta(await resolveSf(params, searchParams), "/track/", "Track your order");
  return { ...m, robots: { index: false, follow: true } };
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

export default async function Track({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const sp = await searchParams;
  const q = (typeof sp.awb === "string" ? sp.awb : "").trim().slice(0, 60);
  let r: PublicTrack | null = null;
  let limited = false;
  if (q && !sf.demo) {
    const ip = ((await headers()).get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
    limited = !(await rateLimit(`track:${ip}`, 20, 600)).ok;
    if (!limited) { try { r = await publicTrack(q); } catch { r = null; } }
  }
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page" style={{ maxWidth: 720 }}>
        <h1>Track your order</h1>
        <form method="get" role="search" style={{ display: "flex", gap: 8, margin: "16px 0 24px" }}>
          {sf.demo && <input type="hidden" name="theme" value={sf.themeKey} />}
          {sf.preview && <input type="hidden" name="preview" value="1" />}
          <label htmlFor="awb" className="sr-only">AWB number</label>
          <input id="awb" name="awb" className="sf-input" placeholder="Enter the AWB number from your SMS or email" defaultValue={q} required />
          <button className="sf-btn">Track</button>
        </form>
        {sf.demo && q && <p className="sf-note">This is a demo store — tracking works on real stores.</p>}
        {limited && <p role="status">Too many searches. Please try again in a few minutes.</p>}
        {r && r.kind !== "found" && <p role="status">{r.kind === "awb_pending" ? "Your order is packed and the courier number will be assigned soon." : "We couldn't find this AWB number. Please check and try again."}</p>}
        {r?.kind === "found" && (
          <div className="sf-summary" role="status">
            <div className="row"><span>{r.carrierName}</span><b>{r.statusLabel}</b></div>
            {r.etaDate && !r.deliveredAt && <div className="sf-note">Expected by {new Date(r.etaDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</div>}
            <ol style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 10 }}>
              {r.events.slice(0, 15).map((e, i) => <li key={i} style={{ borderTop: "1px solid var(--sf-line)", paddingTop: 8 }}><b>{e.status}</b>{e.location ? ` — ${e.location}` : ""}<div className="sf-note">{fmt(e.at)}</div></li>)}
            </ol>
          </div>
        )}
      </div>
    </StoreShell>
  );
}
