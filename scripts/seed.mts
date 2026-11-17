/**
 * Demo seed: synthetic organisations, users, shipments and settings only. No live customer data.
 * Refuses to run against a DATABASE_URL unless ALLOW_DEMO_SEED=1 (never set that in production).
 * Generated demo passwords are written to .data/demo-credentials.txt (git-ignored), not printed.
 * Re-running is safe: existing rows are kept (onConflictDoNothing) and passwords are not changed.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, scrypt as _scrypt } from "node:crypto";
import { promisify } from "node:util";
import { connect, schema } from "./db.mts";

if (process.env.DATABASE_URL && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("Refusing to seed demo data into DATABASE_URL without ALLOW_DEMO_SEED=1."); process.exit(1);
}
if (existsSync(".data/demo-credentials.txt")) {
  console.log("Demo data already seeded (.data/demo-credentials.txt exists). Delete .data to reseed.");
  process.exit(0);
}
const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, o: object) => Promise<Buffer>;
async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const dk = await scrypt(pw, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
  return `scrypt$${1 << 15}$8$1$${salt.toString("base64url")}$${dk.toString("base64url")}`;
}
const id = (p: string) => `${p}_${randomBytes(8).toString("hex")}`;
const pw = () => randomBytes(9).toString("base64url");
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);

const c = await connect();
const db = c.db;
const creds: string[] = ["Vishwaship demo credentials (local only).", ""];

// ---- settings ----
await db.insert(schema.pricingSettings).values([
  { key: "gst_bps", value: 1800 },
  { key: "b2b_threshold_grams", value: 10_000 },
  { key: "cod_confirmation", value: { reminderMinutes: 120, expiryMinutes: 1440, noReply: "hold_for_review", credits: 2 } },
  { key: "notification_credit_cost", value: { sms: 1, whatsapp: 1, email: 0, webhook: 0, cod_confirmation: 2 } },
  { key: "kyc_gates", value: { requireForBooking: false, requireForCod: true, requireForRemittance: true } },
]).onConflictDoNothing();

await db.insert(schema.markupRules).values({ id: "mk_global_v1", provider: "shipmozo", orgId: null, bps: 2500, version: 1, effectiveFrom: daysAgo(30), createdBy: "seed" }).onConflictDoNothing();

// Live site rate card (indicative, pre-GST), mirrors vishwaship.com/#pricing on 2026-11-17.
const card: Array<[string, number[], number[]]> = [
  ["Surface|3–5 days", [39, 46, 56, 70, 84], [34, 41, 48, 60, 75]],
  ["Express|1–2 days", [54, 72, 87, 111, 132], [48, 66, 77, 101, 118]],
];
let sort = 0;
const zones = ["A", "B", "C", "D", "E"];
for (const [desc, first, add] of card) {
  for (let i = 0; i < zones.length; i++) {
    await db.insert(schema.publicRateCard).values({ id: id("rc"), zone: zones[i], description: desc, firstSlabGrams: 500, firstSlabPaise: first[i] * 100, additionalSlabGrams: 500, additionalSlabPaise: add[i] * 100, sort: sort++ });
  }
}

await db.insert(schema.creditPacks).values([
  { id: "cp_500", credits: 500, unitPricePaise: 25, sort: 1 },
  { id: "cp_1000", credits: 1000, unitPricePaise: 25, sort: 2 },
  { id: "cp_5000", credits: 5000, unitPricePaise: 22, sort: 3 },
]).onConflictDoNothing();

// ---- provider accounts ----
await db.insert(schema.providerAccounts).values([
  { id: "pa_demo", adapter: "demo", category: "shipping", label: "Demo carrier network", mode: "test", status: "enabled", priority: 1,
    capabilities: { quote: "demo", book: "demo", track: "demo", label: "demo", pickup: "demo", cancel: "demo", ndr: "demo" } },
  { id: "pa_shipmozo", adapter: "shipmozo", category: "shipping", label: "Shipmozo", mode: "test", status: "disabled", priority: 10,
    configPublic: {}, capabilities: {} },
  { id: "pa_razorpay", adapter: "razorpay", category: "payments", label: "Razorpay", mode: "test", status: "disabled", capabilities: {} },
  { id: "pa_wati", adapter: "wati", category: "messaging", label: "WATI WhatsApp", mode: "test", status: "disabled", capabilities: {} },
]).onConflictDoNothing();

// ---- staff (demo roles) ----
for (const role of ["owner", "operations", "finance", "support", "readonly"] as const) {
  const p = pw();
  await db.insert(schema.users).values({ id: `usr_staff_${role}`, kind: "staff", name: `Demo ${role[0].toUpperCase() + role.slice(1)}`, email: `${role}@demo.vishwaship.test`, staffRole: role, passwordHash: await hashPassword(p) }).onConflictDoNothing();
  creds.push(`staff     ${role.padEnd(10)} ${role}@demo.vishwaship.test  ${p}`);
}

// ---- customers: A (global 25%), B (20% override), C (10% override) ----
const orgs = [
  { id: "org_demo_a", name: "Asha Traders (demo)", business: "Asha Traders", bps: null as number | null, kyc: "approved" as const },
  { id: "org_demo_b", name: "Bharat Hardware (demo)", business: "Bharat Hardware", bps: 2000, kyc: "pending" as const },
  { id: "org_demo_c", name: "Chetan Exports (demo)", business: "Chetan Exports", bps: 1000, kyc: "not_started" as const },
];
const consignees = [
  { name: "Ravi K.", mobile: "9000000001", line1: "12 MG Road", pincode: "411001", city: "Pune", state: "Maharashtra" },
  { name: "Meena S.", mobile: "9000000002", line1: "4 Park Street", pincode: "700016", city: "Kolkata", state: "West Bengal" },
  { name: "Arjun P.", mobile: "9000000003", line1: "88 Brigade Road", pincode: "560025", city: "Bengaluru", state: "Karnataka" },
  { name: "Fatima R.", mobile: "9000000004", line1: "7 GS Road", pincode: "781005", city: "Guwahati", state: "Assam" },
];
const statuses = ["pickup_pending", "in_transit", "out_for_delivery", "delivered", "ndr", "rto_in_transit", "delivered", "in_transit"];
const path = ["booked", "pickup_pending", "picked_up", "in_transit", "at_delivery_center", "out_for_delivery", "delivered"];

for (const [oi, o] of orgs.entries()) {
  await db.insert(schema.orgs).values({ id: o.id, name: o.name, businessName: o.business, kycStatus: o.kyc, gstin: oi === 0 ? "07AAAAA0000A1Z5" : null }).onConflictDoNothing();
  if (o.bps) await db.insert(schema.markupRules).values({ id: `mk_${o.id}`, provider: "shipmozo", orgId: o.id, bps: o.bps, version: 1, effectiveFrom: daysAgo(10), createdBy: "seed" }).onConflictDoNothing();
  const p = pw();
  const letter = o.id.slice(-1);
  await db.insert(schema.users).values({ id: `usr_cust_${letter}`, kind: "customer", orgId: o.id, name: `Demo user ${letter.toUpperCase()}`, email: `customer-${letter}@demo.vishwaship.test`, mobile: `90000001${oi}0`, emailVerifiedAt: new Date(), passwordHash: await hashPassword(p) }).onConflictDoNothing();
  creds.push(`customer  ${letter.toUpperCase()}${o.bps ? ` (${o.bps / 100}% override)` : " (global 25%)"}  customer-${letter}@demo.vishwaship.test  ${p}`);

  const walletId = `wal_${o.id}`;
  const opening = [250_000, 40_000, 0][oi];
  await db.insert(schema.wallets).values({ id: walletId, orgId: o.id, postedPaise: opening }).onConflictDoNothing();
  if (opening) await db.insert(schema.ledgerEntries).values({ id: id("le"), walletId, kind: "recharge_credit", amountPaise: opening, idempotencyKey: `seed:${o.id}:opening`, balanceAfterPaise: opening, reservedAfterPaise: 0, refType: "seed", memo: "Demo opening recharge", createdAt: daysAgo(9) }).onConflictDoNothing();
  await db.insert(schema.creditBalances).values({ orgId: o.id, credits: [480, 0, 50][oi] }).onConflictDoNothing();

  await db.insert(schema.warehouses).values({ id: `wh_${o.id}`, orgId: o.id, label: "Main warehouse", contactName: "Dispatch desk", mobile: `98000000${oi}1`, mobileVerifiedAt: oi < 2 ? daysAgo(8) : null, line1: "Plot 21, Industrial Area", pincode: ["110034", "122001", "302001"][oi], city: ["New Delhi", "Gurugram", "Jaipur"][oi], state: ["Delhi", "Haryana", "Rajasthan"][oi], isDefault: true }).onConflictDoNothing();

  if (oi > 1) continue; // C has no shipments yet (empty states)
  for (let i = 0; i < 8; i++) {
    const orderId = `ord_${o.id}_${i}`;
    const cons = consignees[i % consignees.length];
    const cod = i % 3 === 0;
    const b2b = i === 5;
    await db.insert(schema.orders).values({
      id: orderId, orgId: o.id, orderNumber: `VS${letter.toUpperCase()}${1001 + i}`, status: "booked", mode: b2b ? "B2B" : "B2C",
      paymentType: cod ? "cod" : "prepaid", codAmountPaise: cod ? 149_900 : 0, declaredValuePaise: 149_900, warehouseId: `wh_${o.id}`,
      consignee: cons, products: [{ name: b2b ? "Hardware fittings (carton)" : "Brass tap set", qty: b2b ? 6 : 1, unitPrice: 149_900 }], createdAt: daysAgo(8 - i),
    }).onConflictDoNothing();
    await db.insert(schema.packages).values({ id: id("pkg"), orderId, count: b2b ? 3 : 1, lengthMm: b2b ? 500 : 200, breadthMm: b2b ? 400 : 150, heightMm: b2b ? 400 : 100, actualWeightGrams: b2b ? 12_000 : 1_200 });
    const h = createHash("sha256").update(orderId).digest("hex").slice(0, 10).toUpperCase();
    const awb = b2b ? `DEMO-LR-${h}` : `DEMO${h}`;
    const shipId = `shp_${o.id}_${i}`;
    const sell = b2b ? 412_000 : [7_670, 9_440, 12_390][i % 3];
    await db.insert(schema.shipments).values({
      id: shipId, orgId: o.id, orderId, providerAccountId: "pa_demo", provider: "demo", carrierCode: b2b ? "allcargo-gati" : ["delhivery", "xpressbees", "blue-dart"][i % 3],
      carrierName: b2b ? "Allcargo Gati" : ["Delhivery", "Xpressbees", "Blue Dart"][i % 3], serviceName: b2b ? "Surface Cargo" : "Surface",
      providerOrderRef: `DEMO-ORD-${h}`, awb, lrNumber: b2b ? awb : null, bookingStatus: "confirmed", pickupStatus: statuses[i] === "pickup_pending" ? "scheduled" : "completed",
      labelStatus: "generated", status: statuses[i], quoteId: "seed", sellPaise: sell, costPaise: Math.round(sell / 1.25 / 1.18),
      chargeableWeightGrams: b2b ? 20_000 : 1_500, etaDate: new Date(Date.now() + (3 - (i % 3)) * 86400_000), lastEventAt: daysAgo(1), createdAt: daysAgo(8 - i),
    }).onConflictDoNothing();
    const upto = statuses[i] === "ndr" || statuses[i] === "rto_in_transit" ? 5 : Math.max(0, path.indexOf(statuses[i]));
    for (let e = 0; e <= upto; e++) {
      await db.insert(schema.shipmentEvents).values({ id: id("ev"), shipmentId: shipId, dedupeKey: `seed:${shipId}:${e}`, status: path[e], rawStatus: path[e].toUpperCase(), location: e < 3 ? "Origin hub" : "Destination hub", occurredAt: new Date(daysAgo(8 - i).getTime() + e * 14 * 3600_000), source: "manual" }).onConflictDoNothing();
    }
    if (statuses[i] === "ndr") {
      await db.insert(schema.shipmentEvents).values({ id: id("ev"), shipmentId: shipId, dedupeKey: `seed:${shipId}:ndr`, status: "ndr", rawStatus: "CONSIGNEE_UNAVAILABLE", location: "Destination hub", occurredAt: daysAgo(1), source: "manual" }).onConflictDoNothing();
      await db.insert(schema.ndrCases).values({ id: id("ndr"), orgId: o.id, shipmentId: shipId, kind: "ndr", reason: "Consignee not available", attempt: 1, deadlineAt: new Date(Date.now() + 36 * 3600_000) });
    }
    if (statuses[i] === "rto_in_transit") {
      await db.insert(schema.shipmentEvents).values({ id: id("ev"), shipmentId: shipId, dedupeKey: `seed:${shipId}:rto`, status: "rto_in_transit", rawStatus: "RTO_IN_TRANSIT", location: "Destination hub", occurredAt: daysAgo(1), source: "manual" }).onConflictDoNothing();
      await db.insert(schema.ndrCases).values({ id: id("ndr"), orgId: o.id, shipmentId: shipId, kind: "rto", reason: "Refused by consignee", attempt: 3, status: "acknowledged" });
    }
    if (i === 3) {
      await db.insert(schema.weightDisputes).values({ id: id("wd"), orgId: o.id, shipmentId: shipId, declaredGrams: 1_200, carrierGrams: 2_300, revisedChargeableGrams: 2_500, chargePaise: 5_900, evidence: [{ kind: "photo", label: "Carrier scale photo (demo)" }], deadlineAt: new Date(Date.now() + 5 * 86400_000) });
    }
  }
  await db.insert(schema.inAppAlerts).values([
    { id: id("al"), orgId: o.id, kind: "ndr", title: "1 shipment needs action (NDR)", href: "/portal/ndr/" },
    { id: id("al"), orgId: o.id, kind: "weight", title: "Weight discrepancy raised on 1 shipment", href: "/portal/billing/?tab=disputes" },
  ]);
}

mkdirSync(".data", { recursive: true });
writeFileSync(".data/demo-credentials.txt", creds.join("\n") + "\n");
console.log("Demo data seeded. Demo logins written to .data/demo-credentials.txt");
await c.close();
