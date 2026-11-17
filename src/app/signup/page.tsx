import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/Forms";

export const metadata = { title: "Sign up — Vishwaship" };

export default function SignupPage() {
  return <AuthShell><SignupForm /></AuthShell>;
}
