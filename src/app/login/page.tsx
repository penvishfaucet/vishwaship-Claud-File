import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/Forms";
import { readSession } from "@/server/auth/session";
import { firebaseGoogleFrom, googleAvailable } from "@/server/auth/google";
import { firebasePhoneConfig } from "@/server/auth/firebase-phone";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("/login/", "Login — Vishwaship", "Log in to your Vishwaship account to book shipments, schedule pickups and track orders.");
export const dynamic = "force-dynamic";

const safe = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/portal/");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ admin?: string; next?: string; err?: string; msg?: string; link?: string; email?: string }> }) {
  const sp = await searchParams;
  // Compatibility: the old site used /login/?admin=1. The query only picks the form; it never grants a role.
  if (sp.admin) redirect("/admin/login/");
  // Already signed in: continue straight to where the visitor was going (e.g. a booking from the Rate Calculator).
  if (await readSession("customer").catch(() => null)) redirect(safe(sp.next));
  const [g, phone] = await Promise.all([googleAvailable(), firebasePhoneConfig()]);
  return <AuthShell><LoginForm next={sp.next} googleEnabled={g.enabled} googleFirebase={firebaseGoogleFrom(g, phone)} phone={phone} err={sp.err} msg={sp.msg?.slice(0, 160)} linkEmail={sp.link === "google" ? sp.email?.slice(0, 160) : undefined} /></AuthShell>;
}
