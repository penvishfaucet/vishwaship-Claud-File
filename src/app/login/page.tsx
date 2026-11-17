import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/Forms";

export const metadata = { title: "Login — Vishwaship" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ admin?: string; next?: string }> }) {
  const sp = await searchParams;
  // Compatibility: the old site used /login/?admin=1. The query only picks the form; it never grants a role.
  if (sp.admin) redirect("/admin/login/");
  return <AuthShell><LoginForm next={sp.next} /></AuthShell>;
}
