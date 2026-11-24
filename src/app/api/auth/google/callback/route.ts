import { NextResponse } from "next/server";
import { publicOrigin } from "@/server/public-origin";
import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { createCustomerAccount } from "@/server/auth/accounts";
import { referralFromCookie } from "@/server/franchise/referral";
import { googleAvailable, googleCallback, rememberPendingLink } from "@/server/auth/google";
import { createSession } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

/**
 * Google redirects here. Returning customer (same Google id) → signed in. Email of an existing account → the customer
 * signs in with their password once to confirm the link (old shipments, wallet and profile stay on that account).
 * New email → a Customer account is created (the email is verified by Google) and onboarding starts.
 * Started from the Admin login page (next = /admin/…): only an ACTIVE staff user with exactly that email is signed in
 * as staff; nothing is created or linked, and an unknown email goes back to the Admin login page.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const to = (p: string) => NextResponse.redirect(new URL(p, publicOrigin(req)));
  if (!(await googleAvailable()).enabled) return to("/login/?err=google_off");
  if (u.searchParams.get("error")) return to("/login/?err=google_cancelled");
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  if (!code || !state) return to("/login/?err=google");
  const r = await googleCallback(code, state);
  if (!r.ok) return to(`/login/?err=google&msg=${encodeURIComponent(r.message)}`);
  const meta = { ip: (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim(), ua: req.headers.get("user-agent") ?? "" };
  const db = await getDb();
  if (r.next === "/admin" || r.next.startsWith("/admin/")) {
    const [st] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.email, r.id.email)));
    if (!st || !st.staffRole || !st.active) {
      await audit({ actorKind: "system", action: "auth.staff_login_failed", details: { via: "google", email: r.id.email } });
      return to("/admin/login/?err=google_staff");
    }
    await createSession(st.id, "staff", meta);
    await audit({ actorUserId: st.id, actorKind: "staff", action: "auth.staff_login", details: { via: "google" } });
    return to("/admin/");
  }
  const [bySub] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.googleSub, r.id.sub)));
  if (bySub) {
    if (!bySub.active) return to("/login/?err=inactive");
    await createSession(bySub.id, "customer", meta);
    await audit({ actorUserId: bySub.id, actorKind: "customer", orgId: bySub.orgId, action: "auth.login", details: { via: "google" } });
    return to(r.next || "/portal/");
  }
  const [byEmail] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.email, r.id.email)));
  if (byEmail) {
    await rememberPendingLink(r.id);
    return to(`/login/?link=google&email=${encodeURIComponent(r.id.email)}`);
  }
  const userId = await createCustomerAccount({ name: r.id.name, email: r.id.email, googleSub: r.id.sub, via: "google", referralCode: await referralFromCookie() });
  if (!userId) return to("/login/?err=google");
  await createSession(userId, "customer", meta);
  return to("/portal/");
}
