import Link from "next/link";
import { Clock, ExternalLink, Mail, MapPin, Phone, Ticket } from "lucide-react";
import { TeamGrid } from "@/components/site/TeamCards";
import { mapEmbedUrl, mapOpenUrl } from "@/lib/site-content";
import { getSiteContent } from "@/server/site/content";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = pageMeta("/customer-care/", "Customer Care — Vishwaship", "Contact the Vishwaship support manager for your region, or reach our Haridwar head office by phone, WhatsApp or email.");

export default async function CustomerCare({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const sp = await searchParams;
  const c = await getSiteContent({ preview: sp.preview === "1" });
  const o = c.office;
  const tel = c.footer.phone.replace(/[^\d+]/g, "");
  return (
    <>
      <section className="pg-hero" aria-labelledby="cc-h">
        <div className="w-wrap">
          <span className="w-eyebrow">Customer care</span>
          <h1 id="cc-h">{c.care.heading}</h1>
          <p className="w-lead">{c.care.intro}</p>
          <ul className="cc-quick" aria-label="Ways to reach us" style={{ listStyle: "none", padding: 0 }}>
            {c.footer.phone && <li><a className="cc-ch" href={`tel:${tel}`}><span className="ic"><Phone size={22} aria-hidden="true" /></span><span><b>Call us</b><span>{c.footer.phone}</span></span></a></li>}
            {c.footer.email && <li><a className="cc-ch" href={`mailto:${c.footer.email}`}><span className="ic"><Mail size={22} aria-hidden="true" /></span><span><b>Email us</b><span>{c.footer.email}</span></span></a></li>}
            <li><Link className="cc-ch" href="/login/?next=%2Fportal%2Fsupport%2Fnew%2F"><span className="ic"><Ticket size={22} aria-hidden="true" /></span><span><b>Raise a ticket</b><span>For existing customers</span><span className="go">Login to raise →</span></span></Link></li>
            <li><a className="cc-ch" href="#ho-h"><span className="ic">{c.footer.hours ? <Clock size={22} aria-hidden="true" /> : <MapPin size={22} aria-hidden="true" />}</span><span><b>{c.footer.hours ? "Support hours" : "Head office"}</b><span>{c.footer.hours || o.name}</span><span className="go">Head office address ↓</span></span></a></li>
          </ul>
        </div>
      </section>

      <section className="w-sec" aria-labelledby="team-h">
        <div className="w-wrap">
          <span className="w-eyebrow">Regional support</span>
          <h2 id="team-h" className="w-h2">Contact the manager for your region</h2>
          <div style={{ marginTop: 28, display: "grid", gap: 22 }}>
            <TeamGrid members={c.team.members} />
          </div>
        </div>
      </section>

      <section className="w-sec alt" aria-labelledby="ho-h">
        <div className="w-wrap">
          <span className="w-eyebrow">Visit or write to us</span>
          <h2 id="ho-h" className="w-h2" style={{ scrollMarginTop: 96 }}>{c.care.officeHeading}</h2>
          <div className="w-office">
            <div className="w-card addr">
              <b style={{ fontSize: 18 }}><MapPin size={18} aria-hidden="true" style={{ verticalAlign: "-3px", color: "var(--o)", marginRight: 6 }} />{o.name}</b>
              <address>{o.lines.map((l, i) => <span key={i} style={{ display: "block" }}>{l}</span>)}</address>
              <div className="w-btns" style={{ marginTop: 4 }}>
                <a className="w-btn navy" href={mapOpenUrl(o)} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} aria-hidden="true" />Open in Google Maps</a>
              </div>
              <hr style={{ border: 0, borderTop: "1px solid var(--ln)", width: "100%", margin: "8px 0" }} />
              {c.footer.phone && <a href={`tel:${tel}`} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, fontWeight: 600, textDecoration: "none" }}><Phone size={18} aria-hidden="true" color="var(--o)" />{c.footer.phone}</a>}
              {c.footer.email && <a href={`mailto:${c.footer.email}`} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, fontWeight: 600, textDecoration: "none", overflowWrap: "anywhere" }}><Mail size={18} aria-hidden="true" color="var(--o)" />{c.footer.email}</a>}
              {c.footer.hours && <p style={{ margin: 0, color: "var(--mut)" }}>Support hours: {c.footer.hours}</p>}
              <Link href="/login/?next=%2Fportal%2Fsupport%2Fnew%2F" style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, fontWeight: 600, textDecoration: "none" }}><Ticket size={18} aria-hidden="true" color="var(--o)" />Existing customer? Raise a ticket</Link>
            </div>
            <div className="w-map">
              <iframe title={`Map showing ${o.name}`} src={mapEmbedUrl(o)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
