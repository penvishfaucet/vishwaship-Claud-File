import "server-only";
import { readSession } from "@/server/auth/session";

export type SiteAuth = { customer: { name: string } | null; staff: { name: string } | null };

/** Who is signed in on this browser (from the existing session cookies). Never trusts client input. */
export async function siteAuth(): Promise<SiteAuth> {
  const [c, s] = await Promise.all([readSession("customer").catch(() => null), readSession("staff").catch(() => null)]);
  return {
    customer: c?.orgId ? { name: c.name } : null,
    staff: s && s.mfaPassed && !s.mustResetPassword ? { name: s.name } : null,
  };
}
