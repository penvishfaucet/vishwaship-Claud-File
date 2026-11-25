import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CopyLink } from "@/components/admin/CopyLink";
import { FRANCHISE_ZONES, type CardService } from "@/lib/franchise-rates";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getFranchiseRateSettings, saveFranchiseRateSettings } from "@/server/franchise-rates/settings";

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

export default async function FranchiseRateListAdmin({ searchParams }: { searchParams: Promise<{ saved?: string; err?: string }> }) {
  const sp = await searchParams;
  const st = await requireStaff("pricing.read");
  const canWrite = can(st.role, "pricing.write");
  const s = await getFranchiseRateSettings();
  return (
    <>
      <div className="page-h"><h1>Franchise Rate List</h1></div>
      <p className="small muted" style={{ marginTop: -6, maxWidth: 780 }}>
        Public page for franchise partners, bulk shippers, e-commerce, D2C and Shopify sellers. It is linked only from the website footer
        (not the header menu) and hidden from Google. The calculator shows the normal website price plus the margin below, on every charge
        including COD. The zone-wise price list at the bottom of the page uses the base rates below, with the same margin added.
      </p>

      <section className="card mt16" style={{ padding: 18 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Share link</h2>
        <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
          <div style={{ flex: "1 1 420px", minWidth: 0 }}><CopyLink path="/franchise-rate-list/" /></div>
          <a className="btn btn-sm btn-outline" href="/franchise-rate-list/" target="_blank" rel="noreferrer">Open page</a>
        </div>
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
          <div className="card-h"><h2 className="b small" style={{ margin: 0 }}>Base zone rates for the price list (₹, before margin and GST)</h2></div>
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
