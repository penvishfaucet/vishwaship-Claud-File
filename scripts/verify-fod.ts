/**
 * Local check of the FOD (freight on delivery) money flow with the demo courier standing in for Delhivery B2B.
 * Stop `npm run dev` first (PGlite is single-process). Run: npx tsx --tsconfig tsconfig.json --require ./scripts/stub-server-only.cjs scripts/verify-fod.ts
 * Temporarily marks the demo account FOD-capable and active, then restores it. Local demo database only.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { createOrder } from "@/server/orders/create";
import { getQuotes } from "@/server/quotes/service";
import { bookOrder } from "@/server/booking/service";
import { demoAdapter } from "@/server/providers/demo";

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL) throw new Error("Local demo database only");
  const ORG = "org_demo_a";
  const db = await getDb();
  const results: Array<[string, boolean, string]> = [];
  const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.adapter, "demo"));
  const original = acct.configPublic;
  const setPay = (payments: Record<string, unknown>) => db.update(schema.providerAccounts).set({ configPublic: { ...(original as object), payments } }).where(eq(schema.providerAccounts.id, acct.id));
  const savedModes = demoAdapter.paymentModes;
  demoAdapter.paymentModes = ["prepaid", "cod", "fod"];
  const req = { mode: "B2C" as const, originPincode: "110034", destinationPincode: "400001", paymentType: "fod" as const, declaredValue: 150_000, direction: "forward" as const, packages: [{ count: 1, lengthMm: 200, breadthMm: 150, heightMm: 100, actualWeightGrams: 800 }] };
  try {
    await setPay({ prepaid: true, cod: true, fod: true, fodStatus: "pending_activation", fodBasis: "carrier_freight" });
    const pending = await getQuotes(req, ORG, { persist: false });
    check("FOD not quoted while pending Delhivery activation", pending.offers.length === 0 && pending.errors.some((e) => /pending/i.test(e)), pending.errors[0]);

    await setPay({ prepaid: true, cod: true, fod: true, fodStatus: "active", fodBasis: "carrier_freight" });
    const { offers } = await getQuotes(req, ORG);
    const o = offers[0];
    check("FOD quoted once active, with payer split", !!o && o.payer.receiver > 0 && o.payer.sender + o.payer.receiver === o.total, o ? `receiver ₹${o.payer.receiver / 100}, sender ₹${o.payer.sender / 100}, total ₹${o.total / 100}` : "no offer");

    const created = await createOrder(ORG, { orderNumber: `E2E-FOD-${Date.now().toString(36).toUpperCase()}`, mode: "B2C", direction: "forward", paymentType: "fod", codAmountRupees: 0, declaredValueRupees: 1500, warehouseId: "wh_org_demo_a",
      consignee: { name: "Test Receiver", mobile: "9811100099", line1: "1 Test Street", pincode: "400001", city: "Mumbai", state: "Maharashtra" }, products: [{ name: "Item", qty: 1, unitPriceRupees: 1500 }], packages: [{ count: 1, lengthCm: 20, breadthCm: 15, heightCm: 10, weightKg: 0.8 }] });
    if (!created.ok) throw new Error(created.message);
    const [w0] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, ORG));
    const before = w0.postedPaise;
    const b = await bookOrder({ orgId: ORG, orderId: created.orderId, quoteId: o.quoteId, actorUserId: "script" });
    const [w1] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, ORG));
    const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, created.orderId));
    check("FOD booking succeeds", b.ok, b.ok ? `AWB ${b.awb}` : b.message);
    check("Sender wallet charged only the sender share (margin), not the freight", before - w1.postedPaise === o.payer.sender, `charged ₹${(before - w1.postedPaise) / 100}`);
    check("Shipment records receiver-paid freight separately", sh?.freightPayer === "receiver" && sh.receiverFreightPaise === o.payer.receiver && sh.fodStatus === "pending_collection" && sh.sellPaise === o.payer.sender, `${sh?.freightPayer} ₹${(sh?.receiverFreightPaise ?? 0) / 100} ${sh?.fodStatus}`);

    await setPay({ prepaid: true, cod: true, fod: false, fodStatus: "active", fodBasis: "carrier_freight" });
    const created2 = await createOrder(ORG, { orderNumber: `E2E-FOD2-${Date.now().toString(36).toUpperCase()}`, mode: "B2C", direction: "forward", paymentType: "fod", codAmountRupees: 0, declaredValueRupees: 1500, warehouseId: "wh_org_demo_a",
      consignee: { name: "Test Receiver", mobile: "9811100098", line1: "1 Test Street", pincode: "400001", city: "Mumbai", state: "Maharashtra" }, products: [{ name: "Item", qty: 1, unitPriceRupees: 1500 }], packages: [{ count: 1, lengthCm: 20, breadthCm: 15, heightCm: 10, weightKg: 0.8 }] });
    if (!created2.ok) throw new Error(created2.message);
    // try to book with a still-valid FOD quote after Admin switched FOD off → backend must refuse
    await setPay({ prepaid: true, cod: true, fod: true, fodStatus: "active", fodBasis: "carrier_freight" });
    const { offers: o2 } = await getQuotes(req, ORG);
    await setPay({ prepaid: true, cod: true, fod: false, fodStatus: "active", fodBasis: "carrier_freight" });
    const b2 = await bookOrder({ orgId: ORG, orderId: created2.orderId, quoteId: o2[0].quoteId, actorUserId: "script" });
    check("Backend refuses FOD booking once Admin disables FOD", !b2.ok && /switched off/i.test(b2.message), b2.ok ? "booked!" : b2.message);
    const [o2row] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, created2.orderId)));
    check("Refused order is not marked booked", o2row.status === "ready", o2row.status);
  } finally {
    demoAdapter.paymentModes = savedModes;
    await db.update(schema.providerAccounts).set({ configPublic: original }).where(eq(schema.providerAccounts.id, acct.id));
  }
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
