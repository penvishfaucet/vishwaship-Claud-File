import { InvoiceSettings } from "@/components/portal/InvoiceSettings";
import { ORG_SETTING_SCHEMAS } from "@/lib/org-settings";
import { orgSetting } from "@/server/couriers";
import { portalContext } from "@/server/portal/context";

export default async function InvoiceSettingsPage() {
  const ctx = await portalContext();
  const saved = await orgSetting<Record<string, unknown>>(ctx.org.id, "invoice_settings");
  const v = ORG_SETTING_SCHEMAS.invoice_settings.safeParse(saved ?? { businessName: ctx.org.businessName, gstin: ctx.org.gstin ?? "" });
  const initial = v.success ? v.data : ORG_SETTING_SCHEMAS.invoice_settings.parse({ businessName: ctx.org.businessName });
  return (
    <>
      <div className="page-h"><div><h1>Invoice settings</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Business details, logo, tax information and footer printed on the sales invoices you send with your shipments.</p></div></div>
      <InvoiceSettings initial={initial as never} />
    </>
  );
}
