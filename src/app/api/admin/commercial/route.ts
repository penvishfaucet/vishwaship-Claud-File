import { NextResponse } from "next/server";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import type { Permission } from "@/server/auth/rbac";
import { COMPANY_DEFAULT, nextDocNumber } from "@/server/billing";
import { saveOrgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { earlyCodTerms } from "@/server/early-cod";
import { apiError } from "@/server/http";
import { withLedger } from "@/server/ledger/db-store";
import { credit, debit } from "@/server/ledger/wallet";
import { getSetting } from "@/server/quotes/service";
import { codFeesFor, feeRates } from "@/server/store/fee";
import { newId } from "@/server/util/ids";

const code = z.string().regex(/^[a-z0-9-]{2,40}$/);
const rupees = z.coerce.number().min(0).max(1_00_00_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bool = z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")]).transform((v) => v === true || v === "on" || v === "true");

const Ops = z.discriminatedUnion("op", [
  z.object({ op: z.literal("courier_availability"), disabled: z.array(code).max(80) }),
  z.object({ op: z.literal("price_list_zones"), zones: z.array(z.object({ zone: z.string().regex(/^[A-Z]$/), label: z.string().trim().min(2).max(40), pin: z.string().regex(/^$|^[1-9]\d{5}$/) })).max(8), zone: z.string().regex(/^[A-Z]$/).optional(), label: z.string().trim().min(2).max(40).optional(), pin: z.string().regex(/^$|^[1-9]\d{5}$/, "Sample PIN must be 6 digits or empty").optional() }),
  z.object({ op: z.literal("early_cod_terms"), enabled: bool, feePct: z.coerce.number().min(0).max(10), cycleDays: z.coerce.number().int().min(0).max(15), standardCycleDays: z.coerce.number().int().min(1).max(30), minDelivered: z.coerce.number().int().min(0).max(10_000), requireKyc: bool }),
  z.object({ op: z.literal("company_billing"), legalName: z.string().trim().min(2).max(120), gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN"), address: z.string().trim().max(300), stateCode: z.string().trim().max(2), email: z.string().trim().email(), sac: z.string().trim().regex(/^\d{6}$/) }),
  z.object({ op: z.literal("remittance_create"), orgId: z.string().min(3), early: bool, payoutDate: day }),
  z.object({ op: z.literal("remittance_paid"), id: z.string().min(3), reference: z.string().trim().min(4).max(60) }),
  z.object({ op: z.literal("remittance_cancel"), id: z.string().min(3) }),
  z.object({ op: z.literal("invoice_generate"), orgId: z.string().min(3), from: day, to: day }),
  z.object({ op: z.literal("note_issue"), orgId: z.string().min(3), kind: z.enum(["credit_note", "debit_note"]), amount: rupees.refine((n) => n > 0, "Amount must be more than 0"), reason: z.string().trim().min(5).max(200), refType: z.enum(["shipment", "invoice", "dispute", "other"]), refId: z.string().trim().max(60).default(""), postToWallet: bool }),
  z.object({ op: z.literal("oms_status"), orgId: z.string().min(3), status: z.enum(["requested", "in_progress", "connected", "rejected"]), note: z.string().trim().max(300).default("") }),
]);
const PERM: Record<string, Permission> = {
  courier_availability: "pricing.write", price_list_zones: "pricing.write", early_cod_terms: "finance.adjust", company_billing: "finance.adjust",
  remittance_create: "cod.remit", remittance_paid: "cod.remit", remittance_cancel: "cod.remit", invoice_generate: "finance.adjust", note_issue: "finance.adjust", oms_status: "integrations.write",
};

/** Admin commercial & operations settings. Every op checks its own permission and is audited. */
export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return apiError(400, "validation_error", "Body must be JSON"); }
  const p = Ops.safeParse(raw);
  if (!p.success) return apiError(422, "validation_error", p.error.issues.map((i) => i.message).join("; "));
  const b = p.data;
  const s = await apiStaff(PERM[b.op]);
  if (!s) return apiError(403, "forbidden", "You do not have permission for this action");
  const db = await getDb();
  const setSetting = async (key: string, value: unknown) => {
    const cur = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, key));
    await db.insert(schema.pricingSettings).values({ key, value }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, version: (cur[0]?.version ?? 0) + 1, updatedAt: new Date() } });
  };
  const done = async (message: string, details: Record<string, unknown> = {}, orgId?: string) => {
    await audit({ actorUserId: s.userId, actorKind: "staff", orgId, action: `admin.${b.op}`, details });
    return NextResponse.json({ ok: true, message });
  };
  const orgOk = async (id: string) => (await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.id, id))).length > 0;

  switch (b.op) {
    case "courier_availability":
      await setSetting("courier_availability", { disabled: b.disabled });
      return done(`${b.disabled.length} courier(s) switched off for all customers`, { disabled: b.disabled });
    case "price_list_zones": {
      const zones = [...b.zones.filter((z) => z.zone !== b.zone), ...(b.zone && b.label ? [{ zone: b.zone, label: b.label, pin: b.pin ?? "" }] : [])].sort((x, y) => x.zone.localeCompare(y.zone));
      if (!zones.length) return apiError(422, "validation_error", "At least one zone is required");
      await setSetting("price_list_zones", zones);
      return done("Price list zones saved", { zones });
    }
    case "early_cod_terms": {
      const cur = await earlyCodTerms();
      const next = { enabled: b.enabled, feeBps: Math.round(b.feePct * 100), cycleDays: b.cycleDays, standardCycleDays: b.standardCycleDays, minDelivered: b.minDelivered, requireKyc: b.requireKyc };
      const changed = next.feeBps !== cur.feeBps || next.cycleDays !== cur.cycleDays || next.minDelivered !== cur.minDelivered || next.requireKyc !== cur.requireKyc;
      await setSetting("early_cod_terms", { ...next, version: changed ? cur.version + 1 : cur.version });
      return done(changed ? "Early COD terms updated (new version for new subscribers)" : "Early COD settings saved", next);
    }
    case "company_billing": {
      const { op: _op, ...v } = b; void _op;
      await setSetting("company_billing", { ...COMPANY_DEFAULT, ...v });
      return done("Company billing details saved");
    }
    case "remittance_create": {
      if (!(await orgOk(b.orgId))) return apiError(404, "not_found", "Customer not found");
      const rows = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
        .leftJoin(schema.codRemittanceItems, eq(schema.codRemittanceItems.shipmentId, schema.shipments.id))
        .where(and(eq(schema.shipments.orgId, b.orgId), eq(schema.orders.paymentType, "cod"), eq(schema.shipments.status, "delivered"), isNull(schema.codRemittanceItems.shipmentId)));
      if (!rows.length) return apiError(409, "conflict", "No delivered COD shipments are waiting for remittance");
      const [sub] = b.early ? await db.select().from(schema.earlyCodSubscriptions).where(and(eq(schema.earlyCodSubscriptions.orgId, b.orgId), eq(schema.earlyCodSubscriptions.status, "active"))) : [];
      if (b.early && !sub) return apiError(409, "conflict", "This customer has no active Early COD subscription");
      const gross = rows.reduce((t, r) => t + r.o.codAmountPaise, 0);
      const fee = sub ? Math.round((gross * sub.feeBps) / 10_000) : 0;
      const gst = Math.round(fee * 0.18);
      const id = newId("rem");
      let storeFee = 0;
      const rates = await feeRates();
      await db.transaction(async (tx) => {
        // Online Store: 1.5% + GST on delivered COD store orders comes out of this remittance
        const sf = await codFeesFor(tx, rows.map((r) => r.s.id), rates, true);
        storeFee = sf.totalPaise;
        const notes = [fee ? `Early COD fee ${sub!.feeBps / 100}% + 18% GST` : null, sf.orders ? `Online Store fee 1.5% + GST on ${sf.orders} delivered COD order${sf.orders === 1 ? "" : "s"} (₹${(sf.totalPaise / 100).toFixed(2)})` : null].filter(Boolean);
        const ded = fee + gst + sf.totalPaise;
        await tx.insert(schema.codRemittances).values({ id, orgId: b.orgId, cycleDate: new Date(), expectedPayoutAt: new Date(`${b.payoutDate}T12:00:00+05:30`), grossPaise: gross, deductionsPaise: ded, netPaise: gross - ded, deductionNote: notes.length ? notes.join(" · ") : null, status: "scheduled", earlyCod: !!sub, createdBy: s.userId });
        await tx.insert(schema.codRemittanceItems).values(rows.map((r) => ({ remittanceId: id, shipmentId: r.s.id, codPaise: r.o.codAmountPaise })));
      });
      return done(`Remittance scheduled: ${rows.length} shipments, net ₹${((gross - fee - gst - storeFee) / 100).toFixed(2)}`, { id, shipments: rows.length, gross, fee, gst, storeFee }, b.orgId);
    }
    case "remittance_paid": {
      const u = await db.update(schema.codRemittances).set({ status: "paid", reference: b.reference, paidAt: new Date() }).where(and(eq(schema.codRemittances.id, b.id), eq(schema.codRemittances.status, "scheduled"))).returning();
      if (!u.length) return apiError(409, "conflict", "Only a scheduled remittance can be marked paid");
      await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: u[0].orgId, kind: "cod", title: `COD remittance of ₹${(u[0].netPaise / 100).toFixed(2)} paid (ref ${b.reference})`, href: "/portal/billing/cod-remittance/" });
      return done("Marked paid", { id: b.id, reference: b.reference }, u[0].orgId);
    }
    case "remittance_cancel": {
      const [r] = await db.select().from(schema.codRemittances).where(and(eq(schema.codRemittances.id, b.id), eq(schema.codRemittances.status, "scheduled")));
      if (!r) return apiError(409, "conflict", "Only a scheduled remittance can be cancelled");
      await db.transaction(async (tx) => {
        await tx.delete(schema.codRemittanceItems).where(eq(schema.codRemittanceItems.remittanceId, r.id)); // shipments return to the next cycle
        await tx.update(schema.codRemittances).set({ status: "cancelled" }).where(eq(schema.codRemittances.id, r.id));
      });
      return done("Remittance cancelled; shipments return to the next cycle", { id: r.id }, r.orgId);
    }
    case "invoice_generate": {
      if (!(await orgOk(b.orgId))) return apiError(404, "not_found", "Customer not found");
      const from = new Date(`${b.from}T00:00:00+05:30`), to = new Date(`${b.to}T23:59:59.999+05:30`);
      if (from > to) return apiError(422, "validation_error", "From must be before To");
      const overlap = await db.select({ id: schema.billingDocuments.id }).from(schema.billingDocuments).where(and(eq(schema.billingDocuments.orgId, b.orgId), eq(schema.billingDocuments.kind, "invoice"), lte(schema.billingDocuments.periodFrom, to), gte(schema.billingDocuments.periodTo, from)));
      if (overlap.length) return apiError(409, "conflict", "An invoice already covers part of this period");
      const ships = await db.select().from(schema.shipments).where(and(eq(schema.shipments.orgId, b.orgId), gte(schema.shipments.createdAt, from), lte(schema.shipments.createdAt, to), inArray(schema.shipments.bookingStatus, ["confirmed"])));
      if (!ships.length) return apiError(409, "conflict", "No billable shipments in this period");
      const gstBps = (await getSetting<number>("gst_bps", 1800)).value;
      const lines = ships.map((x) => { const taxable = Math.round((x.sellPaise * 10_000) / (10_000 + gstBps)); return { description: `Shipping — ${x.carrierName} ${x.serviceName}`, ref: x.awb ?? x.id, taxablePaise: taxable, gstPaise: x.sellPaise - taxable }; });
      const taxable = lines.reduce((t, l) => t + l.taxablePaise, 0), gst = lines.reduce((t, l) => t + l.gstPaise, 0);
      const number = await nextDocNumber("invoice");
      await db.insert(schema.billingDocuments).values({ id: newId("doc"), orgId: b.orgId, kind: "invoice", number, docDate: new Date(), periodFrom: from, periodTo: to, taxablePaise: taxable, gstPaise: gst, totalPaise: taxable + gst, lines, createdBy: s.userId });
      await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: b.orgId, kind: "billing", title: `Invoice ${number} issued`, href: "/portal/billing/invoices/" });
      return done(`Invoice ${number} issued for ${ships.length} shipments`, { number, taxable, gst }, b.orgId);
    }
    case "note_issue": {
      if (!(await orgOk(b.orgId))) return apiError(404, "not_found", "Customer not found");
      const total = Math.round(b.amount * 100);
      const gstBps = (await getSetting<number>("gst_bps", 1800)).value;
      const taxable = Math.round((total * 10_000) / (10_000 + gstBps));
      const number = await nextDocNumber(b.kind);
      const id = newId("doc");
      await db.insert(schema.billingDocuments).values({ id, orgId: b.orgId, kind: b.kind, number, docDate: new Date(), taxablePaise: taxable, gstPaise: total - taxable, totalPaise: total, reason: b.reason, refType: b.refType, refId: b.refId || null, lines: [{ description: b.reason, ref: b.refId, taxablePaise: taxable, gstPaise: total - taxable }], createdBy: s.userId });
      if (b.postToWallet) {
        const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, b.orgId));
        if (w) await withLedger((st) => b.kind === "credit_note"
          ? credit(st, { walletId: w.id, amount: total, kind: "adjustment_credit", idempotencyKey: `doc:${id}`, refType: "billing_document", refId: number, memo: `Credit note ${number}: ${b.reason}` })
          : debit(st, { walletId: w.id, amount: total, kind: "adjustment_debit", idempotencyKey: `doc:${id}`, refType: "billing_document", refId: number, memo: `Debit note ${number}: ${b.reason}`, allowNegative: true }));
      }
      await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: b.orgId, kind: "billing", title: `${b.kind === "credit_note" ? "Credit" : "Debit"} note ${number} issued`, href: `/portal/billing/${b.kind === "credit_note" ? "credit-notes" : "debit-notes"}/` });
      return done(`${b.kind === "credit_note" ? "Credit" : "Debit"} note ${number} issued${b.postToWallet ? " and posted to wallet" : ""}`, { number, total, postToWallet: b.postToWallet }, b.orgId);
    }
    case "oms_status":
      if (!(await orgOk(b.orgId))) return apiError(404, "not_found", "Customer not found");
      await saveOrgSetting(b.orgId, "oms_status", { status: b.status, note: b.note }, s.userId);
      return done("OMS status updated", { status: b.status }, b.orgId);
  }
}
