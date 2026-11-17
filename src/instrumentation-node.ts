import { runDueJobs } from "./server/jobs/runner";
import { scheduleSweeps } from "./server/jobs/handlers";

const g = globalThis as unknown as { __vsWorker?: boolean };
if (!g.__vsWorker) {
  g.__vsWorker = true;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await scheduleSweeps(); await runDueJobs(); } catch (e) { console.error("[jobs]", (e as Error).message); } finally { busy = false; }
  }, 15_000);
}
