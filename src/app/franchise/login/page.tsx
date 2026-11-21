import { AuthShell } from "@/components/auth/AuthShell";
import { FranchiseLoginForm } from "@/components/franchise/AuthForms";

export const metadata = { title: "Franchise login — Vishwaship" };

export default async function FranchiseLoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  return <AuthShell variant="franchise"><FranchiseLoginForm notice={err === "closed" ? "This franchise account is closed. Please contact Vishwaship." : undefined} /></AuthShell>;
}
