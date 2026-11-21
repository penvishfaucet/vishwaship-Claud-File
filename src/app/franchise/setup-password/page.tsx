import { AuthShell } from "@/components/auth/AuthShell";
import { FranchiseSetPasswordForm } from "@/components/franchise/AuthForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set password — Vishwaship franchise", referrer: "no-referrer" };

export default async function FranchiseSetupPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AuthShell variant="franchise"><FranchiseSetPasswordForm token={token ?? ""} /></AuthShell>;
}
