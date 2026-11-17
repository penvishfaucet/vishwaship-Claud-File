import { and, eq } from "drizzle-orm";
import { LabelSettings } from "@/components/portal/LabelSettings";
import { ORG_SETTING_SCHEMAS } from "@/lib/org-settings";
import { orgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { getAdapter, providerContext } from "@/server/providers/registry";

export default async function LabelSettingPage() {
  const ctx = await portalContext();
  const saved = await orgSetting<Record<string, unknown>>(ctx.org.id, "label_settings");
  const v = ORG_SETTING_SCHEMAS.label_settings.parse(saved ?? {});
  // which formats each connected courier account can print
  const db = await getDb();
  const accts = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.category, "shipping"), eq(schema.providerAccounts.status, "enabled")));
  const carrierFormats: Record<string, string[]> = {};
  for (const a of accts) {
    const ad = getAdapter(a.adapter);
    // only the fixture adapter is asked up front; live couriers report their formats when a label is downloaded
    if (!ad?.implemented.includes("label") || a.adapter !== "demo") continue;
    const r = await ad.label(await providerContext(a), { providerOrderRef: "__formats__", awb: "__formats__" }, "thermal_4x6").catch(() => null);
    if (r && r.ok) carrierFormats[a.label] = r.value.formatsAvailable;
  }
  return (
    <>
      <div className="page-h"><div><h1>Label Setting</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Choose your default label size and what it shows. Every label download uses this unless you pick another size.</p></div></div>
      <LabelSettings initial={v as never} carrierFormats={carrierFormats} />
    </>
  );
}
