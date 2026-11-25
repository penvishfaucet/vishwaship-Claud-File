import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { StaffLoginForm } from "@/components/auth/Forms";
import { firebasePhoneConfig } from "@/server/auth/firebase-phone";
import { googleAvailable } from "@/server/auth/google";
import { readSession } from "@/server/auth/session";

export const metadata = { title: "Admin login — Vishwaship", description: "Vishwaship staff and franchise login." };
export const dynamic = "force-dynamic";

/** Staff sign in with Google, mobile OTP (Firebase) or email + password. No authenticator-app step. */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  if (await readSession("staff").catch(() => null)) redirect("/admin/");
  const [g, phone] = await Promise.all([googleAvailable(), firebasePhoneConfig()]);
  // Google for staff: the site's own Google sign-in when it has keys, else Google through Firebase whenever Firebase is ON.
  return <AuthShell variant="staff"><StaffLoginForm googleEnabled={g.enabled} googleFirebase={g.enabled ? null : phone} phone={phone} err={sp.err} /></AuthShell>;
}
