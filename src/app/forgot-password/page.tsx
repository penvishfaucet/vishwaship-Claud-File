import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/Forms";

export const metadata = { title: "Reset password — Vishwaship" };

/** Forgot password: a 6-digit code to the registered email, then a new password (entered twice). */
export default function ForgotPassword() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
