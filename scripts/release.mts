/**
 * Runs before `npm start` (prestart). With DATABASE_URL: migrations + owner bootstrap (same code the web
 * app runs on start, src/server/db/release.ts). Without it (local demo): migrates the embedded PGlite DB.
 */
import { connect } from "./db.mts";

if (process.env.DATABASE_URL) {
  const { runRelease } = await import("../src/server/db/release.ts");
  await runRelease();
} else {
  const c = await connect();
  await c.migrate();
  console.log("[release] migrations applied (PGlite)");
  await c.close();
}
