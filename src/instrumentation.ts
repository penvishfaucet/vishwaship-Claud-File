/**
 * Runs once when the Node.js server starts.
 * 1. With DATABASE_URL (staging/production): apply migrations + owner bootstrap before serving requests
 *    (hosts like Hostinger don't run the `prestart` hook).
 * 2. Starts the in-process job loop (single instance). Node-only code lives in instrumentation-node.ts
 *    so it is never bundled for the edge runtime. Set WORKER_MODE=external to run `npm run worker` instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DATABASE_URL) {
    const { runRelease } = await import("./server/db/release");
    try {
      await runRelease();
    } catch (e) {
      console.error("[release] FAILED:", (e as Error).message);
    }
  }
  if (process.env.WORKER_MODE !== "external") {
    await import("./instrumentation-node");
  }
}
