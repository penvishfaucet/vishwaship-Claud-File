import { redirect } from "next/navigation";

/** The authenticator-app step is switched off (see MFA_REQUIRED in rbac.ts); old links land on the admin home. */
export default function MfaPage() {
  redirect("/admin/");
}
