import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { orgSetting, saveOrgSetting } from "@/server/couriers";
import { hasFeature } from "@/server/features";
import { apiError, parseJson } from "@/server/http";
import { ORG_SETTING_SCHEMAS, type OrgSettingKey } from "@/lib/org-settings";
import type { ModuleKey } from "@/lib/modules";

const GATE: Partial<Record<OrgSettingKey, ModuleKey>> = { edd_widget: "edd_widget", oms: "oms" };

/** Save one account setting (courier prefs, label, invoice, EDD widget, OMS). Validated, audited, tenant-scoped. */
export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { key } = await params;
  if (!(key in ORG_SETTING_SCHEMAS)) return apiError(404, "not_found", "Unknown setting");
  const k = key as OrgSettingKey;
  const gate = GATE[k];
  if (gate && !(await hasFeature(s.orgId, gate))) return apiError(403, "forbidden", "This feature is not enabled for your account");
  const p = await parseJson(req, ORG_SETTING_SCHEMAS[k]);
  if (!p.ok) return p.res;
  await saveOrgSetting(s.orgId, k, p.data, s.userId);
  if (k === "oms" && !(await orgSetting(s.orgId, "oms_status"))) await saveOrgSetting(s.orgId, "oms_status", { status: "requested" });
  if (k === "courier_prefs") await saveOrgSetting(s.orgId, "price_list_cache", { generatedAt: new Date(0).toISOString() }); // rates change with courier choice
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "settings.update", targetType: "setting", targetId: k, details: k === "invoice_settings" ? { fields: Object.keys(p.data) } : p.data });
  return NextResponse.json({ ok: true });
}
