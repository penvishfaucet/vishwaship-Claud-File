/**
 * Launch offer (owner 2026-11-26): every client gets the first month FREE — WhatsApp COD confirmation (sent from
 * Vishwaship's WhatsApp number), every other WhatsApp update, AI NDR calling, and all Online Store / website features
 * (plan, platform fee, buyer OTP). Charging starts only after the free month.
 *
 * Window per client: starts at the later of the offer start date and the client's signup, and lasts `days` days.
 * So existing clients get a month from the launch, and new clients a month from signup.
 */
export type FreeTrialConfig = { enabled: boolean; days: number; startsOn: string };
export const FREE_TRIAL_DEFAULTS: FreeTrialConfig = { enabled: true, days: 30, startsOn: "2026-11-26" };

/** IST midnight of a yyyy-mm-dd date. */
const istMidnight = (d: string) => new Date(`${d}T00:00:00+05:30`);

export function freeTrialWindow(cfg: FreeTrialConfig, orgCreatedAt: Date): { from: Date; until: Date } | null {
  if (!cfg.enabled || cfg.days <= 0) return null;
  const start = istMidnight(cfg.startsOn);
  if (Number.isNaN(start.getTime())) return null;
  const from = new Date(Math.max(start.getTime(), orgCreatedAt.getTime()));
  return { from, until: new Date(from.getTime() + cfg.days * 86_400_000) };
}

export function inFreeTrial(cfg: FreeTrialConfig, orgCreatedAt: Date, at = new Date()): boolean {
  const w = freeTrialWindow(cfg, orgCreatedAt);
  return !!w && at >= w.from && at < w.until;
}
