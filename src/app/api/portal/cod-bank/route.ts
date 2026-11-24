import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { payoutAccount, savePayoutAccount } from "@/server/cod/payouts";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";

const Body = z.object({ holderName: z.string().trim().min(2).max(120), accountNumber: z.string().trim().min(9).max(24), confirmAccount: z.string().trim(), ifsc: z.string().trim().min(11).max(11), bankName: z.string().trim().max(80).optional() });

/** The client's COD payout bank account (account number stored encrypted; only the last 4 digits are ever shown). */
export async function GET() {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  return NextResponse.json({ account: await payoutAccount(s.orgId) });
}

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  if (p.data.accountNumber.replace(/[\s-]/g, "") !== p.data.confirmAccount.replace(/[\s-]/g, "")) return apiError(422, "validation_error", "The two account numbers do not match");
  let saved;
  try { saved = await savePayoutAccount(s.orgId, p.data, s.userId); } catch (e) { return apiError(422, "validation_error", (e as Error).message); }
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "cod.payout_account_set", details: { last4: saved.last4, ifsc: saved.ifsc } });
  const db = await getDb();
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: s.orgId, kind: "cod", title: `COD payout bank account changed to ••••${saved.last4} (${saved.ifsc}). Not you? Contact support now.`, href: "/portal/settings/cod-bank/" });
  return NextResponse.json({ ok: true, account: saved, message: "Bank account saved. Your COD will be paid here." });
}
