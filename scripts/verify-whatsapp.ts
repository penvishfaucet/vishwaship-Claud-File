/**
 * Local end-to-end check of the WhatsApp flows against the demo database (PGlite).
 * Stop `npm run dev` first (PGlite is single-process), then:
 *   npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/verify-whatsapp.ts
 * Creates clearly-named test orders for demo customer A only. Never run against production.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { runDueJobs } from "@/server/jobs/runner";
import "@/server/jobs/handlers";
import { createOrder } from "@/server/orders/create";
import { getQuotes } from "@/server/quotes/service";
import { bookOrder } from "@/server/booking/service";
import { ingestEvents } from "@/server/tracking/service";
import { handleWatiWebhook, sweepNoResponse } from "@/server/whatsapp/service";

async function main() {
if (process.env.NODE_ENV === "production" || process.env.DATABASE_URL) { console.error("Local demo database only."); process.exit(1); }

const ORG = "org_demo_a";
const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`); };
const drain = async () => { for (let i = 0; i < 6; i++) if ((await runDueJobs(50)) === 0) break; };
const db = await getDb();
const run = Date.now().toString(36).toUpperCase();

async function codOrder(tag: string, mobile: string) {
  const r = await createOrder(ORG, {
    orderNumber: `E2E-${tag}-${run}`, mode: "B2C", direction: "forward", paymentType: "cod", codAmountRupees: 999, declaredValueRupees: 999, warehouseId: "wh_org_demo_a",
    consignee: { name: "Test Buyer", mobile, line1: "12 MG Road, Sector 4", pincode: "400001", city: "Mumbai", state: "Maharashtra" },
    products: [{ name: "Test item", qty: 1, unitPriceRupees: 999 }], packages: [{ count: 1, lengthCm: 20, breadthCm: 15, heightCm: 5, weightKg: 0.5 }],
  });
  if (!r.ok) throw new Error(r.message);
  return r.orderId;
}
async function book(orderId: string) {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  const pk = await db.select().from(schema.packages).where(eq(schema.packages.orderId, orderId));
  const { offers } = await getQuotes({ mode: "B2C", originPincode: "110034", destinationPincode: "400001", paymentType: "cod", codAmount: o.codAmountPaise, declaredValue: o.declaredValuePaise, direction: "forward",
    packages: pk.map((p) => ({ count: p.count, lengthMm: p.lengthMm, breadthMm: p.breadthMm, heightMm: p.heightMm, actualWeightGrams: p.actualWeightGrams })) }, ORG);
  const offer = offers.find((x) => x.isDemo) ?? offers[0];
  const r = await bookOrder({ orgId: ORG, orderId, quoteId: offer.quoteId, actorUserId: "script" });
  if (!r.ok) throw new Error(`book: ${r.message}`);
  const [s] = await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId));
  return s;
}
const conf = async (orderId: string) => (await db.select().from(schema.codConfirmations).where(eq(schema.codConfirmations.orderId, orderId)))[0];
const reply = (mobile: string, text: string, id: string) => handleWatiWebhook({ eventType: "message", waId: `91${mobile}`, id, type: "button", buttonReply: { text, payload: text } });
const refunds = async (shipmentId: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.refId, shipmentId), eq(schema.ledgerEntries.kind, "refund_credit"))))[0].n;
async function lateCancelSetup(tag: string, mobile: string) {
  const orderId = await codOrder(tag, mobile);
  await drain();
  await db.update(schema.codConfirmations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.codConfirmations.orderId, orderId));
  await sweepNoResponse();
  const ship = await book(orderId);
  return { orderId, ship };
}

const [cfgRow] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "cod_confirmation"));
await db.insert(schema.pricingSettings).values({ key: "cod_confirmation", value: { reminderMinutes: 120, expiryMinutes: 1440, noReply: "release", credits: 2 } })
  .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: { reminderMinutes: 120, expiryMinutes: 1440, noReply: "release", credits: 2 } } });
const [demoAcct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.adapter, "demo"));

try {
  // 1. Out for Delivery: one message per shipment per day, even if the status arrives twice.
  {
    const orderId = await codOrder("OFD", "9811100001");
    await drain();
    await db.update(schema.codConfirmations).set({ status: "confirmed", decidedAt: new Date() }).where(eq(schema.codConfirmations.orderId, orderId));
    await db.update(schema.orders).set({ status: "ready" }).where(eq(schema.orders.id, orderId));
    const ship = await book(orderId);
    const ev = { status: "out_for_delivery" as const, rawStatus: "OUT FOR DELIVERY", location: "Mumbai DC", occurredAt: new Date().toISOString() };
    await ingestEvents(ship.id, [ev], "manual");
    await ingestEvents(ship.id, [{ ...ev, occurredAt: new Date(Date.now() + 1000).toISOString() }], "manual");
    await drain();
    const msgs = await db.select().from(schema.whatsappMessages).where(and(eq(schema.whatsappMessages.shipmentId, ship.id), eq(schema.whatsappMessages.event, "out_for_delivery")));
    check("OFD message sent once for a duplicate status", msgs.length === 1 && msgs[0].status === "sent", `${msgs.length} row(s), status ${msgs[0]?.status}`);
  }

  // 2. Plan gating: customer B has no plan → OFD is skipped (recorded, not sent, no credits).
  {
    const [shipB] = await db.select().from(schema.shipments).where(and(eq(schema.shipments.orgId, "org_demo_b"), eq(schema.shipments.bookingStatus, "confirmed")));
    if (shipB) {
      await db.update(schema.shipments).set({ status: "at_delivery_center" }).where(eq(schema.shipments.id, shipB.id));
      await ingestEvents(shipB.id, [{ status: "out_for_delivery", rawStatus: "OFD", location: "DC", occurredAt: new Date().toISOString() }], "manual");
      await drain();
      const [m] = await db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.shipmentId, shipB.id));
      check("No plan → OFD not sent", !!m && m.status === "skipped" && m.creditsCharged === 0, `${m?.status}: ${m?.error}`);
    } else check("No plan → OFD not sent", false, "customer B has no booked shipment to test with");
  }

  // 3. No response → status No Response, order stays active (released) — then a LATE "Cancel Order"
  //    on a booked, not-yet-picked-up shipment → courier cancellation → Cancelled + one refund.
  {
    const m = "9811100002";
    const { orderId, ship } = await lateCancelSetup("LATE", m);
    const c0 = await conf(orderId);
    check("No reply → No Response and order released", c0.status === "no_response", `confirmation ${c0.status}`);
    const r1 = await reply(m, "Cancel Order", `wamid.${run}.1`);
    const r2 = await reply(m, "Cancel Order", `wamid.${run}.1`); // WATI retry of the same event
    await drain(); await drain();
    const c = await conf(orderId);
    const [s] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, ship.id));
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    check("Duplicate webhook is ignored", r1.result === "ok:rejected" && r2.result === "duplicate", `${r1.result} / ${r2.result}`);
    check("Buyer cancel after booking → courier cancelled", c.status === "rejected" && c.cancellationStatus === "cancelled" && s.status === "cancelled" && o.status === "cancelled", `${c.status}/${c.cancellationStatus}, shipment ${s.status}, order ${o.status}`);
    check("Shipping charge refunded exactly once", (await refunds(ship.id)) === 1, `${await refunds(ship.id)} refund entr(ies)`);
    const r3 = await reply(m, "Confirm Order", `wamid.${run}.2`);
    check("Late second answer cannot flip the decision", r3.result !== "ok:confirmed" && (await conf(orderId)).status === "rejected", r3.result);
  }

  // 4. Courier refuses the cancellation → Cancellation Failed, no refund.
  {
    await db.update(schema.providerAccounts).set({ configPublic: { ...(demoAcct.configPublic as object), demoRefuseCancel: true } }).where(eq(schema.providerAccounts.id, demoAcct.id));
    const m = "9811100003";
    const { orderId, ship } = await lateCancelSetup("REFUSE", m);
    await reply(m, "Cancel Order", `wamid.${run}.3`);
    await drain();
    const c = await conf(orderId);
    check("Courier refusal → Cancellation Failed", c.cancellationStatus === "failed" && (await refunds(ship.id)) === 0, `${c.cancellationStatus}: ${c.cancellationReason}`);
    await db.update(schema.providerAccounts).set({ configPublic: demoAcct.configPublic }).where(eq(schema.providerAccounts.id, demoAcct.id));
  }

  // 5. Already picked up → Action Required (no courier call, no refund).
  {
    const m = "9811100004";
    const { orderId, ship } = await lateCancelSetup("PICKED", m);
    await db.update(schema.shipments).set({ status: "picked_up" }).where(eq(schema.shipments.id, ship.id));
    await reply(m, "Cancel Order", `wamid.${run}.4`);
    await drain();
    const c = await conf(orderId);
    check("Picked up → Action Required", c.cancellationStatus === "action_required" && (await refunds(ship.id)) === 0, c.cancellationReason ?? "");
  }

  // 6. Unknown phone / non-button text is not applied to anyone.
  {
    const r = await reply("9000000000", "Cancel Order", `wamid.${run}.5`);
    const r2 = await reply("9811100002", "hello", `wamid.${run}.6`);
    check("Unmatched replies change nothing", r.result === "unmatched" && r2.result === "ignored:not_a_button", `${r.result} / ${r2.result}`);
  }
} finally {
  if (cfgRow) await db.update(schema.pricingSettings).set({ value: cfgRow.value }).where(eq(schema.pricingSettings.key, "cod_confirmation"));
  await db.update(schema.providerAccounts).set({ configPublic: demoAcct.configPublic }).where(eq(schema.providerAccounts.id, demoAcct.id));
}

const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
