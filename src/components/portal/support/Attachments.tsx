import { FileText } from "lucide-react";
import type { TicketAttachment } from "@/lib/support";

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Attachments of one message, served only through the access-checked file route. */
export function Attachments({ base, msgId, files }: { base: string; msgId: string; files: TicketAttachment[] }) {
  return (
    <span className="tk-atts">
      {files.map((f, i) => {
        const href = `${base}?m=${encodeURIComponent(msgId)}&i=${i}`;
        if (f.kind === "image") return <a key={i} href={href} target="_blank" rel="noopener" className="tk-att-img"><img src={href} alt={f.name} loading="lazy" /></a>;
        if (f.kind === "audio") return <audio key={i} controls preload="none" src={href} aria-label={f.name} />;
        if (f.kind === "video") return <video key={i} controls preload="metadata" src={href} aria-label={f.name} />;
        return <a key={i} href={href} target="_blank" rel="noopener" className="tk-att-doc"><FileText size={16} aria-hidden /> {f.name} <span className="tiny muted">({size(f.size)})</span></a>;
      })}
    </span>
  );
}
