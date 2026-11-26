import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CopyLink } from "@/components/admin/CopyLink";
import { FRANCHISE_ZONES, type CardService } from "@/lib/franchise-rates";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { LIVE_ORIGIN, LIVE_ROUTES, isLiveRefreshing, readLivePriceList, startLiveRefresh } from "@/server/franchise-rates/live-list";
import { getFranchiseRateSettings, saveFranchiseRateSettings } from "@/server/franchise-rates/settings";
import { createRateLink, deleteRateLink, getRateLink, listRateLinks, updateRateLink } from "@/server/franchise-rates/links";
import { audit } from "@/server/audit";

export const metadata = { title: "Franchise Rate List — Admin" };

const rupeesToPaise = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? Math.round(n * 100) : null;
};

async function save(fd: FormData) {
  "use server";
  const s = await requireStaff("pricing.write");
  const pct = Number(fd.get("pct"));
  if (!(pct >= 0 && pct <= 100)) redirect("/admin/franchise-rate-list/?err=margin");
  const current = await getFranchiseRateSettings();
  const card: CardService[] = [];
  for (let si = 0; si < current.card.length; si++) {
    const first: number[] = [], addl: number[] = [];
    for (let zi = 0; zi < FRANCHISE_ZONES.length; zi++) {
      const f = rupeesToPaise(fd.get(`f-${si}-${zi}`)), a = rupeesToPaise(fd.get(`a-${si}-${zi}`));
      if (f === null || a === null) redirect("/admin/franchise-rate-list/?err=rate");
      first.push(f); addl.push(a);
    }
    card.push({ ...current.card[si], first500Paise: first, addl500Paise: addl });
  }
  await saveFranchiseRateSettings({ marginBps: Math.round(pct * 100), card }, s.userId);
  revalidatePath("/admin/franchise-rate-list/");
  revalidatePath("/franchise-rate-list/");
  redirect("/admin/franchise-rate-list/?saved=1");
}

async function refreshLive() {
  "use server";
  await requireStaff("pricing.write");
  startLiveRefresh();
  startLiveRefresh(true);
  redirect("/admin/franchise-rate-list/?refreshing=1");
}

/** Personal links: the same page made for one firm, with Shipora X rates on or off per link. */
async function addLink(fd: FormData) {
  "use server";
  const s = await requireStaff("pricing.write");
  const firm = String(fd.get("firm") ?? "").trim();
  if (firm.length < 2 || firm.length > 80) redirect("/admin/franchise-rate-list/?err=firm#links");
  const shipora = fd.get("shipora") === "on";
  const link = await createRateLink(firm, shipora);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "franchise_rate_link.created", targetType: "setting", targetId: link.id, details: { firm, shipora } });
  if (shipora) startLiveRefresh(true);
  redirect(`/admin/franchise-rate-list/?made=${link.id}#links`);
}

async function linkShipora(fd: FormData) {
  "use server";
  const s = await requireStaff("pricing.write");
  const link = await getRateLink(String(fd.get("id")));
  if (!link) redirect("/admin/franchise-rate-list/#links");
  await updateRateLink(link.id, { shipora: !link.shipora });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: link.shipora ? "franchise_rate_link.shipora_off" : "franchise_rate_link.shipora_on", targetType: "setting", targetId: link.id });
  if (!link.shipora) startLiveRefresh(true);
  redirect("/admin/franchise-rate-list/#links");
}

async function removeLink(fd: FormData) {
  "use server";
  const s = await requireStaff("pricing.write");
  const id = String(fd.get("id"));
  await deleteRateLink(id);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "franchise_rate_link.deleted", targetType: "setting", targetId: id });
  redirect("/admin/franchise-rate-list/#links");
}

