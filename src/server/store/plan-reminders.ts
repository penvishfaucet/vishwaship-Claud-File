import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { planState } from "@/lib/store-plan";
import { orgSetting, saveOrgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";

/**
 * Online Store plan reminders through the existing channels (portal bell + email to the account): 7, 3 and 1 day(s)
 * before the trial / plan ends, and once when it has ended. Each reminder is sent once per end date.
 */
const KEY = "store_plan_reminders";
const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");
const day = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export async function sweepPlanReminders(now = new Date()) {
  const db = await getDb();
  const stores = await db.select().from(schema.stores).where(eq(schema.stores.status, "live")).limit(5000);
  let sent = 0;
  for (const s of stores) {
    const st = planState(s, now);
    if (!st.until) continue;
    const ended = st.state === "expired";
    if (ended && now.getTime() - st.until.getTime() > 3 * 86_400_000) continue; // only right after it ended
    const bucket = ended ? 0 : st.daysLeft <= 1 ? 1 : st.daysLeft <= 3 ? 3 : st.daysLeft <= 7 ? 7 : null;
    if (bucket === null) continue;
    const mark = `${st.until.toISOString().slice(0, 10)}:${bucket}`;
    const prev = (await orgSetting<{ sent: string[] }>(s.orgId, KEY))?.sent ?? [];
    if (prev.includes(mark)) continue;
    await saveOrgSetting(s.orgId, KEY, { sent: [...prev, mark].slice(-12) });
    const what = st.state === "trial" || (ended && !s.paidUntil) ? "free trial" : "plan";
    const title = ended
      ? `Your Online Store ${what} has ended: buyers now see "store unavailable". Renew to reopen at once.`
      : `Your Online Store ${what} ends on ${day(st.until)} (${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"} left). Renew to keep the store open.`;
    await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: s.orgId, kind: "billing", title: title.slice(0, 200), href: "/portal/store/plan/" });
    const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(and(eq(schema.users.orgId, s.orgId), eq(schema.users.kind, "customer"))).orderBy(asc(schema.users.createdAt)).limit(1);
    if (u?.email) {
      try {
        const { sendEmail } = await import("@/server/email/service");
        await sendEmail({ event: "store_plan_reminder", to: u.email, toKind: "client", orgId: s.orgId, dedupeKey: `store_plan:${s.id}:${mark}`,
          vars: { customer_name: u.name ?? "", store_name: s.name, message: title, tracking_link: `${appUrl()}/portal/store/plan/` } });
      } catch (e) { console.error("[store plan reminder]", (e as Error).message); }
    }
    sent++;
  }
  return sent;
}
