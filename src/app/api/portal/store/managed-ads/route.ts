import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { run, storeGuard } from "@/server/store/api";
import { MERCHANT_ITEMS, acceptTerms, decideChange, payDeposit, requestDepositRefund, setAdsStatus, setChecklistItem } from "@/server/store/billing";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("terms"), version: z.number().int().min(1), monthlyCapRupees: z.coerce.number() }),
  z.object({ action: z.literal("check"), key: z.enum(MERCHANT_ITEMS), done: z.boolean() }),
  z.object({ action: z.literal("deposit"), idem: z.string().min(8).max(80) }),
  z.object({ action: z.literal("refund"), reason: z.string().max(500).default("") }),
  z.object({ action: z.literal("status"), to: z.enum(["paused", "ended"]) }),
  z.object({ action: z.literal("decide"), changeId: z.string().max(60), approve: z.boolean(), confirm: z.boolean().default(false), note: z.string().max(500).default("") }),
]);
/** Actions that commit the merchant (money, terms, spend approval): never done by staff while impersonating. */
const MERCHANT_ONLY = new Set(["terms", "deposit", "refund", "decide"]);

export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-ads:${g.s.orgId}`, 40, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const p = await parseJson(req, Body); if (!p.ok) return p.res;
  const b = p.data;
  if (g.s.impersonatorId && MERCHANT_ONLY.has(b.action)) return apiError(403, "forbidden", "Only the merchant can accept terms, pay or approve ad spend");
  const actor = { userId: g.s.userId, kind: g.s.impersonatorId ? "staff" as const : "customer" as const };
  const orgId = g.s.orgId;
  return run(async () => {
    switch (b.action) {
      case "terms": await acceptTerms(orgId, actor, b.version, b.monthlyCapRupees); return { ok: true };
      case "check": await setChecklistItem(orgId, actor, b.key, b.done); return { ok: true };
      case "deposit": { const r = await payDeposit(orgId, actor, b.idem); return { ok: true, receipt: r.dep.receiptNumber, id: r.dep.id }; }
      case "refund": await requestDepositRefund(orgId, actor, b.reason); return { ok: true };
      case "status": await setAdsStatus(orgId, actor, b.to); return { ok: true };
      case "decide": await decideChange(orgId, actor, b.changeId, b.approve, b.confirm, b.note); return { ok: true };
    }
  });
}
