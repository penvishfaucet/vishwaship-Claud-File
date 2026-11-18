import { AdminShell } from "@/components/admin/AdminShell";
import { staffLogout } from "@/server/auth/actions";
import { ROLE_PERMISSIONS } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { markStaffAlertsSeen, staffBell } from "@/server/admin/alerts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Vishwaship" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  const bell = await staffBell().catch(() => ({ items: [], unseen: 0, pendingRecharges: 0 }));
  return (
    <AdminShell user={{ name: s.name, role: s.role }} allowed={ROLE_PERMISSIONS[s.role]} logout={staffLogout} bell={bell} markSeen={markStaffAlertsSeen}>
      {children}
    </AdminShell>
  );
}
