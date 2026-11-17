import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";

/**
 * Postgres-backed job queue (table `jobs`). Claims use FOR UPDATE SKIP LOCKED so several workers
 * can run safely. Failures back off exponentially; after MAX_ATTEMPTS a job is "dead" and shown in
 * the admin exception queue for manual replay. Redis/BullMQ can replace this without changing
 * handlers (same enqueue/handler contract).
 */
export const MAX_ATTEMPTS = 8;

export type JobResult = { done: true } | { retryInSec: number; error?: string } | { dead: string };
export type Handler = (payload: Record<string, unknown>, attempt: number) => Promise<JobResult>;

const handlers = new Map<string, Handler>();
export function registerHandler(queue: string, h: Handler) { handlers.set(queue, h); }

export async function enqueue(queue: string, payload: Record<string, unknown>, opts: { dedupeKey?: string; runAt?: Date } = {}) {
  const db = await getDb();
  await db.insert(schema.jobs).values({ id: newId("job"), queue, payload, dedupeKey: opts.dedupeKey, runAt: opts.runAt ?? new Date() }).onConflictDoNothing();
}

async function claim() {
  const db = await getDb();
  const r = await db.execute(sql`
    update ${schema.jobs} set status = 'running', attempts = attempts + 1
    where id = (select id from ${schema.jobs} where status = 'queued' and run_at <= now() order by run_at limit 1 for update skip locked)
    returning id, queue, payload, attempts`);
  return (r as unknown as { rows: Array<{ id: string; queue: string; payload: Record<string, unknown>; attempts: number }> }).rows[0] ?? null;
}

/** Process up to `max` due jobs. Returns how many ran. */
export async function runDueJobs(max = 20) {
  const db = await getDb();
  let n = 0;
  for (; n < max; n++) {
    const job = await claim();
    if (!job) break;
    const h = handlers.get(job.queue);
    let res: JobResult;
    try {
      res = h ? await h(job.payload, job.attempts) : { dead: `No handler for ${job.queue}` };
    } catch (e) {
      res = { retryInSec: Math.min(3600, 30 * 2 ** job.attempts), error: (e as Error).message };
    }
    if ("done" in res) {
      await db.update(schema.jobs).set({ status: "done", lastError: null }).where(eq(schema.jobs.id, job.id));
    } else if ("dead" in res || job.attempts >= MAX_ATTEMPTS) {
      await db.update(schema.jobs).set({ status: "dead", lastError: "dead" in res ? res.dead : res.error ?? "max attempts" }).where(eq(schema.jobs.id, job.id));
    } else {
      await db.update(schema.jobs).set({ status: "queued", runAt: new Date(Date.now() + res.retryInSec * 1000), lastError: res.error ?? null }).where(and(eq(schema.jobs.id, job.id)));
    }
  }
  return n;
}

/** Admin "replay" of a dead job: requeue it now with attempts reset. */
export async function replayJob(id: string) {
  const db = await getDb();
  await db.update(schema.jobs).set({ status: "queued", attempts: 0, runAt: new Date() }).where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "dead")));
}
