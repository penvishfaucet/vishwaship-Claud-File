/**
 * Standalone worker for staging/production (PostgreSQL only):
 *   WORKER_MODE=external on the web app, then: npm run worker
 */
import { runDueJobs } from "./runner";
import { scheduleSweeps } from "./handlers";

if (!process.env.DATABASE_URL) {
  console.error("The standalone worker needs DATABASE_URL (PGlite cannot be shared between processes). Locally, jobs run inside `npm run dev`.");
  process.exit(1);
}
console.log("Vishwaship worker started");
for (;;) {
  try {
    await scheduleSweeps();
    const n = await runDueJobs(50);
    if (n === 0) await new Promise((r) => setTimeout(r, 5_000));
  } catch (e) {
    console.error("[worker]", (e as Error).message);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
