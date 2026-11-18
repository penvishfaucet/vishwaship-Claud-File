import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/Forms";
import { readSession } from "@/server/auth/session";

export const metadata = { title: "Login — Vishwaship" };
export const dynamic = "force-dynamic";

const safe = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/portal/");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ admin?: string; next?: string }> }) {
  const sp = await searchParams;
  // Compatibility: the old site used /login/?admin=1. The query only picks the form; it never grants a role.
  if (sp.admin) redirect("/admin/login/");
  // Already signed in: continue straight to where the visitor was going (e.g. a booking from the Rate Calculator).
  if (await readSession("customer").catch(() => null)) redirect(safe(sp.next));
  return <AuthShell><LoginForm next={sp.next} /></AuthShell>;
}
