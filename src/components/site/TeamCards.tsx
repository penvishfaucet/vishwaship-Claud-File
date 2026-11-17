import { Phone } from "lucide-react";
import { completeMobile, type TeamMember } from "@/lib/site-content";

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function WhatsAppIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.8 14.06c-.24.68-1.42 1.3-1.95 1.35-.5.05-.97.23-3.27-.68-2.77-1.09-4.52-3.92-4.66-4.1-.13-.18-1.11-1.48-1.11-2.82s.7-2 .95-2.27c.25-.27.54-.34.72-.34h.52c.17 0 .39-.06.61.47.24.55.79 1.9.86 2.04.07.14.11.3.02.48-.09.18-.14.3-.27.46-.14.16-.29.36-.41.48-.14.14-.28.29-.12.56.16.27.71 1.17 1.52 1.9 1.05.93 1.93 1.22 2.2 1.36.27.14.43.11.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.23.61-.14.25.09 1.59.75 1.86.89.27.14.45.2.52.32.07.11.07.66-.17 1.33z" /></svg>;
}

/** Contact actions appear only for a complete 10-digit number; otherwise the card says contact details are pending. */
export function PersonCard({ m, lead = false }: { m: TeamMember; lead?: boolean }) {
  const phone = completeMobile(m.phone);
  const wa = completeMobile(m.whatsapp || "");
  return (
    <article className={`w-card w-person${lead ? " w-lead-card" : ""}`}>
      <div className="ph">{m.photoUrl ? <img src={m.photoUrl} alt={`Photo of ${m.name}`} loading="lazy" /> : <span aria-hidden="true">{initials(m.name)}</span>}</div>
      <div>
        <span className="rg">{m.region}</span>
        <h3 className="nm" style={{ marginTop: 10 }}>{m.name}</h3>
        <p className="rl">{m.role}</p>
        {lead && <p className="rl" style={{ marginTop: 8 }}>Works from the Haridwar head office and coordinates support across India.</p>}
      </div>
      <div className="ct">
        {phone && <a className={`w-btn ${lead ? "pri" : "navy"} sm`} href={`tel:+91${phone}`} aria-label={`Call ${m.name} on +91 ${phone}`}><Phone size={17} aria-hidden="true" />Call +91 {phone.slice(0, 5)} {phone.slice(5)}</a>}
        {wa && <a className="w-btn w-wa sm" href={`https://wa.me/91${wa}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${m.name}`}><WhatsAppIcon />WhatsApp</a>}
        {!phone && <p className="pend">Direct contact number coming soon. Please contact our head office or another regional manager meanwhile.</p>}
      </div>
    </article>
  );
}

export function TeamGrid({ members }: { members: TeamMember[] }) {
  const shown = members.filter((m) => m.visible && m.name.trim());
  const lead = shown.filter((m) => m.featured);
  const rest = shown.filter((m) => !m.featured);
  return (
    <>
      {lead.map((m) => <PersonCard key={m.id} m={m} lead />)}
      {rest.length > 0 && <div className="w-team">{rest.map((m) => <PersonCard key={m.id} m={m} />)}</div>}
    </>
  );
}
