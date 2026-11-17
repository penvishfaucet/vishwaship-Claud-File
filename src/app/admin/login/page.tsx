import { AuthShell } from "@/components/auth/AuthShell";
import { StaffLoginForm } from "@/components/auth/Forms";

export const metadata = { title: "Admin login — Vishwaship" };

export default function AdminLoginPage() {
  return <AuthShell variant="staff"><StaffLoginForm /></AuthShell>;
}
