import Link from "next/link";
import { EditableAvatar } from "@/components/portal/ProfileAvatar";
import { readAvatar } from "@/server/portal/avatar";
import { portalContext } from "@/server/portal/context";

export default async function ProfilePage() {
  const ctx = await portalContext();
  const o = ctx.org;
  const avatar = await readAvatar(ctx.session.userId);
  return (
    <>
      <div className="page-h"><h1>My Profile</h1><div className="actions"><Link className="btn btn-orange" href="/portal/support/new/?category=other&order=Profile%20change">Edit Profile</Link></div></div>
      <section className="card mb12 mv-profile">
        <EditableAvatar name={ctx.session.name} avatar={avatar} size={72} />
        <div className="mv-who"><b>{ctx.session.name}</b>{ctx.session.email && <span className="small">{ctx.session.email}</span>}<span className="tiny muted">Account owner · {o.businessName}</span>
          <span className="small"><Link className="link" href="/portal/kyc/">Documents &amp; KYC</Link> · <Link className="link" href="/portal/settings/#password">Change Password</Link></span></div>
      </section>
      <div className="grid2" style={{ gap: 12 }}>
        <section className="card" style={{ padding: 16 }}><h2 className="b small" style={{ marginTop: 0 }}>Business</h2><dl className="kv-list"><dt>Business name</dt><dd>{o.businessName}</dd><dt>GSTIN</dt><dd>{o.gstin ?? "—"}</dd><dt>Expected volume</dt><dd>{o.expectedMonthlyVolume ?? "—"}</dd></dl></section>
        <section className="card" style={{ padding: 16 }}><h2 className="b small" style={{ marginTop: 0 }}>Contact</h2><dl className="kv-list"><dt>Name</dt><dd>{ctx.session.name}</dd><dt>Email</dt><dd>{ctx.session.email ?? "—"}</dd></dl></section>
        <section className="card" style={{ padding: 16 }}><h2 className="b small" style={{ marginTop: 0 }}>KYC</h2><p className="small">Status: <span className="chip c-pending">{o.kycStatus.replace("_", " ")}</span></p><Link className="link small" href="/portal/kyc/">Manage KYC documents →</Link></section>
        <section className="card" style={{ padding: 16 }}><h2 className="b small" style={{ marginTop: 0 }}>Bank (for COD remittance)</h2><dl className="kv-list"><dt>Account</dt><dd>{o.bankAccountMasked ?? "Not added"}</dd><dt>IFSC</dt><dd>{o.bankIfsc ?? "—"}</dd></dl><p className="tiny muted">Bank details come from your verified cancelled cheque in KYC.</p></section>
      </div>
      <p className="tiny muted mt12">Business and bank changes are verified by our team, so edits go through a support request.</p>
    </>
  );
}
