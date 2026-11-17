/**
 * Runs before `npm start` (prestart). With DATABASE_URL: migrations + owner bootstrap (same code the web
 * app runs on start, src/server/db/release.ts). Without it (local demo): migrates the embedded PGlite DB.
 */
import { connect } from "./db.mts";

if (process.env.DATABASE_URL) {
  // release.ts is compiled as CommonJS here (package has no "type": "module"), so its exports sit under "default".
  const mod = (await import("../src/server/db/release.ts")) as { runRelease?: () => Promise<void>; default?: { runRelease: () => Promise<void> } };
  await (mod.runRelease ?? mod.default!.runRelease)();
} else {
  const c = await connect();
  await c.migrate();
  console.log("[release] migrations applied (PGlite)");
  await c.close();
}
