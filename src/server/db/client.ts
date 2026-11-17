import "server-only";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * DATABASE_URL=postgres://...  -> real PostgreSQL (staging/production)
 * DATABASE_URL unset            -> embedded PGlite in ./.data/pglite (local dev/demo only)
 */
type DB = ReturnType<typeof drizzlePglite<typeof schema>>;

const g = globalThis as unknown as { __vsDb?: Promise<DB> };

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 10 });
    return drizzlePg(pool, { schema }) as unknown as DB;
  }
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(".data", { recursive: true });
  const client = new PGlite(process.env.PGLITE_DIR ?? "./.data/pglite");
  return drizzlePglite(client, { schema });
}

export function getDb(): Promise<DB> {
  g.__vsDb ??= create();
  return g.__vsDb;
}

export { schema };
