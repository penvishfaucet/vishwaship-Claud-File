import Link from "next/link";
import { Package, Truck } from "lucide-react";
import { ArrowRight } from "@/components/icons";

export const metadata = { title: "Book a Shipment — Vishwaship.com" };

export default function BookPage() {
  return (
    <section className="vs-sec">
      <div className="vs-wrap" style={{ maxWidth: 960 }}>
        <span className="vs-eyebrow">BOOK A SHIPMENT</span>
        <h1 className="vs-h2">Ship in three steps.</h1>
        <p className="muted" style={{ fontSize: 16 }}>Create a free account, add your pickup address and recharge your wallet. Then book any parcel or cargo shipment and get your AWB instantly.</p>
        <div className="vs-cards mt24">
          <div className="vs-card"><span className="tile"><Package size={22} /></span><h3>Parcels under 10 kg</h3><p>Doorstep pickup with B2C courier partners. Prepaid or COD.</p><Link href="/login/?next=%2Fportal%2Forders%2Fnew%2F">Book a parcel <ArrowRight /></Link></div>
          <div className="vs-card hl"><span className="tile"><Truck size={22} /></span><h3>Cargo 10 kg and above</h3><p>Multi-box B2B surface cargo with LR, e-way bill support and pickup scheduling.</p><Link href="/login/?next=%2Fportal%2Forders%2Fnew%2F%3Fmode%3DB2B">Book cargo <ArrowRight /></Link></div>
        </div>
        <p className="mt24">New to Vishwaship? <Link className="link" href="/signup/">Create an account</Link> · Check prices first with the <Link className="link" href="/shipping-rate-calculator/">rate calculator</Link>.</p>
      </div>
    </section>
  );
}
