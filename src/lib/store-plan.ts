import { rupees } from "./store-themes";
/** Where a store's billing stands. Pure, so the storefront and checkout can use it without the billing service. */
export type PlanState = { state: "trial" | "active" | "expired"; until: Date | null; daysLeft: number; ordersOpen: boolean };

/** A paid period wins over the trial; no trial date (rows from before billing existed) counts as trial. */
export function planState(s: { trialEndsAt: Date | null; paidUntil: Date | null }, now = new Date()): PlanState {
  const days = (d: Date) => Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86400_000));
  if (s.paidUntil && s.paidUntil > now) return { state: "active", until: s.paidUntil, daysLeft: days(s.paidUntil), ordersOpen: true };
  if (!s.trialEndsAt) return { state: "trial", until: null, daysLeft: 0, ordersOpen: true };
  if (s.trialEndsAt > now) return { state: "trial", until: s.trialEndsAt, daysLeft: days(s.trialEndsAt), ordersOpen: true };
  return { state: "expired", until: s.paidUntil && s.paidUntil > s.trialEndsAt ? s.paidUntil : s.trialEndsAt, daysLeft: 0, ordersOpen: false };
}

export const ORDERS_PAUSED_TEXT = "This store is not taking new orders right now. It will reopen soon.";

/** "₹500 a day (about ₹15,000 a month), up to ₹10,000 in total from 2026-12-01" — what a merchant approves. */
export const budgetText = (c: { dailyBudgetPaise: number | null; totalBudgetPaise: number | null; startDate: string | null; endDate: string | null }) =>
  [c.dailyBudgetPaise ? `${rupees(c.dailyBudgetPaise)} a day (about ${rupees(c.dailyBudgetPaise * 30)} a month)` : null, c.totalBudgetPaise ? `${rupees(c.totalBudgetPaise)} in total` : null]
    .filter(Boolean).join(", up to ") + (c.startDate ? ` from ${ymd(c.startDate)}${c.endDate ? ` to ${ymd(c.endDate)}` : ""}` : "");
const ymd = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
