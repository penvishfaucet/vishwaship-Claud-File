import { NextResponse } from "next/server";
import { publicOrigin } from "@/server/public-origin";
import { storeAudit, storeGuard } from "@/server/store/api";
import { checkState, completeMetaConnect } from "@/server/store/meta-connect";

/** Meta redirects here after "Connect with Facebook". The state must be ours and for this same account. */
export async function GET(req: Request) {
  const back = new URL("/portal/store/marketing/", publicOrigin(req));
  const g = await storeGuard();
  if (g.err) return NextResponse.redirect(new URL("/login/?next=/portal/store/marketing/", publicOrigin(req)));
  const sp = new URL(req.url).searchParams;
  const code = sp.get("code"), state = sp.get("state") ?? "";
  if (!code || !checkState(state, g.s.orgId)) {
    back.searchParams.set("err", sp.get("error_description")?.slice(0, 150) || "Facebook connection was cancelled or expired. Please try again.");
    return NextResponse.redirect(back);
  }
  const r = await completeMetaConnect(g.s.orgId, g.s.userId, code);
  await storeAudit(g.s, "meta.connect", undefined, { ok: r.ok });
  back.searchParams.set(r.ok ? "ok" : "err", r.ok ? "Facebook connected. Now choose your page and ad account." : r.message);
  return NextResponse.redirect(back);
}
