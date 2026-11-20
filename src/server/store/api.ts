import "server-only";
import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { hasFeature } from "@/server/features";
import { apiError } from "@/server/http";
import { StoreError } from "./catalog";

export type StoreSession = { userId: string; orgId: string; impersonatorId: string | null };

/** Portal API guard: logged-in customer whose plan has the Online Store module. orgId always comes from the session. */
export async function storeGuard(): Promise<{ s: StoreSession; err?: undefined } | { err: NextResponse; s?: undefined }> {
  const s = await apiCustomer();
  if (!s) return { err: apiError(401, "unauthorized", "Please log in") };
  if (!(await hasFeature(s.orgId, "online_store"))) return { err: apiError(403, "forbidden", "Online Store is not included in your plan") };
  return { s: { userId: s.userId, orgId: s.orgId, impersonatorId: s.impersonatorId } };
}

export const storeAudit = (s: StoreSession, action: string, targetId?: string, details?: Record<string, unknown>) =>
  audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: `store.${action}`, targetType: "store", targetId, details });

/** Turn service errors into 422s; anything else is a real failure. */
export async function run<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const r = await fn();
    return NextResponse.json(r ?? { ok: true });
  } catch (e) {
    if (e instanceof StoreError || (e instanceof Error && e.message === "Image not found in your store")) return apiError(422, "validation_error", e.message);
    throw e;
  }
}

export const fail = (message: string, status = 422) => apiError(status, status === 404 ? "not_found" : "validation_error", message);
