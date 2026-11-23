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
    update ${schema.jobs} set status = 'running', attempts = attempts + 1, run_at = now()
    where id = (select id from ${schema.jobs} where status = 'queued' and run_at <= now() order by run_at limit 1 for update skip locked)
    returning id, queue, payload, attempts`);
  return (r as unknown as { rows: Array<{ id: string; queue: string; payload: Record<string, unknown>; attempts: number }> }).rows[0] ?? null;
}

/** A job that has not finished after this long is treated as failed and retried (a hung network call never blocks the queue). */
export const JOB_TIMEOUT_MS = 120_000;
const withTimeout = <T,>(p: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)} s`)), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

/** Process up to `max` due jobs, `concurrency` at a time (one at a time on local PGlite, a single connection). Returns how many ran. */
export async function runDueJobs(max = 20, concurrency = process.env.DATABASE_URL ? 5 : 1) {
  let n = 0;
  const lane = async () => { while (n < max) { n++; if (!(await runOne())) { n--; return; } } };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
  return n;
}

async function runOne(): Promise<boolean> {
  const db = await getDb();
  {
    const job = await claim();
    if (!job) return false;
    const h = handlers.get(job.queue);
    let res: JobResult;
    try {
      res = h ? await withTimeout(h(job.payload, job.attempts), JOB_TIMEOUT_MS) : { dead: `No handler for ${job.queue}` };
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
  return true;
}

/**
 * Jobs left "running" by a server restart or a hung call would never run again: put them back in the queue
 * (attempts already counted) after 10 minutes.
 */
export async function requeueStuckJobs() {
  const db = await getDb();
  const r = await db.execute(sql`update ${schema.jobs} set status = 'queued', run_at = now(), last_error = 'Requeued: was running for over 10 minutes'
    where status = 'running' and run_at < now() - interval '10 minutes' returning id`);
  return ((r as unknown as { rows?: unknown[] }).rows ?? []).length;
}

/** Admin "replay" of a dead job: requeue it now with attempts reset. */
export async function replayJob(id: string) {
  const db = await getDb();
  await db.update(schema.jobs).set({ status: "queued", attempts: 0, runAt: new Date() }).where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "dead")));
}
