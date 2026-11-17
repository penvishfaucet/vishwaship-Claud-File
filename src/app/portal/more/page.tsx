import Link from "next/link";
import { ChevronRight, LogOut, Settings, ShieldCheck, User } from "lucide-react";
import { CUSTOMER_NAV } from "@/components/portal/nav";
import { customerLogout } from "@/server/auth/actions";

export default function MorePage() {
  const extra = CUSTOMER_NAV.filter((n) => !["/portal/", "/portal/orders/", "/portal/ndr/"].includes(n.href));
  return (
    <>
      <h1 style={{ fontSize: 22 }}>More</h1>
      <div className="more-grp">Shipping &amp; billing</div>
      <div className="more-card">
        {extra.map((n) => <Link key={n.href} className="more-row" href={n.href}><span className="ic"><n.icon size={18} /></span>{n.label}<ChevronRight size={16} style={{ marginLeft: "auto" }} /></Link>)}
      </div>
      <div className="more-grp">Account</div>
      <div className="more-card">
        <Link className="more-row" href="/portal/profile/"><span className="ic"><User size={18} /></span>Profile &amp; business</Link>
        <Link className="more-row" href="/portal/kyc/"><span className="ic"><ShieldCheck size={18} /></span>KYC</Link>
        <Link className="more-row" href="/portal/settings/"><span className="ic"><Settings size={18} /></span>Settings</Link>
        <form action={customerLogout}><button className="more-row"><span className="ic"><LogOut size={18} /></span>Log out</button></form>
      </div>
    </>
  );
}
