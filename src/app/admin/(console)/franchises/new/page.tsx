import { requireStaff } from "@/server/auth/session";
import { FranchiseForm } from "../forms";

export default async function NewFranchise() {
  await requireStaff("customers.write");
  const today = new Date();
  const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const end = new Date(today); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/admin/franchises/">Franchises</a></p><h1>New franchise</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>The franchise starts as Draft. After saving, give it an area, record the deposit, KYC and signed agreement, then activate it.</p></div></div>
      <div style={{ maxWidth: 820 }}>
        <FranchiseForm init={{ businessName: "", ownerName: "", mobile: "", email: "", gstin: "", pan: "", line1: "", line2: "", city: "", state: "", pincode: "",
          depositRupees: "50000", monthlyTarget: "300", termStart: ist(today), termEnd: ist(end), notes: "" }} defaultDepositHint="Suggested starting values: ₹50,000 deposit, 300 shipments a month, 12-month term. Change them per franchise." />
      </div>
    </>
  );
}
