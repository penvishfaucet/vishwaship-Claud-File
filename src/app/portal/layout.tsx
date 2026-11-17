import { ShieldAlert } from "lucide-react";
import { PortalShell } from "@/components/portal/PortalShell";
import { exitCustomerView } from "@/server/admin/impersonate";
import { customerLogout } from "@/server/auth/actions";
import { portalContext } from "@/server/portal/context";
import { CONTENT_KEYS, t } from "@/server/content";
import { MODULES } from "@/lib/modules";
import { NAV_LABEL_DEFAULTS } from "@/components/portal/nav";
import { resolveFeatures } from "@/server/features";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await portalContext();
  const viewingAsAdmin = !!ctx.session.impersonatorId;
  const f = await resolveFeatures(ctx.org.id);
  const modules = Object.fromEntries(MODULES.map((m) => [m.key, { enabled: f.modules[m.key].enabled, lockable: m.needsPlan }]));
  const labels = Object.fromEntries(await Promise.all(Object.keys(NAV_LABEL_DEFAULTS).filter((id) => `nav.${id}` in CONTENT_KEYS).map(async (id) => [id, await t(`nav.${id}`)])));
  const support = { label: await t("portal.support.phone_label"), phone: await t("portal.support.phone"), hours: await t("portal.support.hours") };
  return (
    <PortalShell
      user={{ name: ctx.session.name, orgName: ctx.org.businessName, kycStatus: ctx.org.kycStatus }}
      walletPaise={ctx.walletAvailable}
      unreadAlerts={ctx.alerts.map((a) => ({ id: a.id, title: a.title, href: a.href, createdAt: a.createdAt.toISOString() }))}
      logout={viewingAsAdmin ? exitCustomerView : customerLogout}
      modules={modules}
      labels={labels}
      support={support}
    >
      {viewingAsAdmin && (
        <div className="impersonation-bar" role="status">
          <ShieldAlert size={18} aria-hidden />
          <span><b>Admin view:</b> you are logged in as <b>{ctx.org.businessName}</b> ({ctx.session.email ?? ctx.session.name}). Everything you do here is recorded in the audit log.</span>
          <form action={exitCustomerView}><button className="btn btn-sm btn-navy">Exit to Admin</button></form>
        </div>
      )}
      {children}
    </PortalShell>
  );
}
