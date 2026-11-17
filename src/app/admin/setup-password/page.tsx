import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { AuthShell } from "@/components/auth/AuthShell";
import { audit } from "@/server/audit";
import { createSession, readSession, revokeAllSessions } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { hashPassword, sha256 } from "@/server/security/crypto";

async function setPassword(fd: FormData) {
  "use server";
  const token = String(fd.get("token") ?? "");
  const pw = String(fd.get("password") ?? ""), pw2 = String(fd.get("confirm") ?? "");
  if (pw.length < 12 || pw !== pw2) redirect(`/admin/setup-password/?token=${encodeURIComponent(token)}&err=pw`);
  const db = await getDb();
  let userId: string | null = null;
  if (token) {
    const [t] = await db.select().from(schema.oneTimeTokens).where(and(eq(schema.oneTimeTokens.id, sha256(token)), isNull(schema.oneTimeTokens.usedAt), gt(schema.oneTimeTokens.expiresAt, new Date())));
    if (!t || !["password_setup", "staff_invite", "password_reset"].includes(t.purpose)) redirect("/admin/setup-password/?err=token");
    await db.update(schema.oneTimeTokens).set({ usedAt: new Date() }).where(eq(schema.oneTimeTokens.id, t.id));
    userId = t.userId;
  } else {
    const s = await readSession("staff");
    if (!s?.mustResetPassword) redirect("/admin/login/");
    userId = s.userId;
  }
  await db.update(schema.users).set({ passwordHash: await hashPassword(pw), mustResetPassword: false }).where(eq(schema.users.id, userId!));
  await revokeAllSessions(userId!);
  await audit({ actorUserId: userId, actorKind: "staff", action: "auth.password_set" });
  await createSession(userId!, "staff", {});
  redirect("/admin/mfa/");
}

export default async function SetupPassword({ searchParams }: { searchParams: Promise<{ token?: string; err?: string }> }) {
  const sp = await searchParams;
  return (
    <AuthShell variant="staff">
      <h1 style={{ fontSize: 22 }}>Set your password</h1>
      <p className="small muted">At least 12 characters. You’ll set up two-step verification next.</p>
      <form action={setPassword} className="col" style={{ gap: 12 }}>
        <input type="hidden" name="token" value={sp.token ?? ""} />
        <div className="field"><label htmlFor="pw">New password</label><input id="pw" name="password" type="password" className="input" minLength={12} required autoComplete="new-password" /></div>
        <div className="field"><label htmlFor="pw2">Confirm password</label><input id="pw2" name="confirm" type="password" className="input" minLength={12} required autoComplete="new-password" /></div>
        {sp.err && <p className="err small" role="alert">{sp.err === "token" ? "This link is invalid or expired. Ask the owner for a new invite." : "Passwords must match and be at least 12 characters."}</p>}
        <button className="btn btn-navy btn-lg btn-block">Save password</button>
      </form>
    </AuthShell>
  );
}
