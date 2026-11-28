import { ShieldAlert } from "lucide-react";
import { after } from "next/server";
import { kickJobsIfIdle } from "@/server/jobs/kick";
import { PortalShell } from "@/components/portal/PortalShell";
import { exitCustomerView } from "@/server/admin/impersonate";
import { customerLogout } from "@/server/auth/actions";
import { portalContext } from "@/server/portal/context";
import { CONTENT_KEYS, t } from "@/server/content";
import { MODULES } from "@/lib/modules";
import { NAV_LABEL_DEFAULTS } from "@/components/portal/nav";
import { resolveFeatures } from "@/server/features";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { KycReminder } from "@/components/portal/KycReminder";
import { KycRunBar } from "@/components/portal/KycRunBar";
import { onboardingState } from "@/server/onboarding";
import { sha256 } from "@/server/security/crypto";
import { weightCounts } from "@/server/weight/courier-dispute";
import { pendingAcceptanceCount } from "@/server/store/ops";
import { lowStockCount } from "@/server/store/inventory";
import { readAvatar } from "@/server/portal/avatar";
import { storeForOrg } from "@/server/store/service";
import { GrowthRunBar } from "@/components/site/Growth";
import { redirect } from "next/navigation";
import { needsSignupDetails } from "@/server/auth/signup-details";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // keep tracking / emails moving even if the host paused the background loop (runs after the page is sent)
  after(() => kickJobsIfIdle());
  const ctx = await portalContext();
  const viewingAsAdmin = !!ctx.session.impersonatorId;
  const db = await getDb();
  // Sign-up details (mobile, business, parcels per day) are required once — Google / mobile-OTP sign-ups give them on /welcome/.
  if (!viewingAsAdmin) {
    const [me] = await db.select({ mobile: schema.users.mobile }).from(schema.users).where(eq(schema.users.id, ctx.session.userId));
    if (me && needsSignupDetails(me, ctx.org)) redirect("/welcome/");
  }
  const f = await resolveFeatures(ctx.org.id);
  const modules = Object.fromEntries(MODULES.map((m) => [m.key, { enabled: f.modules[m.key].enabled, lockable: m.needsPlan }]));
  const labels = Object.fromEntries(await Promise.all(Object.keys(NAV_LABEL_DEFAULTS).filter((id) => `nav.${id}` in CONTENT_KEYS).map(async (id) => [id, await t(`nav.${id}`)])));
  const tk = await db.select({ id: schema.tickets.id, number: schema.tickets.number, subject: schema.tickets.subject, status: schema.tickets.status, createdAt: schema.tickets.createdAt,
    last: sql<string | null>`(select max(${schema.ticketMessages.createdAt}) from ${schema.ticketMessages} where ${schema.ticketMessages.ticketId} = ${schema.tickets.id})` })
    .from(schema.tickets).where(eq(schema.tickets.orgId, ctx.org.id)).orderBy(desc(schema.tickets.createdAt)).limit(30);
  const tickets = { open: tk.filter((x) => !["resolved", "closed"].includes(x.status)).length, recent: tk.slice(0, 5).map((x) => ({ id: x.id, number: x.number, subject: x.subject, status: x.status, updatedAt: new Date(x.last ?? x.createdAt).toISOString() })) };
  const ob = await onboardingState(ctx.org.id);
  const kycPending = ob.step !== "active";
  // reminder in the bell until KYC is approved (not stored: disappears by itself once approved)
  const kycAlert = kycPending ? [{ id: "kyc-reminder", title: ob.step === "review" ? "KYC under review — you can book shipments once it is approved" : "Complete KYC to ship your first parcel", href: ob.step === "profile" ? "/portal/onboarding/" : "/portal/kyc/", createdAt: new Date().toISOString() }] : [];
  const wc = await weightCounts(ctx.org.id).catch(() => ({ open: 0, disputed: 0 }));
  const storePending = f.modules.online_store.enabled ? await pendingAcceptanceCount(ctx.org.id).catch(() => 0) : 0;
  const storeLow = f.modules.online_store.enabled ? await lowStockCount(ctx.org.id) : 0;
  const toPrint = f.modules.online_store.enabled ? await (async () => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeOrders).where(sql`${schema.storeOrders.orgId} = ${ctx.org.id} and ${schema.storeOrders.status} = 'placed' and ${schema.storeOrders.acceptance} = 'accepted' and ${schema.storeOrders.stockState} <> 'deducted'
      and not exists (select 1 from shipments s where s.order_id = ${schema.storeOrders.shippingOrderId} and s.booking_status not in ('cancelled', 'failed') and s.status not in ('booked', 'pickup_pending', 'cancelled'))
      and (${schema.storeOrders.labelPrintedAt} is null or not exists (select 1 from shipments s where s.order_id = ${schema.storeOrders.shippingOrderId} and s.booking_status not in ('cancelled', 'failed') and s.status <> 'cancelled'))`);
    return n;
  })().catch(() => 0) : 0;
  const navBadges = { "store.dispatch": { n: toPrint, tone: "red" as const, title: `${toPrint} store order(s) waiting for a label` }, "store.inventory": { n: storeLow, tone: "red" as const, title: `${storeLow} store item(s) running low on stock` }, "store.orders": { n: storePending, tone: "red" as const, title: `${storePending} store order(s) waiting for you to accept` }, "tools.weight": wc.open ? { n: wc.open, tone: "red" as const, title: `${wc.open} weight discrepancy(ies) — check and dispute if wrong` } : { n: wc.disputed, tone: "green" as const, title: `${wc.disputed} dispute(s) under review` } };
  // shipping-only accounts (no online store yet): a running bar promoting the Growth Package
  const shippingOnly = !(await storeForOrg(ctx.org.id).catch(() => null));
  const support = { label: await t("portal.support.phone_label"), phone: await t("portal.support.phone"), hours: await t("portal.support.hours") };
  return (
    <PortalShell
      user={{ name: ctx.session.name, orgName: ctx.org.businessName, kycStatus: ctx.org.kycStatus, email: ctx.session.email, avatar: await readAvatar(ctx.session.userId), profileStep: ob.step }}
      walletPaise={ctx.walletAvailable}
      credits={ctx.credits}
      tickets={tickets}
      unreadAlerts={[...kycAlert, ...ctx.alerts.map((a) => ({ id: a.id, title: a.title, href: a.href, createdAt: a.createdAt.toISOString() }))]}
      logout={viewingAsAdmin ? exitCustomerView : customerLogout}
      modules={modules}
      labels={labels}
      support={support}
      navBadges={navBadges}
    >
      {viewingAsAdmin && (
        <div className="impersonation-bar" role="status">
          <ShieldAlert size={18} aria-hidden />
          <span><b>Admin view:</b> you are logged in as <b>{ctx.org.businessName}</b> ({ctx.session.email ?? ctx.session.name}). Everything you do here is recorded in the audit log.</span>
          <form action={exitCustomerView}><button className="btn btn-sm btn-navy">Exit to Admin</button></form>
        </div>
      )}
      {kycPending && !viewingAsAdmin && <KycReminder step={ob.step as "profile" | "kyc" | "review" | "resubmit"} sessionKey={sha256(ctx.session.sessionId).slice(0, 16)} />}
      {kycPending && !viewingAsAdmin && <KycRunBar step={ob.step as "profile" | "kyc" | "review" | "resubmit"} />}
      {shippingOnly && !viewingAsAdmin && <GrowthRunBar portal href={f.modules.online_store.enabled ? "/portal/store/" : "/online-store/"} />}
      {children}
    </PortalShell>
  );
}
