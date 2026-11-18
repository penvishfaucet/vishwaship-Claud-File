import "server-only";
import type { InferSelectModel } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getAdapter } from "@/server/providers/registry";
import type { Capability } from "@/server/providers/types";
import { REQUIRED_CAPS, specFor } from "./specs";

type Account = InferSelectModel<typeof schema.providerAccounts>;

/** One capability's verification record (provider_accounts.capabilities[cap]). */
export interface CapRecord {
  state: "pending" | "sandbox_verified" | "live_verified" | "failed" | "unsupported" | "documentation_required";
  at?: string;
  mode?: "test" | "live";
  message?: string;
  /** What proved it: a shipment ID, AWB, or "rate check RC…". Never a secret. */
  evidence?: string;
}

export function capRecords(acct: Account): Record<string, CapRecord> {
  const raw = (acct.capabilities ?? {}) as Record<string, unknown>;
  const out: Record<string, CapRecord> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = { state: v === "sandbox_verified" || v === "live_verified" ? v : "pending" };
    else if (v && typeof v === "object") out[k] = v as CapRecord;
  }
  return out;
}

/** Verified for the account's current environment (a sandbox pass does not count for production). */
export function isVerified(acct: Account, cap: Capability) {
  const r = capRecords(acct)[cap];
  if (!r) return false;
  return acct.mode === "live" ? r.state === "live_verified" : r.state === "sandbox_verified" || r.state === "live_verified";
}

export type SetupState = "documentation_required" | "missing_credentials" | "not_tested" | "connection_failed" | "connected" | "ready" | "active" | "blocked" | "paused" | "archived";

export const SETUP_LABEL: Record<SetupState, [string, string]> = {
  documentation_required: ["Documentation Required", "c-pending"], missing_credentials: ["Missing Credentials", "c-draft"], not_tested: ["Credentials saved — not tested", "c-draft"],
  connection_failed: ["Connection failed", "c-failed"], connected: ["Connected", "c-pending"], ready: ["Ready for Activation", "c-active"],
  active: ["Active", "c-active"], blocked: ["Enabled but unverified — not quoting", "c-failed"], paused: ["Paused", "c-failed"], archived: ["Archived", "c-draft"],
};

export function setupState(acct: Account): SetupState {
  if (acct.status === "archived") return "archived";
  const cfg = (acct.configPublic ?? {}) as Record<string, unknown>;
  const spec = specFor(acct.adapter, cfg.protocol as string | undefined);
  if (!getAdapter(cfg.protocol ? String(cfg.protocol) : acct.adapter) || spec?.build === "documentation_required") return "documentation_required";
  if (acct.status === "enabled") return canTakeBookings(acct) ? "active" : "blocked";
  if (acct.status === "paused") return "paused";
  if (!acct.secretsEnc) return "missing_credentials";
  if (missingRequired(acct).length === 0) return "ready";
  if (isVerified(acct, "authenticate")) return "connected";
  if (acct.lastTestAt && acct.lastTestOk === false) return "connection_failed";
  return "not_tested";
}

/** Runtime gate used by quoting and booking: an account must be Active AND fully verified (demo fixtures excepted). */
export function canTakeBookings(acct: Account) {
  return acct.adapter === "demo" || missingRequired(acct).length === 0;
}

export function missingRequired(acct: Account): Capability[] {
  const caps = capRecords(acct);
  return REQUIRED_CAPS.filter((c) => caps[c]?.state !== "unsupported" && !isVerified(acct, c));
}

/** Record a capability result. A pass is stamped with the environment it happened in. */
export async function recordCapability(accountId: string, cap: Capability, ok: boolean, info: { message?: string; evidence?: string } = {}) {
  const db = await getDb();
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, accountId));
  if (!acct) return;
  const caps = capRecords(acct);
  const prev = caps[cap];
  // A later failure never erases a verified pass from real traffic; it is logged as the message instead.
  if (!ok && prev && (prev.state === "live_verified" || prev.state === "sandbox_verified")) {
    caps[cap] = { ...prev, message: `Last attempt failed: ${(info.message ?? "").slice(0, 160)}` };
  } else {
    caps[cap] = { state: ok ? (acct.mode === "live" ? "live_verified" : "sandbox_verified") : "failed", at: new Date().toISOString(), mode: acct.mode as "test" | "live", message: info.message?.slice(0, 240), evidence: info.evidence?.slice(0, 120) };
  }
  const patch: Partial<Account> = { capabilities: caps };
  if (ok) patch.lastSuccessAt = new Date();
  await db.update(schema.providerAccounts).set(patch).where(eq(schema.providerAccounts.id, accountId));
}

/** Booking-path hooks: real traffic through a pilot / active account verifies capabilities automatically. */
export async function noteCapability(accountId: string, cap: Capability, ok: boolean, info: { message?: string; evidence?: string } = {}) {
  try {
    const db = await getDb();
    const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, accountId));
    if (!acct || acct.adapter === "demo") return;
    if (ok && isVerified(acct, cap)) { await db.update(schema.providerAccounts).set({ lastSuccessAt: new Date() }).where(eq(schema.providerAccounts.id, accountId)); return; }
    await recordCapability(accountId, cap, ok, info);
  } catch { /* verification bookkeeping must never break a booking */ }
}

/** Put a capability back to Pending (e.g. the API answered but the panel comparison is still to be done). */
export async function markPending(accountId: string, cap: Capability, message: string) {
  const db = await getDb();
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, accountId));
  if (!acct) return;
  const caps = capRecords(acct);
  if (caps[cap]?.state === "live_verified" || caps[cap]?.state === "sandbox_verified") return;
  caps[cap] = { state: "pending", at: new Date().toISOString(), mode: acct.mode as "test" | "live", message: message.slice(0, 240) };
  await db.update(schema.providerAccounts).set({ capabilities: caps }).where(eq(schema.providerAccounts.id, accountId));
}
