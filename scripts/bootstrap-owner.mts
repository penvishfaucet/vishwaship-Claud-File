/**
 * One-time owner bootstrap.
 *   $env:OWNER_EMAIL="you@example.com"; $env:OWNER_NAME="Your Name"; $env:APP_URL="https://staging.example.com"; npm run owner:bootstrap
 * Creates the Owner staff account WITHOUT a password and prints a single-use password-setup link
 * (valid 30 minutes). Refuses to run if an active owner already exists.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { connect, schema } from "./db.mts";

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const name = process.env.OWNER_NAME?.trim() || "Owner";
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
if (!email) { console.error("Set OWNER_EMAIL"); process.exit(1); }

const c = await connect();
const existing = await c.db.select().from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.staffRole, "owner"), eq(schema.users.active, true)));
const real = existing.filter((u) => !u.email?.endsWith("@demo.vishwaship.test"));
if (real.length) { console.error("An active owner already exists. Use the admin portal to manage staff."); await c.close(); process.exit(1); }

const userId = `usr_${randomBytes(9).toString("hex")}`;
await c.db.insert(schema.users).values({ id: userId, kind: "staff", name, email, staffRole: "owner", mustResetPassword: true });
const token = randomBytes(32).toString("base64url");
await c.db.insert(schema.oneTimeTokens).values({
  id: createHash("sha256").update(token).digest("hex"), userId, purpose: "password_setup", expiresAt: new Date(Date.now() + 30 * 60_000),
});
await c.db.insert(schema.auditLog).values({ id: `aud_${randomBytes(9).toString("hex")}`, actorKind: "system", action: "owner.bootstrap", targetType: "user", targetId: userId });
console.log(`Owner created for ${email}. Set the password within 30 minutes (MFA setup follows):\n${appUrl}/admin/setup-password/?token=${token}`);
await c.close();
