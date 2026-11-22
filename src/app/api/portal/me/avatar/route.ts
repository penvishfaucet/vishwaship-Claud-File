import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { AvatarError, avatarPhoto, clearAvatar, setEmoji, setPhoto } from "@/server/portal/avatar";
import { rateLimit } from "@/server/security/rate-limit";

/** The signed-in user's own avatar photo (never anyone else's). */
export async function GET() {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const b = await avatarPhoto(s.userId);
  if (!b) return apiError(404, "not_found", "No photo");
  return new Response(new Uint8Array(b), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}

const done = async (s: { userId: string; orgId: string; impersonatorId: string | null }, kind: string, fn: () => Promise<unknown>) => {
  if (!(await rateLimit(`avatar:${s.userId}`, 20, 600)).ok) return apiError(429, "rate_limited", "Too many changes. Please wait a few minutes.");
  try {
    const avatar = await fn();
    await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: `profile.avatar_${kind}`, targetType: "user", targetId: s.userId });
    return NextResponse.json({ ok: true, avatar });
  } catch (e) {
    if (e instanceof AvatarError) return apiError(422, "validation_error", e.message);
    throw e;
  }
};

/** Upload a photo: multipart field `photo`. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  let f: FormDataEntryValue | null = null;
  try { f = (await req.formData()).get("photo"); } catch { return apiError(422, "validation_error", "Choose a photo"); }
  if (!(f instanceof File) || !f.size) return apiError(422, "validation_error", "Choose a photo");
  if (f.size > 5 * 1024 * 1024) return apiError(422, "validation_error", "Photo must be under 5 MB");
  const buf = Buffer.from(await f.arrayBuffer());
  return done(s, "photo", () => setPhoto(s.userId, buf));
}

/** Use an emoji: { emoji }. */
export async function PUT(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ emoji: z.string().max(32) })); if (!p.ok) return p.res;
  return done(s, "emoji", () => setEmoji(s.userId, p.data.emoji));
}

/** Back to initials. */
export async function DELETE() {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  return done(s, "removed", () => clearAvatar(s.userId));
}
