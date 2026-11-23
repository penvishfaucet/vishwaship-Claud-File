import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { jobsHeartbeat } from "@/server/jobs/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Is the background loop alive? (tracking polls, emails, WhatsApp, COD …). Counts and times only — no data, no errors.
 * ok = the loop ticked in the last 2 minutes and nothing has waited in the queue for more than 15 minutes.
 */
export async function GET() {
  const db = await getDb();
  const [q] = await db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${schema.jobs.runAt})` }).from(schema.jobs)
    .where(and(eq(schema.jobs.status, "queued"), sql`${schema.jobs.runAt} <= now()`));
  const [t] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.jobs).where(and(eq(schema.jobs.status, "queued"), eq(schema.jobs.queue, "tracking.poll")));
  const waitMin = q.oldest ? Math.round((Date.now() - new Date(q.oldest).getTime()) / 60_000) : 0;
  const tickAgoSec = jobsHeartbeat.tickAt ? Math.round((Date.now() - jobsHeartbeat.tickAt.getTime()) / 1000) : null;
  const ok = tickAgoSec !== null && tickAgoSec < 120 && waitMin < 15;
  return NextResponse.json({
    ok, loop: { lastTickSecondsAgo: tickAgoSec, lastTickJobs: jobsHeartbeat.lastRan, lastTickHadError: !!jobsHeartbeat.lastError },
    tracking: { lastScheduledAt: jobsHeartbeat.trackingSlotAt?.toISOString() ?? null, scheduledLastTime: jobsHeartbeat.trackingQueued, waiting: t.n },
    queue: { dueNow: q.n, oldestWaitMinutes: waitMin },
  }, { headers: { "cache-control": "no-store" } });
}
