"use server";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/server/audit";
import { createSession, destroySession } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { verifyPassword } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";
import { franchiseForUser, consumeSetupToken } from "./portal";
import { FranchiseError } from "./service";

export type FrFormState = { error?: string } | undefined;

async function meta() {
  const h = await headers();
  return { ip: (h.get("x-forwarded-for")?.split(",")[0] ?? "local").trim(), ua: h.get("user-agent") ?? "" };
}

export async function franchiseLogin(_: FrFormState, fd: FormData): Promise<FrFormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const m = await meta();
  if (!(await rateLimit(`login:f:${m.ip}`, 10, 900)).ok || !(await rateLimit(`login:f:id:${email}`, 6, 900)).ok) return { error: "Too many attempts. Please wait 15 minutes." };
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "franchise"), eq(schema.users.email, email)));
  const ok = await verifyPassword(password, u?.passwordHash);
  if (!u || !ok || !u.active) {
    await audit({ actorKind: "system", action: "auth.franchise_login_failed", details: { email } });
    return { error: "Incorrect email or password." };
  }
  if (!(await franchiseForUser(u.id))) return { error: "This franchise account is closed. Please contact Vishwaship." };
  await createSession(u.id, "franchise", m);
  await audit({ actorUserId: u.id, actorKind: "franchise", action: "auth.franchise_login" });
  redirect("/franchise/");
}

export async function franchiseLogout() {
  await destroySession("franchise");
  redirect("/franchise/login/");
}

export async function setFranchisePassword(_: FrFormState, fd: FormData): Promise<FrFormState> {
  const token = String(fd.get("token") ?? "");
  const pw = String(fd.get("password") ?? ""), pw2 = String(fd.get("confirm") ?? "");
  const m = await meta();
  if (!(await rateLimit(`fr-setup:${m.ip}`, 10, 900)).ok) return { error: "Too many attempts. Please wait 15 minutes." };
  if (pw !== pw2) return { error: "The two passwords do not match" };
  let userId: string;
  try { userId = await consumeSetupToken(token, pw); } catch (e) { if (e instanceof FranchiseError) return { error: e.message }; throw e; }
  await createSession(userId, "franchise", m);
  redirect("/franchise/");
}
