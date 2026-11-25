import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { audit } from "@/server/audit";
import { readSession } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delete your account — Vishwaship", description: "Ask Vishwaship to delete your account and personal data. Records the law requires us to keep (invoices, tax) are retained until that period ends." };

/**
 * Public account-deletion page (the link entered in Google Play Console). Signed-in customers can submit the
 * request here; anyone else is told how to sign in or contact support. The same request can be made in the app
 * (More → Profile → Delete account). One account serves the website and the app, so deletion applies to both.
 */
export default async function AccountDeletionPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const sp = await searchParams;
  const s = await readSession("customer");
  const db = await getDb();
  const [open] = s ? await db.select().from(schema.accountDeletionRequests).where(and(eq(schema.accountDeletionRequests.userId, s.userId), eq(schema.accountDeletionRequests.status, "requested"))) : [];

  async function request(fd: FormData) {
    "use server";
    const me = await readSession("customer");
    if (!me?.orgId || me.impersonatorId) return;
    const d = await getDb();
    const [existing] = await d.select().from(schema.accountDeletionRequests).where(and(eq(schema.accountDeletionRequests.userId, me.userId), eq(schema.accountDeletionRequests.status, "requested")));
    if (!existing) {
      await d.insert(schema.accountDeletionRequests).values({ id: newId("adr"), userId: me.userId, orgId: me.orgId, email: me.email ?? "", reason: String(fd.get("reason") ?? "").slice(0, 500) || null, source: "web" });
      await d.insert(schema.staffAlerts).values({ id: newId("sa"), kind: "account_deletion", title: "Account deletion requested", href: `/admin/customers/${me.orgId}/`, perm: "customers.write" });
      await audit({ actorUserId: me.userId, actorKind: "customer", orgId: me.orgId, action: "account.deletion_requested", details: { channel: "web" } });
    }
    revalidatePath("/account-deletion/");
  }

  return (
    <section className="vs-sec">
      <div className="vs-wrap vs-legal" style={{ maxWidth: 820 }}>
        <span className="vs-eyebrow">ACCOUNT</span>
        <h1 className="vs-h2">Delete your Vishwaship account</h1>
        <p className="mt16">Your Vishwaship account is the same on the website and the Android app. Deleting it closes it on both.</p>
        <h3 className="mt16">How to request deletion</h3>
        <ol style={{ lineHeight: 1.8 }}>
          <li>In the Android app: <b>More → Profile → Delete account</b>.</li>
          <li>On the website: sign in and use the button below.</li>
          <li>Or email <a className="link" href={`mailto:${SITE.email}`}>{SITE.email}</a> from your registered email address.</li>
        </ol>
        <h3 className="mt16">What happens next</h3>
        <ul style={{ lineHeight: 1.8 }}>
          <li>We confirm the request within 2 working days. Shipments in transit, open COD remittances, pending refunds and any wallet balance are settled first.</li>
          <li>We then close the account, sign out every device and stop all notifications. Your profile, pickup addresses, saved buyers, KYC files and store connections are deleted.</li>
          <li>We keep invoices, credit and debit notes, the wallet ledger and shipment records for as long as tax and accounting law requires (generally 8 years), then delete them.</li>
        </ul>
        <div className="card mt16" style={{ padding: 16 }}>
          {!s?.orgId ? (
            <p style={{ margin: 0 }}><a className="btn btn-primary" href="/login/?next=/account-deletion/">Sign in to request deletion</a></p>
          ) : open || sp.sent ? (
            <p style={{ margin: 0 }}><b>Request received.</b> Reference {open?.id ?? ""}. We will email {s.email} when it is processed.</p>
          ) : (
            <form action={request}>
              <label className="small" htmlFor="reason">Reason (optional)</label>
              <textarea id="reason" name="reason" className="input" rows={3} maxLength={500} style={{ width: "100%" }} />
              <button className="btn btn-primary mt16" type="submit">Request account deletion</button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
