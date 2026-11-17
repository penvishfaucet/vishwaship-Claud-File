import { ShieldAlert } from "lucide-react";
import { PortalShell } from "@/components/portal/PortalShell";
import { exitCustomerView } from "@/server/admin/impersonate";
import { customerLogout } from "@/server/auth/actions";
import { portalContext } from "@/server/portal/context";
import { t } from "@/server/content";
import { resolveFeatures } from "@/server/features";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await portalContext();
  const viewingAsAdmin = !!ctx.session.impersonatorId;
  const f = await resolveFeatures(ctx.org.id);
  const modules = Object.entries(f.modules).filter(([, v]) => v.enabled).map(([k]) => k);
  return (
    <PortalShell
      user={{ name: ctx.session.name, orgName: ctx.org.businessName, kycStatus: ctx.org.kycStatus }}
      walletPaise={ctx.walletAvailable}
      unreadAlerts={ctx.alerts.map((a) => ({ id: a.id, title: a.title, href: a.href, createdAt: a.createdAt.toISOString() }))}
      logout={viewingAsAdmin ? exitCustomerView : customerLogout}
      modules={modules}
      supportLabel={await t("portal.support.phone_label")}
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
