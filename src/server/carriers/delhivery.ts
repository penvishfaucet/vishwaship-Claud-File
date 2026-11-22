import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";

/** Hosts the Delhivery adapters may call (enforced by safeFetch). */
export const DELHIVERY_HOSTS = { b2b: ["ltl-clients-api-dev.delhivery.com", "ltl-clients-api.delhivery.com"], b2c: ["staging-express.delhivery.com", "track.delhivery.com", "express-dev-test.delhivery.com"] };
const HOSTS = DELHIVERY_HOSTS;

/** The (single) Delhivery Direct account per service, created on first use in Admin. */
export async function ensureDelhiveryAccount(service: "b2b" | "b2c") {
  const db = await getDb();
  const adapter = `delhivery_${service}`;
  const [a] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, adapter), ne(schema.providerAccounts.status, "archived")));
  if (a) return a;
  const row = { id: newId("pa"), adapter, category: "shipping", label: `Delhivery Direct ${service.toUpperCase()}`, mode: "test", status: "disabled",
    configPublic: { allowedHosts: HOSTS[service], payments: { prepaid: true, cod: true, fod: false, fodStatus: service === "b2b" ? "pending_activation" : "not_supported", fodBasis: "carrier_freight" }, rateSource: "api", shippingMode: "S", volDivisor: service === "b2b" ? 3375 : 5000 } };
  await db.insert(schema.providerAccounts).values(row);
  return (await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, row.id)))[0];
}

