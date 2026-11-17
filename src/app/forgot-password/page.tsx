import { AuthShell } from "@/components/auth/AuthShell";
import { SITE } from "@/lib/site";

export const metadata = { title: "Reset password — Vishwaship" };

export default function ForgotPassword() {
  return (
    <AuthShell>
      <h1 style={{ fontSize: 24 }}>Reset your password</h1>
      <p className="muted small">Password reset links are emailed once the email provider (Resend or SMTP) is connected in Admin → Integrations. Until then, contact <a className="link" href={`mailto:${SITE.email}`}>{SITE.email}</a> from your registered email and our team will send a secure reset link.</p>
      <a className="btn btn-outline btn-block mt16" href="/login/">Back to login</a>
    </AuthShell>
  );
}
