import { audit } from "@/server/audit";
import { apiError } from "@/server/http";
import { isMobileRequest, revokeMobileSession } from "@/server/mobile/auth";
import { mobileJson, withCustomer } from "@/server/mobile/http";

/** Sign out this device: the token is revoked and the device is detached from push notifications. */
export async function POST(req: Request) {
  if (!isMobileRequest(req)) return apiError(400, "validation_error", "App token required");
  return withCustomer(async (s) => {
    await revokeMobileSession(s.sessionId);
    await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "auth.logout", details: { channel: "android" } });
    return mobileJson({ ok: true });
  });
}
