import { LabelSettings } from "@/components/portal/LabelSettings";
import { ORG_SETTING_SCHEMAS } from "@/lib/org-settings";
import { orgSetting } from "@/server/couriers";
import { portalContext } from "@/server/portal/context";

export default async function LabelSettingPage() {
  const ctx = await portalContext();
  const saved = await orgSetting<Record<string, unknown>>(ctx.org.id, "label_settings");
  const v = ORG_SETTING_SCHEMAS.label_settings.parse(saved ?? {});
  return (
    <>
      <div className="page-h"><div><h1>Label Setting</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Choose your default label format. Every Download Label uses it unless you pick another format.</p></div></div>
      <LabelSettings initial={v as never} />
    </>
  );
}
