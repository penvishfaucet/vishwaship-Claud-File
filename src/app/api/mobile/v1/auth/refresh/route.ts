import { apiError } from "@/server/http";
import { isMobileRequest, requestMeta, rotateMobileSession } from "@/server/mobile/auth";
import { mobileJson, withCustomer } from "@/server/mobile/http";

/** Rotate the app token (the old one stops working). An expired or revoked token gets 401, and the app signs out safely. */
export async function POST(req: Request) {
  if (!isMobileRequest(req)) return apiError(400, "validation_error", "App token required");
  return withCustomer(async (s) => {
    if (s.impersonatorId) return apiError(403, "forbidden", "Not available");
    return mobileJson(await rotateMobileSession(s.sessionId, s.userId, s.orgId, requestMeta(req)));
  });
}
