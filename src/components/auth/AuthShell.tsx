import { BrandLogo } from "@/components/BrandLogo";
import Link from "next/link";
import { CheckCircle2, Search } from "lucide-react";

/** Split auth layout matching vishwaship.com/login: brand/benefit panel left, form right. */
export function AuthShell({ children, variant = "customer" }: { children: React.ReactNode; variant?: "customer" | "staff" }) {
  const points = variant === "customer"
    ? ["Final rate before you book", "AWB & label instantly", "Live status: in transit, delivered, RTO", "Weight discrepancy details with proof"]
    : ["All customer shipments in one place", "Pricing, wallets and COD reconciliation", "KYC review and support queues", "Role-based access with audit trail"];
  return (
    <div className="vs">
      <div className="auth">
        <div className="l">
          <Link href="/">
            <BrandLogo height={56} plate />
          </Link>
          <h2>{variant === "customer" ? <>Your shipping,<span>one dashboard.</span></> : <>Vishwaship<span>admin workspace.</span></>}</h2>
          <ul>{points.map((p) => <li key={p}><CheckCircle2 size={18} />{p}</li>)}</ul>
          <div className="ring" />
          <div className="awbcard"><Search size={20} /><div><b>Track any shipment</b><div className="small" style={{ color: "#c4cbe0" }}>Live status from our courier partners</div></div></div>
        </div>
        <div className="r">
          <div className="form">
            <Link className="show-sm mb16" style={{ display: "block" }} href="/"><BrandLogo height={52} /></Link>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
