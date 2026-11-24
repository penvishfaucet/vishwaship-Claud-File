import Link from "next/link";
import { CodBankForm } from "@/components/portal/CodBankForm";
import { payoutAccount } from "@/server/cod/payouts";
import { portalContext } from "@/server/portal/context";

export default async function CodBankPage() {
  const ctx = await portalContext();
  const a = await payoutAccount(ctx.org.id);
  return (
    <>
      <div className="page-h">
        <div><h1>COD Bank Account</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Your COD is paid to this account the same or next working day after the courier pays it to Vishwaship. <Link className="link-navy" href="/portal/billing/cod-remittance/">See COD payouts</Link></p></div>
        <div className="actions"><span className={`chip ${a ? "c-active" : "c-pending"}`}>{a ? "Account added" : "Not added"}</span></div>
      </div>
      {a && (
        <section className="card mb16" style={{ padding: 16 }}>
          <dl className="kv-list">
            <dt>Account holder</dt><dd>{a.holderName}</dd>
            <dt>Account</dt><dd className="mono">••••{a.last4}</dd>
            <dt>IFSC</dt><dd className="mono">{a.ifsc}</dd>
            {a.bankName && <><dt>Bank</dt><dd>{a.bankName}</dd></>}
          </dl>
        </section>
      )}
      <section className="card" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>{a ? "Change account" : "Add account"}</h2>
        <CodBankForm hasAccount={!!a} />
        <p className="tiny muted mt8">The account number is stored encrypted; only its last 4 digits are shown. Every change is recorded and you get an alert.</p>
      </section>
    </>
  );
}
