import { CopyButton } from "@/components/franchise/FranchiseShell";
import { referralLink, siteBase } from "@/server/franchise/referral";
import { requireFranchise } from "@/server/franchise/session";

export default async function FranchiseReferral() {
  const { franchise: f } = await requireFranchise();
  const link = referralLink(await siteBase(), f.code);
  const msg = `Ship with Vishwaship: compare courier rates, book pickups and track every parcel in one account. Sign up here: ${link}`;
  return (
    <>
      <div className="page-h"><div><h1>Referral link</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Customers who open this link and create an account become your customers.</p></div></div>
      <div className="card mb12" style={{ padding: 16, display: "grid", gap: 10 }}>
        <label className="small b" htmlFor="ref">Your link</label>
        <div className="row wrap" style={{ gap: 8 }}>
          <input id="ref" className="input mono" readOnly value={link} style={{ flex: "1 1 260px", width: "auto" }} />
          <CopyButton text={link} />
          <a className="btn btn-outline" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        </div>
        <p className="small" style={{ margin: 0 }}>Referral code: <b className="mono">{f.code}</b> (for the Vishwaship Android app sign-up)</p>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <h3 style={{ fontSize: 14, marginTop: 0 }}>How it works</h3>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>The customer opens your link. It is remembered on their phone or computer for 30 days.</li>
          <li>They create a Vishwaship account (email or Google). The account is linked to you at once.</li>
          <li>They appear in <a href="/franchise/customers/">My customers</a> with their shipments and wallet balance.</li>
          <li>A customer who already has a Vishwaship account is not moved. Ask Vishwaship if one should be linked to you.</li>
          {f.status !== "active" && <li className="red">Your franchise is not active right now, so new sign-ups are not linked to you.</li>}
        </ol>
      </div>
    </>
  );
}