export default async function FranchiseRateListAdmin({ searchParams }: { searchParams: Promise<{ saved?: string; err?: string; refreshing?: string; made?: string }> }) {
  const sp = await searchParams;
  const st = await requireStaff("pricing.read");
  const canWrite = can(st.role, "pricing.write");
  const s = await getFranchiseRateSettings();
  const live = await readLivePriceList();
  const liveCount = live ? Object.values(live.cells).flat().filter(Boolean).length : 0;
  const running = isLiveRefreshing();
  const links = await listRateLinks();
  return (
    <>
      <div className="page-h"><h1>Franchise Rate List</h1></div>
      <p className="small muted" style={{ marginTop: -6, maxWidth: 780 }}>
        Public page for franchise partners, bulk shippers, e-commerce, D2C and Shopify sellers. It is linked only from the website footer
        (not the header menu) and hidden from Google. The calculator shows the normal website price plus the margin below, on every charge
        including COD. The zone-wise price list at the bottom of the page is built from live courier rates (cheapest courier per zone and weight), with the same margin added.
      </p>

      <section className="card mt16" style={{ padding: 18 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Share link</h2>
        <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
          <div style={{ flex: "1 1 420px", minWidth: 0 }}><CopyLink path="/franchise-rate-list/" /></div>
          <a className="btn btn-sm btn-outline" href="/franchise-rate-list/" target="_blank" rel="noreferrer">Open page</a>
        </div>
      </section>

      <section className="card mt16" style={{ padding: 18 }} id="links">
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Personal links</h2>
        <p className="small muted" style={{ marginTop: 0, maxWidth: 780 }}>Make a link for one firm: the same page with their firm name on it (“Rates estimation designed for …”). Shipora X rates appear on that link only when you switch them on — the standard page never shows them.</p>
        {canWrite && (
          <form action={addLink} className="row wrap" style={{ gap: 10, alignItems: "end" }}>
            <div className="field" style={{ flex: "1 1 260px" }}><label htmlFor="fr-firm">Firm name</label><input id="fr-firm" name="firm" className="input" required minLength={2} maxLength={80} placeholder="e.g. Maa Ganga Super Collection" /></div>
            <label className="check small" style={{ paddingBottom: 8 }}><input type="checkbox" name="shipora" /> Include Shipora X rates</label>
            <button className="btn btn-orange btn-sm">Create link</button>
          </form>
        )}
        {sp.err === "firm" && <p className="small err mt8" role="alert">Enter the firm name (2 to 80 characters).</p>}
        {sp.made && <p className="small t-credit mt8" role="status">Link created — copy it below and send it.</p>}
        {links.length === 0 ? <p className="small muted mt12">No personal links yet.</p> : (
          <div className="tbl-wrap mt12"><table className="tbl"><thead><tr><th>Firm</th><th>Link</th><th>Shipora X</th><th>Created</th><th /></tr></thead>
            <tbody>{links.map((l) => (
              <tr key={l.id} style={sp.made === l.id ? { background: "var(--orange-50, #fff7ed)" } : undefined}>
                <td className="b small">{l.firm}</td>
                <td style={{ minWidth: 320 }}><CopyLink path={`/franchise-rate-list/for/${l.id}/`} /></td>
                <td>{canWrite
                  ? <form action={linkShipora}><input type="hidden" name="id" value={l.id} /><button className={`btn btn-sm ${l.shipora ? "btn-orange" : "btn-outline"}`} title="Switch Shipora X rates on this link">{l.shipora ? "On" : "Off"}</button></form>
                  : <span className={`chip ${l.shipora ? "c-active" : "c-cancelled"}`}>{l.shipora ? "On" : "Off"}</span>}</td>
                <td className="tiny muted">{new Date(l.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })}</td>
                <td><div className="row" style={{ gap: 6 }}><a className="btn btn-sm btn-outline" href={`/franchise-rate-list/for/${l.id}/`} target="_blank" rel="noreferrer">Open</a>{canWrite && <form action={removeLink}><input type="hidden" name="id" value={l.id} /><button className="btn btn-sm btn-outline" title="Delete this link — it stops working">Delete</button></form>}</div></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </section>

      <section className="card mt16" style={{ padding: 18 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Live price list</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Cheapest B2C prepaid rate from the active courier services, from {LIVE_ORIGIN.city} ({LIVE_ORIGIN.pin}) to {Object.entries(LIVE_ROUTES).map(([z, r]) => `Zone ${z} ${r.city}`).join(" · ")}, for 0.5 / 1 / 2 / 3 / 5 kg. Refreshes automatically once a day.
        </p>
        <p className="small" style={{ margin: "0 0 10px" }}>
          {live ? <>Last updated <b>{new Date(live.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</b> · {liveCount} of 25 prices found.</> : <>Not loaded yet.</>}
          {running && <> <b>Refreshing now…</b> (takes 1–3 minutes, then reload this page)</>}
        </p>
        {canWrite && <form action={refreshLive}><button className="btn btn-sm btn-outline" disabled={running}>Refresh now</button></form>}
        {sp.refreshing && !running && <p className="small t-credit mt8" role="status">Refresh finished.</p>}
      </section>

      <form action={save}>
        <section className="card mt16" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Margin</h2>
          <div className="field" style={{ maxWidth: 200 }}>
            <label htmlFor="fr-pct">Added on top of website price (%)</label>
            <input id="fr-pct" name="pct" type="number" step="0.01" min="0" max="100" className="input" defaultValue={s.marginBps / 100} disabled={!canWrite} />
          </div>
        </section>

        <section className="card p0 mt16">
          <div className="card-h"><h2 className="b small" style={{ margin: 0 }}>Fallback zone rates (₹, before margin and GST) — shown only until live rates have loaded</h2></div>
          {s.card.map((svc, si) => (
            <div key={svc.name} className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>{svc.name} · {svc.eta}</th>{FRANCHISE_ZONES.map((z) => <th key={z.code}>Zone {z.code} · {z.label}</th>)}</tr></thead>
                <tbody>
                  <tr><td className="b">First 500 g</td>{FRANCHISE_ZONES.map((z, zi) => (
                    <td key={z.code}><input aria-label={`${svc.name} zone ${z.code} first 500 g`} name={`f-${si}-${zi}`} type="number" step="1" min="0" className="input" style={{ maxWidth: 96 }} defaultValue={svc.first500Paise[zi] / 100} disabled={!canWrite} /></td>
                  ))}</tr>
                  <tr><td className="b">Each extra 500 g</td>{FRANCHISE_ZONES.map((z, zi) => (
                    <td key={z.code}><input aria-label={`${svc.name} zone ${z.code} each extra 500 g`} name={`a-${si}-${zi}`} type="number" step="1" min="0" className="input" style={{ maxWidth: 96 }} defaultValue={svc.addl500Paise[zi] / 100} disabled={!canWrite} /></td>
                  ))}</tr>
                </tbody>
              </table>
            </div>
          ))}
        </section>

        {canWrite && <div className="mt16"><button className="btn btn-orange">Save</button></div>}
        {sp.saved && <p className="small t-credit mt8" role="status">Saved. The Franchise Rate List page uses the new margin and rates now.</p>}
        {sp.err === "margin" && <p className="small err mt8" role="alert">Enter a margin between 0 and 100.</p>}
        {sp.err === "rate" && <p className="small err mt8" role="alert">Every rate must be a number from 0 to 1,00,000.</p>}
      </form>
    </>
  );
}
