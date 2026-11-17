/** Script-side DB connection (no "server-only" import so tsx can run it). */
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schemaNs from "../src/server/db/schema.ts";

// schema.ts is compiled as CommonJS (package has no "type": "module"); unwrap the default export.
const schema = ((schemaNs as unknown as { default?: typeof schemaNs }).default ?? schemaNs) as typeof schemaNs;

export async function connect() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 2 });
    const db = drizzlePg(pool, { schema });
    return { db, migrate: () => migratePg(db, { migrationsFolder: "migrations" }), close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(".data", { recursive: true });
  const client = new PGlite(process.env.PGLITE_DIR ?? "./.data/pglite");
  const db = drizzlePglite(client, { schema });
  return { db, migrate: () => migratePglite(db, { migrationsFolder: "migrations" }), close: () => client.close() };
}

export { schema };
