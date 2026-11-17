import Link from "next/link";
import { Mail, Phone, Ticket } from "lucide-react";
import { TrackForm } from "@/components/public/TrackForm";
import { SITE } from "@/lib/site";

export const metadata = { title: "Customer Care & Complaints — Vishwaship.com" };

export default function CustomerCare() {
  return (
    <>
      <section className="vs-sec">
        <div className="vs-wrap">
          <span className="vs-eyebrow">OFFICIAL SUPPORT CHANNELS</span>
          <h1 className="vs-h2">Reach the right Vishwaship team</h1>
          <p className="muted">Choose the channel that matches your enquiry so we can help you faster.</p>
          <div className="vs-cards mt24">
            <div className="vs-card"><span className="tile"><Ticket size={22} /></span><h3>Customers: raise a ticket</h3><p>Log in and raise an AWB-linked ticket. You’ll get updates in your dashboard.</p><Link href="/login/?next=%2Fportal%2Fsupport%2Fnew%2F">Raise a ticket</Link></div>
            <div className="vs-card hl"><span className="tile"><Mail size={22} /></span><h3>Email</h3><p>Write to us with your AWB or LR number for the quickest help.</p><a href={`mailto:${SITE.email}`}>{SITE.email}</a></div>
            <div className="vs-card"><span className="tile"><Phone size={22} /></span><h3>Phone</h3><p>{SITE.hours}</p><a href={`tel:${SITE.phone.replace(/\s/g, "")}`}>{SITE.phone}</a></div>
          </div>
        </div>
      </section>
      <div className="vs-wrap vs-track vs-track-flat">
        <div className="vs-trackcard">
          <div><h3>Where’s your shipment?</h3><p className="muted" style={{ margin: "8px 0 0", fontSize: 15 }}>Track with your AWB number, or log in to see all your shipments.</p></div>
          <TrackForm />
        </div>
      </div>
      <p className="vs-wrap tiny muted" style={{ paddingBottom: 40 }}>Public complaint form and ticket lookup without login: pending owner confirmation of categories and routing (see docs/ACCEPTANCE.md).</p>
    </>
  );
}
