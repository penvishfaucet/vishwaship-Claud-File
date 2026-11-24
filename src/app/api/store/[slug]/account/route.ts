import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { PhoneTokenError, firebasePhoneConfig, verifyFirebasePhoneToken } from "@/server/auth/firebase-phone";
import { rateLimit } from "@/server/security/rate-limit";
import { AddressInput, BuyerError, currentBuyer, deleteAddress, loginWithEmailCode, loginWithPhoneToken, logoutBuyer, sendEmailCode, updateProfile, upsertAddress } from "@/server/store/buyers";
import { CheckoutError, liveStore } from "@/server/store/checkout";

/**
 * Store buyer account (My Account). Login: email_code → email_login, or phone_login with a Firebase ID token.
 * Logged in: profile, address_save, address_delete, logout. Nothing here can see another buyer's data.
 */
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("email_code"), email: z.string().max(160) }),
  z.object({ op: z.literal("email_login"), email: z.string().max(160), code: z.string().max(10) }),
  z.object({ op: z.literal("phone_login"), idToken: z.string().min(20).max(4096) }),
  z.object({ op: z.literal("logout") }),
  z.object({ op: z.literal("profile"), name: z.string().max(80) }),
  z.object({ op: z.literal("address_save"), address: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("address_delete"), id: z.string().max(40) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  if (!(await rateLimit(`sf-account:${ip}`, 60, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  const p = await parseJson(req, Body); if (!p.ok) return p.res;
  const b = p.data;
  try {
    const store = await liveStore(slug, { allowExpired: true });
    if (b.op === "email_code") return NextResponse.json({ ok: true, ...(await sendEmailCode(store, b.email, ip)) });
    if (b.op === "email_login") { await loginWithEmailCode(store, b.email, b.code); return NextResponse.json({ ok: true }); }
    if (b.op === "phone_login") {
      const cfg = await firebasePhoneConfig();
      if (!cfg) return apiError(503, "provider_error", "Login with mobile OTP is not available right now. Use your email instead.");
      let mobile: string;
      try { ({ mobile } = await verifyFirebasePhoneToken(b.idToken, cfg.projectId)); }
      catch (e) {
        if (e instanceof PhoneTokenError) return apiError(401, "unauthorized", "The OTP could not be confirmed. Please request a new OTP.");
        throw e;
      }
      if (!(await rateLimit(`sf-account:m:${store.id}:${mobile}`, 10, 900)).ok) return apiError(429, "rate_limited", "Too many attempts for this number. Please wait a few minutes.");
      await loginWithPhoneToken(store, mobile);
      return NextResponse.json({ ok: true });
    }
    if (b.op === "logout") { await logoutBuyer(store.id); return NextResponse.json({ ok: true }); }
    const me = await currentBuyer(store.id);
    if (!me) return apiError(401, "unauthorized", "Please log in again.");
    if (b.op === "profile") { await updateProfile(me, b.name); return NextResponse.json({ ok: true }); }
    if (b.op === "address_save") {
      const parsed = AddressInput.safeParse(b.address);
      if (!parsed.success) { const i = parsed.error.issues[0]; return apiError(422, "validation_error", i.message, { field: String(i.path[0] ?? "") }); }
      return NextResponse.json({ ok: true, id: await upsertAddress(me, parsed.data) });
    }
    await deleteAddress(me, b.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BuyerError) return apiError(422, "validation_error", e.message, e.field ? { field: e.field } : undefined);
    if (e instanceof CheckoutError) return apiError(404, "not_found", e.message);
    console.error("[store account]", (e as Error).message);
    return apiError(502, "provider_error", "Something went wrong. Please try again.");
  }
}
