import { AdminShell } from "@/components/admin/AdminShell";
import { after } from "next/server";
import { kickJobsIfIdle } from "@/server/jobs/kick";
import { staffLogout } from "@/server/auth/actions";
import { ROLE_PERMISSIONS } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { markStaffAlertsSeen, staffBell } from "@/server/admin/alerts";
import { weightCounts } from "@/server/weight/courier-dispute";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Vishwaship" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // keep tracking / emails moving even if the host paused the background loop (runs after the page is sent)
  after(() => kickJobsIfIdle());
  const s = await requireStaff();
  const bell = await staffBell().catch(() => ({ items: [], unseen: 0, pendingRecharges: 0 }));
  const wc = await weightCounts().catch(() => ({ open: 0, disputed: 0 }));
  const navBadges = { "/admin/disputes/": wc.disputed ? { n: wc.disputed, tone: "red" as const, title: `${wc.disputed} client dispute(s) to review` } : { n: wc.open, tone: "green" as const, title: `${wc.open} open weight discrepancies` } };
  return (
    <AdminShell user={{ name: s.name, role: s.role }} allowed={ROLE_PERMISSIONS[s.role]} logout={staffLogout} bell={bell} markSeen={markStaffAlertsSeen} navBadges={navBadges}>
      {children}
    </AdminShell>
  );
}
