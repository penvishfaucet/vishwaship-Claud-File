/**
 * Release step for PostgreSQL (DATABASE_URL set): apply migrations, then — if no real owner exists yet and
 * OWNER_EMAIL is set — create the owner WITHOUT a password and print a single-use setup link (24 h) to the logs.
 *
 * Runs automatically when the web app starts (src/instrumentation.ts), because some hosts (e.g. Hostinger
 * Web Apps) start the app without running `npm start`'s prestart hook. Also used by scripts/release.mts.
 * Migrations are embedded in the build (migrations.generated.ts, made by scripts/embed-migrations.mjs) because
 * such hosts ship only the build output, not the /migrations folder. Same bookkeeping table as drizzle-kit.
 * Safe to repeat: migrations are idempotent and a PostgreSQL advisory lock stops two instances racing.
 * Owner recovery (forgotten password / lost authenticator): set OWNER_RESET_CODE to any new text (8+ chars) in the
 * host's environment variables and redeploy. On the next start the OWNER_EMAIL owner's password and two-step
 * verification are cleared, their sessions are signed out and a fresh setup link is printed. Each code works once;
 * remove the variable afterwards.
 * No alias ("@/…") or "server-only" imports so tsx scripts can import it too.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { EMBEDDED_MIGRATIONS } from "./migrations.generated";
import * as schemaNs from "./schema";

// tsx loads schema.ts as CommonJS (namespace under "default"); the bundler gives the plain namespace. Dynamic key avoids a bundler warning.
const DEFAULT_KEY = "default";
const schema = ((schemaNs as unknown as Record<string, typeof schemaNs | undefined>)[DEFAULT_KEY] ?? schemaNs) as typeof schemaNs;
const LOCK_ID = 7_310_442_901; // arbitrary, constant advisory-lock key for "vishwaship release"

export async function runRelease(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("runRelease needs DATABASE_URL");
  const pgMod = (await import("pg")) as typeof import("pg") & { default?: typeof import("pg") };
  const Pool = pgMod.Pool ?? pgMod.default!.Pool; // tsx/CommonJS puts pg's exports under "default"
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    const db = drizzle(client, { schema });
    // drizzle's own migrator, fed from the embedded copy instead of reading /migrations from disk
    const internal = db as unknown as { dialect: { migrate: (m: unknown, session: unknown, cfg: object) => Promise<void> }; session: unknown };
    await internal.dialect.migrate(EMBEDDED_MIGRATIONS, internal.session, {});
    console.log(`[release] migrations applied (${EMBEDDED_MIGRATIONS.length} known)`);
    await resetOwnerIfRequested(db);
    await bootstrapOwner(db);
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
    await pool.end();
  }
}

type Db = Pick<ReturnType<typeof drizzle<typeof schema>>, "select" | "insert" | "update" | "delete">;

async function resetOwnerIfRequested(db: Db) {
  const code = process.env.OWNER_RESET_CODE?.trim();
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!code || !email) return;
  if (code.length < 8) {
    console.log("[release] OWNER_RESET_CODE ignored: use at least 8 characters");
    return;
  }
  const marker = createHash("sha256").update(`owner-reset:${code}`).digest("hex");
  const [used] = await db.select({ id: schema.auditLog.id }).from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, "owner.reset"), eq(schema.auditLog.targetType, "reset_code"), eq(schema.auditLog.targetId, marker)));
  if (used) {
    console.log("[release] OWNER_RESET_CODE was already used — remove it from the environment variables");
    return;
  }
  const [owner] = await db.select().from(schema.users)
    .where(and(eq(schema.users.kind, "staff"), eq(schema.users.staffRole, "owner"), eq(schema.users.email, email)));
  if (!owner) {
    console.log(`[release] OWNER_RESET_CODE: no owner account with email ${email}`);
    return;
  }
  await db.update(schema.users).set({ passwordHash: null, mustResetPassword: true, mfaEnabled: false, mfaSecretEnc: null, active: true }).where(eq(schema.users.id, owner.id));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, owner.id));
  await db.insert(schema.auditLog).values({ id: `aud_${randomBytes(9).toString("hex")}`, actorKind: "system", action: "owner.reset", targetType: "reset_code", targetId: marker, details: { userId: owner.id } });
  console.log(`[release] owner ${email} reset: password and two-step verification cleared — set them again with the link below`);
}

async function bootstrapOwner(db: Db) {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email || email.includes("change_me")) return;
  const owners = await db.select().from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.staffRole, "owner")));
  const real = owners.filter((u) => !u.email?.endsWith("@demo.vishwaship.test"));
  const pending = real.find((u) => u.email === email && u.mustResetPassword);
  if (real.length > 0 && !pending) {
    console.log("[release] owner account already set up");
    return;
  }
  const userId = pending?.id ?? `usr_${randomBytes(9).toString("hex")}`;
  if (!pending) {
    await db.insert(schema.users).values({ id: userId, kind: "staff", name: process.env.OWNER_NAME?.trim() || "Owner", email, staffRole: "owner", mustResetPassword: true });
    await db.insert(schema.auditLog).values({ id: `aud_${randomBytes(9).toString("hex")}`, actorKind: "system", action: "owner.bootstrap", targetType: "user", targetId: userId });
  }
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.oneTimeTokens).values({ id: createHash("sha256").update(token).digest("hex"), userId, purpose: "password_setup", expiresAt: new Date(Date.now() + 24 * 3600_000) });
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  console.log(`[release] OWNER SETUP for ${email} — open within 24 hours to set your password:\n${base}/admin/setup-password/?token=${token}`);
}
