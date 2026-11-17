import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AuthShell } from "@/components/auth/AuthShell";
import { audit } from "@/server/audit";
import { readSession } from "@/server/auth/session";
import { newTotpSecret, verifyTotp } from "@/server/auth/totp";
import { getDb, schema } from "@/server/db/client";
import { decrypt, encrypt } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";

async function verify(fd: FormData) {
  "use server";
  const s = await readSession("staff");
  if (!s) redirect("/admin/login/");
  const rl = await rateLimit(`mfa:${s.userId}`, 6, 600);
  if (!rl.ok) redirect("/admin/mfa/?err=rate");
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.userId));
  // The key is stored (encrypted) when the setup page is first shown and only becomes active here, once a code matches.
  const secret = u.mfaSecretEnc ? decrypt(u.mfaSecretEnc) : null;
  const code = String(fd.get("code") ?? "").replace(/D/g, "");
  if (!secret || !verifyTotp(secret, code)) redirect("/admin/mfa/?err=code");
  if (!u.mfaEnabled) await db.update(schema.users).set({ mfaEnabled: true }).where(eq(schema.users.id, s.userId));
  await db.update(schema.sessions).set({ mfaPassed: true }).where(eq(schema.sessions.id, s.sessionId));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: u.mfaEnabled ? "auth.mfa_passed" : "auth.mfa_enrolled" });
  redirect("/admin/");
}

/** Before setup is finished the user may replace the key (e.g. it was shown to someone else). */
async function newKey() {
  "use server";
  const s = await readSession("staff");
  if (!s) redirect("/admin/login/");
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.userId));
  if (!u.mfaEnabled) {
    await db.update(schema.users).set({ mfaSecretEnc: encrypt(newTotpSecret()) }).where(eq(schema.users.id, s.userId));
    await audit({ actorUserId: s.userId, actorKind: "staff", action: "auth.mfa_key_regenerated" });
  }
  redirect("/admin/mfa/?new=1");
}

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ err?: string; new?: string }> }) {
  const sp = await searchParams;
  const s = await readSession("staff");
  if (!s) redirect("/admin/login/");
  const db = await getDb();
  let [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.userId));
  // Keep ONE key until setup is verified: phones often reload the page after switching to the authenticator
  // app, and a key that changed on every load could never match the one the user had added.
  if (!u.mfaEnabled && !u.mfaSecretEnc) {
    await db.update(schema.users).set({ mfaSecretEnc: encrypt(newTotpSecret()) }).where(eq(schema.users.id, s.userId));
    [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.userId));
  }
  const secret = !u.mfaEnabled && u.mfaSecretEnc ? decrypt(u.mfaSecretEnc) : "";
  const uri = secret ? `otpauth://totp/Vishwaship:${encodeURIComponent(u.email ?? u.id)}?secret=${secret}&issuer=Vishwaship` : "";
  return (
    <AuthShell variant="staff">
      <h1 style={{ fontSize: 22 }}>{u.mfaEnabled ? "Two-step verification" : "Set up two-step verification"}</h1>
      {!u.mfaEnabled && (
        <>
          <p className="small muted">Your role requires an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Add this key, then enter the 6-digit code.</p>
          <p className="mono small" style={{ wordBreak: "break-all", background: "var(--gray-soft)", padding: 10, borderRadius: 8 }}>{secret.match(/.{1,4}/g)?.join(" ")}</p>
          <p className="tiny muted" style={{ wordBreak: "break-all" }}>{uri}</p>
          {sp.new && <p className="small" role="status">New key created. Remove the old Vishwaship entry from your authenticator app and add this key.</p>}
        </>
      )}
      <form action={verify} className="col" style={{ gap: 12 }}>
        <div className="field"><label htmlFor="code">6-digit code</label><input id="code" name="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus /></div>
        {sp.err && <p className="err small" role="alert">{sp.err === "rate" ? "Too many attempts. Wait 10 minutes." : "That code didn’t match. Try the latest code."}</p>}
        <button className="btn btn-navy btn-lg btn-block">Verify</button>
      </form>
      {!u.mfaEnabled && (
        <form action={newKey}>
          <button className="btn btn-outline btn-sm" type="submit">Get a new key</button>
        </form>
      )}
    </AuthShell>
  );
}
