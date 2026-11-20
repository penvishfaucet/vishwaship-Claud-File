import { z } from "zod";
import { audit } from "@/server/audit";
import { apiError, parseJson } from "@/server/http";
import { DeviceSchema, checkCustomerPassword, issueMobileSession, requestMeta } from "@/server/mobile/auth";
import { mobileJson } from "@/server/mobile/http";
import { rateLimit } from "@/server/security/rate-limit";
import { meView } from "@/server/mobile/views";

const Body = z.object({
  identifier: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(128),
  device: DeviceSchema.optional(),
});

/** Android sign-in with the same email/mobile + password as the website. Returns an app token (never a cookie). */
export async function POST(req: Request) {
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const m = requestMeta(req);
  const id = p.data.identifier.toLowerCase();
  const rl = await rateLimit(`login:c:${m.ip}`, 10, 600);
  const rlId = await rateLimit(`login:c:id:${id}`, 8, 900);
  if (!rl.ok || !rlId.ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  const u = await checkCustomerPassword(id, p.data.password);
  if (!u) return apiError(401, "unauthorized", "Incorrect email/mobile or password.");
  const session = await issueMobileSession(u.id, u.orgId!, m, p.data.device);
  await audit({ actorUserId: u.id, actorKind: "customer", orgId: u.orgId, action: "auth.login", details: { channel: "android" } });
  return mobileJson({ ...session, me: await meView(u.id, u.orgId!) });
}
