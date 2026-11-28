import Link from "next/link";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { type CrmWaMedia, MEDIA_SETTING, approvedTemplates, crmWaConfig } from "@/server/crm/whatsapp";
import { getSetting } from "@/server/quotes/service";

/** CRM Leads → WhatsApp settings (owner / CRM manager): connection status and the photo / video sent with each template. */
export async function CrmWaSettings() {
  const cfg = await crmWaConfig();
  if (!cfg) {
    return (
      <p className="card small mb12" style={{ padding: "10px 14px" }}>
        💬 <b>WhatsApp from 99974 04427 in the CRM:</b> not connected yet. Connect <Link className="link" href="/admin/services/">WhatsApp for CRM Leads</Link> in API Keys &amp; Services — then the intro (with photo / video) goes in one click and every reply shows on the lead. Until then the WhatsApp button opens the chat in your own WhatsApp.
      </p>
    );
  }
  const tl = await approvedTemplates(cfg).catch((e: Error) => ({ ok: false as const, message: e.message }));
  const media = (await getSetting<CrmWaMedia>(MEDIA_SETTING, {})).value;
  return (
    <details className="card crm-add mb12">
      <summary className="b">💬 WhatsApp settings — templates &amp; photo / video</summary>
      {!tl.ok ? <p className="small err">{tl.message}</p> : tl.templates.length === 0 ? (
        <p className="small muted">No approved template yet. Create one in <a className="link" href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noopener noreferrer">WhatsApp Manager → Message templates</a> (Marketing · header Image or Video · body with {"{{1}}"} for the name). It appears here once Meta approves it.</p>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <p className="tiny muted" style={{ margin: 0 }}>Templates with a photo / video header need a public link (https://… .jpg / .png / .mp4, video up to 16 MB). The same link is used for every lead unless staff paste another one.</p>
          {tl.templates.map((t) => (
            <div key={t.name} className="col" style={{ gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div className="small"><b>{t.name}</b> <span className="muted">· {t.language} · {t.category.toLowerCase()} · header {t.header.toLowerCase()}</span></div>
              <div className="tiny muted" style={{ whiteSpace: "pre-wrap" }}>{t.body}</div>
              {["IMAGE", "VIDEO", "DOCUMENT"].includes(t.header) && (
                <AdminOpForm endpoint="/api/admin/crm" op="wa_media" extra={{ template: t.name }} submit="Save link" fields={[
                  { name: "url", label: `${t.header === "VIDEO" ? "Video" : t.header === "IMAGE" ? "Photo" : "Document"} link`, value: media[t.name]?.url ?? "", wide: true, placeholder: "https://vishwaship.in/wa/intro.png" },
                ]} />
              )}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
