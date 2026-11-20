import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { StoreShell } from "@/components/store/Storefront";
import { type SfParams, type SfSearch, resolveSf, sfMeta } from "../_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  return sfMeta(await resolveSf(params, searchParams), "/contact/", "Contact us");
}

const ic = { verticalAlign: "-3px", marginRight: 8 } as const;

export default async function Contact({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const c = sf.settings.contact;
  const wa = c.whatsapp.replace(/\D/g, "");
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <h1>Contact us</h1>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14, fontSize: 16 }}>
          {c.email && <li><Mail size={18} style={ic} aria-hidden /><a href={`mailto:${c.email}`}>{c.email}</a></li>}
          {c.phone && <li><Phone size={18} style={ic} aria-hidden /><a href={`tel:${c.phone}`}>{c.phone}</a></li>}
          {wa && <li><MessageCircle size={18} style={ic} aria-hidden /><a href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`} rel="noopener noreferrer" target="_blank">WhatsApp us</a></li>}
          {c.address && <li style={{ whiteSpace: "pre-line" }}><MapPin size={18} style={ic} aria-hidden />{c.address}</li>}
          {!c.email && !c.phone && !wa && !c.address && <li className="sf-note">Contact details will be added soon.</li>}
        </ul>
      </div>
    </StoreShell>
  );
}
