import { connect } from "./db.mts";

const c = await connect();
await c.migrate();
console.log(`Migrations applied (${process.env.DATABASE_URL ? "PostgreSQL" : "PGlite ./.data/pglite"}).`);
await c.close();
