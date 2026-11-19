import { EmailSettings } from "@/components/admin/EmailSettings";
import { EMAIL_EVENTS, eventDef } from "@/lib/email-events";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { googleAvailable, googleRedirectUri } from "@/server/auth/google";
import { resendKey } from "@/server/email/transport";
import { allRules, emailLogs, getAuthSettings, senderUsage, senders, template } from "@/server/email/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email & Sign-in — Vishwaship Admin" };
const fmt = (d: Date | null) => d?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }) ?? "";

/** Admin → Settings → Signup, Email & Notification settings. */
export default async function EmailSettingsPage() {
  const s = await requireStaff("notifications.read");
  const [auth, list, usage, rules, logs, g] = await Promise.all([getAuthSettings(), senders(), senderUsage(), allRules(), emailLogs(200), googleAvailable()]);
  const templates = await Promise.all(EMAIL_EVENTS.map(async (e) => ({ event: e.key, label: e.label, placeholders: e.placeholders, ...(await template(e.key)) })));
  const label = (k: string) => eventDef(k)?.label ?? k;
  return (
    <>
      <div className="page-h"><div><h1>Email &amp; Sign-in</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Signup OTP, Continue with Google, sender emails, shipment email rules, templates and the email log. Every change is recorded in the Audit Log.</p></div></div>
      <EmailSettings d={{
        write: can(s.role, "notifications.write"), auth, googleConfigured: g.configured, redirectUri: googleRedirectUri(), providerConfigured: !!(await resendKey()),
        senders: list.map((x) => ({ id: x.id, email: x.email, displayName: x.displayName, replyTo: x.replyTo, isDefault: x.isDefault, status: x.status, statusDetail: x.statusDetail, checkedAt: fmt(x.checkedAt), usedBy: (usage[x.id] ?? []).map(label) })),
        rules: rules.map((r) => ({ ...r, label: label(r.event), audience: eventDef(r.event)!.audience })),
        templates: templates.map(({ event, label: l, subject, body, custom, placeholders }) => ({ event, label: l, subject, body, custom, placeholders })),
        logs: logs.map((l) => ({ id: l.id, event: l.event, label: label(l.event), toEmail: l.toEmail, toKind: l.toKind, senderEmail: l.senderEmail, subject: l.subject, status: l.status, error: l.error, attempts: l.attempts, retryable: l.retryable, at: fmt(l.createdAt) })),
      }} />
    </>
  );
}
