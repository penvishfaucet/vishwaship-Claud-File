/**
 * Runs automatically before `npm start` (prestart) on the server:
 *  1. applies database migrations (safe to repeat),
 *  2. if no real owner exists yet and OWNER_EMAIL is set, creates the owner account WITHOUT a
 *     password and prints a single-use password-setup link (valid 24 h) to the app logs.
 * Hosting panels without a terminal (e.g. Hostinger Node.js apps) can read it from the runtime logs.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { connect, schema } from "./db.mts";

const c = await connect();
await c.migrate();
console.log("[release] migrations applied");

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
if (email && !email.includes("change_me")) {
  const owners = await c.db.select().from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.staffRole, "owner")));
  const real = owners.filter((u) => !u.email?.endsWith("@demo.vishwaship.test"));
  const pending = real.find((u) => u.email === email && u.mustResetPassword);
  if (real.length === 0 || pending) {
    const userId = pending?.id ?? `usr_${randomBytes(9).toString("hex")}`;
    if (!pending) {
      await c.db.insert(schema.users).values({ id: userId, kind: "staff", name: process.env.OWNER_NAME?.trim() || "Owner", email, staffRole: "owner", mustResetPassword: true });
      await c.db.insert(schema.auditLog).values({ id: `aud_${randomBytes(9).toString("hex")}`, actorKind: "system", action: "owner.bootstrap", targetType: "user", targetId: userId });
    }
    const token = randomBytes(32).toString("base64url");
    await c.db.insert(schema.oneTimeTokens).values({ id: createHash("sha256").update(token).digest("hex"), userId, purpose: "password_setup", expiresAt: new Date(Date.now() + 24 * 3600_000) });
    const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
    console.log(`[release] OWNER SETUP for ${email} — open within 24 hours to set your password:\n${base}/admin/setup-password/?token=${token}`);
  } else {
    console.log("[release] owner account already set up");
  }
}
await c.close();
