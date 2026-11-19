import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/Forms";
import { googleAvailable } from "@/server/auth/google";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign up — Vishwaship" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const g = await googleAvailable();
  return <AuthShell><SignupForm next={next} googleEnabled={g.enabled} /></AuthShell>;
}
