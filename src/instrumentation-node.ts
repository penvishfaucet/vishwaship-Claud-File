import { runDueJobs } from "./server/jobs/runner";
import { scheduleSweeps } from "./server/jobs/handlers";
import { jobsHeartbeat } from "./server/jobs/heartbeat";

/**
 * In-process background loop (every 15 s): schedule the periodic sweeps (tracking polls, COD, store …), then run due jobs.
 * Sweeps and jobs fail independently, and a tick that hangs (a stuck network call) no longer blocks every later tick:
 * after 4 minutes the next tick runs anyway (jobs are claimed with SKIP LOCKED, so overlapping ticks are safe).
 */
const g = globalThis as unknown as { __vsWorker?: boolean };
const STUCK_MS = 4 * 60_000;
if (!g.__vsWorker) {
  g.__vsWorker = true;
  let runningSince = 0;
  setInterval(async () => {
    if (runningSince && Date.now() - runningSince < STUCK_MS) return;
    if (runningSince) console.error("[jobs] previous tick still running after 4 min; starting a new one");
    const me = Date.now();
    runningSince = me;
    jobsHeartbeat.tickAt = new Date(me); jobsHeartbeat.lastError = null;
    try { await scheduleSweeps(); } catch (e) { jobsHeartbeat.lastError = `sweeps: ${(e as Error).message}`.slice(0, 200); console.error("[jobs] sweeps", (e as Error).message); }
    try { jobsHeartbeat.lastRan = await runDueJobs(40); } catch (e) { jobsHeartbeat.lastError = `jobs: ${(e as Error).message}`.slice(0, 200); console.error("[jobs]", (e as Error).message); }
    jobsHeartbeat.doneAt = new Date();
    if (runningSince === me) runningSince = 0;
  }, 15_000);
}
