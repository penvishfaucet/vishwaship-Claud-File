/**
 * Load a store package (manifest.json + images) into a customer's account from the command line, using the same code
 * as Admin → Online Stores → Import package. Meant for local development and demos.
 *
 *   PGLITE_DIR=./.data/pglite npx tsx --tsconfig tsconfig.json --require ./scripts/stub-server-only.cjs \
 *     scripts/import-store-package.ts <packageDir> --customer <email|mobile|org id> [--slug penvish] [--demo-org "Name" --like <email>] [--publish]
 *
 * --demo-org creates a local customer org (with the same plan as --like) when it does not exist yet.
 * --publish publishes the imported draft at once (local demos only; on live the merchant reviews and publishes).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/server/db/client";
import { applyPackage, packageFiles, resolveCustomer, startPackageImport, uploadPackageMedia } from "../src/server/store/package";
import { newId } from "../src/server/util/ids";

const args = process.argv.slice(2);
const dir = args[0];
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i > 0 ? args[i + 1] : undefined; };
if (!dir) { console.error("Usage: import-store-package.ts <packageDir> --customer <ref> [...]"); process.exit(1); }

async function main() {
const db = await getDb();
let orgId: string | null = null;
const demo = opt("demo-org");
if (demo) {
  const like = await resolveCustomer(opt("like") ?? "");
  if (!like) throw new Error("--like customer not found");
  const [existing] = await db.select().from(schema.orgs).where(eq(schema.orgs.businessName, demo));
  orgId = existing?.id ?? newId("org");
  if (!existing) {
    await db.insert(schema.orgs).values({ id: orgId, name: demo, businessName: demo });
    await db.insert(schema.wallets).values({ id: newId("wal"), orgId });
    const [sub] = await db.select().from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.orgId, like));
    if (sub) await db.insert(schema.orgSubscriptions).values({ ...sub, id: newId("osub"), orgId });
    console.log("created demo org", orgId);
  }
} else orgId = await resolveCustomer(opt("customer") ?? "");
if (!orgId) throw new Error("Customer not found");

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const staff = "script";
const start = await startPackageImport(orgId, staff, manifest, opt("slug"));
console.log(`store /s/${start.slug} (${start.created ? "new" : "existing"}), ${start.products} products, ${start.files.length} images`);
const media: Record<string, string> = {};
const files = packageFiles(manifest);
for (let i = 0; i < files.length; i += 25) {
  Object.assign(media, await uploadPackageMedia(orgId, files.slice(i, i + 25).map((name) => ({ name, data: readFileSync(join(dir, name)) }))));
  process.stdout.write(`\rimages ${Math.min(i + 25, files.length)}/${files.length}`);
}
console.log();
const r = await applyPackage(orgId, staff, manifest, media);
console.log(r);
if (args.includes("--publish")) {
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, start.storeId));
  await db.update(schema.stores).set({ status: "live", publishedTheme: s.draftTheme, publishedAt: new Date() }).where(eq(schema.stores.id, s.id));
  console.log(`published: /s/${s.slug}/`);
}
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
