import { PortalShell } from "@/components/portal/PortalShell";
import { customerLogout } from "@/server/auth/actions";
import { portalContext } from "@/server/portal/context";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await portalContext();
  return (
    <PortalShell
      user={{ name: ctx.session.name, orgName: ctx.org.businessName, kycStatus: ctx.org.kycStatus }}
      walletPaise={ctx.walletAvailable}
      unreadAlerts={ctx.alerts.map((a) => ({ id: a.id, title: a.title, href: a.href, createdAt: a.createdAt.toISOString() }))}
      logout={customerLogout}
    >
      {children}
    </PortalShell>
  );
}
