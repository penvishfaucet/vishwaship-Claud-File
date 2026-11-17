/**
 * Starts the in-process job loop (local dev / single-instance). Node-only code lives in
 * instrumentation-node.ts so it is never bundled for the edge runtime.
 * In staging/production set WORKER_MODE=external and run `npm run worker` against PostgreSQL.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WORKER_MODE !== "external") {
    await import("./instrumentation-node");
  }
}
