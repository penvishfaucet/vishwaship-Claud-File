import Link from "next/link";
import { OwnProviders } from "@/components/portal/OwnProviders";
import { COD_TEMPLATE, numbered } from "@/lib/cod-template";
import { OWN_FIELDS, ownOverview } from "@/server/own-providers";
import { portalContext } from "@/server/portal/context";

/** Client: connect your own WhatsApp (WATI / AiSensy) and AI calling (Bolna) — free of Vishwaship charges. */
export default async function OwnApisPage() {
  const ctx = await portalContext();
  const o = await ownOverview(ctx.org.id);
  const n = numbered(COD_TEMPLATE.en);
  const fields = Object.fromEntries(Object.entries(OWN_FIELDS).map(([k, v]) => [k, v.map((f) => ({ ...f }))])) as Record<"wati" | "aisensy" | "bolna", Array<{ key: string; label: string; secret: boolean; placeholder: string }>>;
  return (
    <>
      <div className="page-h"><div><Link className="small link-navy" href="/portal/notifications/cod/">← COD Confirmation</Link><h1>Your own WhatsApp &amp; AI calling</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Already have WATI, AiSensy or Bolna? Connect them here. Messages go from your own number and calls run on your own account — Vishwaship charges nothing for them. Switch off any time to use Vishwaship’s service (paid per message / call).</p></div></div>
      <OwnProviders fields={fields} whatsapp={o.whatsapp} calling={o.calling}
        codTemplateText={{ named: COD_TEMPLATE.en, numbered: n.text, order: n.order.map((v, i) => `{{${i + 1}}} ${v}`).join(" · ") }} />
    </>
  );
}
