import { NextResponse } from "next/server";
import { eddConfigByKey, estimate } from "@/server/edd";
import { clientIp, rateLimit } from "@/server/security/rate-limit";

/**
 * Public EDD lookup for the seller's storefront widget: ?key=<widget key>&pin=<6 digits>.
 * Returns only serviceable + estimated date (never rates or seller data). CORS limited to the seller's
 * allowed origins when they set any. Rate-limited per IP and per widget.
 */
function cors(origin: string | null, allowed: string[]) {
  const ok = !allowed.length || (origin && allowed.some((a) => new URL(a).origin === origin));
  return { "access-control-allow-origin": ok ? origin ?? "*" : "null", "access-control-allow-methods": "GET", vary: "origin", "cache-control": "public, max-age=900" };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const pin = (u.searchParams.get("pin") ?? "").trim();
  const origin = req.headers.get("origin");
  const ip = clientIp(req);
  if (!(await rateLimit(`edd:ip:${ip}`, 30, 60)).ok) return NextResponse.json({ error: "Too many checks. Try again in a minute." }, { status: 429 });
  const w = await eddConfigByKey(key);
  if (!w || !w.cfg.enabled) return NextResponse.json({ error: "Widget not active" }, { status: 404 });
  const h = cors(origin, w.cfg.allowedOrigins);
  if (w.cfg.allowedOrigins.length && origin && h["access-control-allow-origin"] === "null") return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers: h });
  if (!/^[1-9]\d{5}$/.test(pin)) return NextResponse.json({ error: "Enter a valid 6-digit PIN code" }, { status: 422, headers: h });
  if (!(await rateLimit(`edd:w:${key}`, 600, 60)).ok) return NextResponse.json({ error: "Busy. Try again shortly." }, { status: 429, headers: h });
  return NextResponse.json(await estimate(w.orgId, w.cfg, pin), { headers: h });
}
