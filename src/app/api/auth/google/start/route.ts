import { NextResponse } from "next/server";
import { googleAvailable, googleStartUrl } from "@/server/auth/google";

/** GET /api/auth/google/start?next=/portal/... → Google account chooser. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const raw = u.searchParams.get("next") ?? "";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/portal/";
  const g = await googleAvailable();
  if (!g.enabled) return NextResponse.redirect(new URL(`/login/?err=${g.configured ? "google_off" : "google_setup"}`, u.origin));
  return NextResponse.redirect(await googleStartUrl(next));
}
