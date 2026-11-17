import { EddWidgetSettings } from "@/components/portal/EddWidgetSettings";
import { ORG_SETTING_SCHEMAS } from "@/lib/org-settings";
import { t } from "@/server/content";
import { orgSetting } from "@/server/couriers";
import { eddWidgetKey } from "@/server/edd";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";

export default async function EddWidgetPage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "edd_widget");
  const cfg = ORG_SETTING_SCHEMAS.edd_widget.parse((await orgSetting(ctx.org.id, "edd_widget")) ?? {});
  const key = await eddWidgetKey(ctx.org.id);
  const host = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <>
      <div className="page-h"><div><h1>EDD Widget</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{await t("portal.edd.help")} Estimates use your default warehouse, processing time and the fastest serviceable courier.</p></div></div>
      <EddWidgetSettings initial={cfg} widgetKey={key} host={host} />
    </>
  );
}
