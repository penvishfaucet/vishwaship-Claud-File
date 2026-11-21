import { NextResponse } from "next/server";
import { REF_COOKIE, REF_DAYS, activeFranchiseByCode } from "@/server/franchise/referral";

export const dynamic = "force-dynamic";

/** Franchise referral link: remember the code for 30 days, then open Sign up. Unknown or inactive codes just open Sign up. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const f = await activeFranchiseByCode(decodeURIComponent(code));
  const res = NextResponse.redirect(new URL("/signup/", req.url), 302);
  if (f) {
    res.cookies.set(REF_COOKIE, f.code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: REF_DAYS * 86400 });
  }
  return res;
}
