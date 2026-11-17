import Link from "next/link";
import { ExternalLink, Mail, MapPin, Phone, Ticket } from "lucide-react";
import { TeamGrid } from "@/components/site/TeamCards";
import { mapEmbedUrl, mapOpenUrl } from "@/lib/site-content";
import { getSiteContent } from "@/server/site/content";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Customer Care — Vishwaship",
  description: "Contact the Vishwaship support manager for your region, or reach our Haridwar head office.",
};

export default async function CustomerCare({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const sp = await searchParams;
  const c = await getSiteContent({ preview: sp.preview === "1" });
  const o = c.office;
  const tel = c.footer.phone.replace(/[^\d+]/g, "");
  return (
    <>
      <section className="w-sec" style={{ paddingTop: 56 }} aria-labelledby="cc-h">
        <div className="w-wrap">
          <span className="w-eyebrow">Customer care</span>
          <h1 id="cc-h" className="w-h2" style={{ fontSize: "clamp(30px,4vw,48px)" }}>{c.care.heading}</h1>
          <p className="w-lead">{c.care.intro}</p>
          <div style={{ marginTop: 32, display: "grid", gap: 22 }}>
            <TeamGrid members={c.team.members} />
          </div>
        </div>
      </section>

      <section className="w-sec alt" aria-labelledby="ho-h">
        <div className="w-wrap">
          <span className="w-eyebrow">Visit or write to us</span>
          <h2 id="ho-h" className="w-h2">{c.care.officeHeading}</h2>
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
