import "server-only";
import { jobsHeartbeat } from "./heartbeat";

/**
 * Safety net for hosts that pause or restart the Node process (the 15-second loop in instrumentation-node.ts then may
 * not be running): when the loop has been silent for 90 seconds, a portal / admin page visit runs one round of sweeps
 * and due jobs after the response is sent. At most one round at a time per process.
 */
const g = globalThis as unknown as { __vsKick?: boolean };
export async function kickJobsIfIdle() {
  if (process.env.WORKER_MODE === "external" || g.__vsKick) return;
  const last = jobsHeartbeat.tickAt?.getTime() ?? 0;
  if (Date.now() - last < 90_000) return;
  g.__vsKick = true;
  jobsHeartbeat.tickAt = new Date();
  try {
    const { scheduleSweeps } = await import("./handlers");
    const { runDueJobs } = await import("./runner");
    try { await scheduleSweeps(); } catch (e) { console.error("[jobs kick] sweeps", (e as Error).message); }
    jobsHeartbeat.lastRan = await runDueJobs(40);
    jobsHeartbeat.doneAt = new Date();
  } catch (e) { console.error("[jobs kick]", (e as Error).message); }
  finally { g.__vsKick = false; }
}
