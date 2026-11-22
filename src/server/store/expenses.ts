import "server-only";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { getPrivate, newKey, putPrivate, sniffUpload } from "@/server/storage";
import { newId } from "@/server/util/ids";
import { StoreError } from "./catalog";

/**
 * Store expenses for the P&L. Amounts are what was paid (GST included); the GST inside is entered separately and,
 * when the merchant can claim it back, is kept out of the cost. Receipts (photo or PDF) are stored privately and only
 * served to the same account. Deleting keeps the row for the audit trail; recurring ones repeat monthly.
 */
export const EXPENSE_CATEGORIES = {
  packaging: { label: "Packaging (boxes, tape, labels)", kind: "fulfilment" },
  labour: { label: "Packing / handling labour", kind: "fulfilment" },
  order_other: { label: "Other order cost", kind: "fulfilment" },
  payment_fees: { label: "Payment gateway fees / chargebacks", kind: "payment" },
  rent: { label: "Rent", kind: "overhead" },
  salaries: { label: "Salaries", kind: "overhead" },
  storage: { label: "Storage / warehouse", kind: "overhead" },
  utilities: { label: "Electricity, internet, phone", kind: "overhead" },
  ads: { label: "Ads & marketing", kind: "overhead" },
  commissions: { label: "Commissions", kind: "overhead" },
  software: { label: "Software & apps", kind: "overhead" },
  professional: { label: "Accountant / professional fees", kind: "overhead" },
  bank: { label: "Bank charges", kind: "overhead" },
  misc: { label: "Miscellaneous", kind: "overhead" },
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
export const ExpenseInput = z.object({
  spentOn: day,
  category: z.enum(Object.keys(EXPENSE_CATEGORIES) as [ExpenseCategory, ...ExpenseCategory[]]),
  amountPaise: z.number().int().min(1, "Enter the amount").max(1_000_000_000),
  gstPaise: z.number().int().min(0).max(1_000_000_000).default(0),
  gstRecoverable: z.boolean().default(false),
  note: z.string().trim().max(300).default(""),
  orderNumber: z.string().trim().max(40).default(""),
  recurring: z.boolean().default(false),
});
export type ExpenseInput = z.infer<typeof ExpenseInput>;

async function storeId(orgId: string) {
  const db = await getDb();
  const [s] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.orgId, orgId));
  if (!s) throw new StoreError("Create your store first");
  return s.id;
}
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export async function addExpense(orgId: string, userId: string, input: ExpenseInput, receipt?: Buffer) {
  const a = ExpenseInput.parse(input);
  if (a.gstPaise >= a.amountPaise) throw new StoreError("GST must be less than the amount");
  if (a.spentOn > istToday()) throw new StoreError("The date cannot be in the future");
  const sid = await storeId(orgId);
  const db = await getDb();
  let storeOrderId: string | null = null;
  if (a.orderNumber) {
    const [o] = await db.select({ id: schema.storeOrders.id }).from(schema.storeOrders).where(and(eq(schema.storeOrders.storeId, sid), eq(schema.storeOrders.number, a.orderNumber.toUpperCase())));
    if (!o) throw new StoreError(`No order ${a.orderNumber.toUpperCase()} in your store`);
    storeOrderId = o.id;
  }
  let receiptKey: string | null = null, receiptMime: string | null = null;
  if (receipt) {
    const kind = sniffUpload(receipt);
    if (!kind) throw new StoreError("Receipt must be a JPG, PNG or PDF under 5 MB");
    receiptKey = newKey(`store-receipts/${orgId.replace(/[^a-z0-9_-]/gi, "").toLowerCase()}`, kind.ext);
    await putPrivate(receiptKey, receipt);
    receiptMime = kind.mime;
  }
  const id = newId("sex");
  await db.insert(schema.storeExpenses).values({
    id, storeId: sid, orgId, spentOn: a.spentOn, category: a.category, amountPaise: a.amountPaise, gstPaise: a.gstPaise, gstRecoverable: a.gstRecoverable && a.gstPaise > 0,
    note: a.note || null, storeOrderId, receiptKey, receiptMime, recurring: a.recurring && !storeOrderId, createdBy: userId,
  });
  return { id };
}

/** Soft delete (kept for the audit trail). A recurring expense stops repeating. */
export async function deleteExpense(orgId: string, id: string) {
  const db = await getDb();
  const r = await db.update(schema.storeExpenses).set({ deletedAt: new Date(), recurring: false })
    .where(and(eq(schema.storeExpenses.id, id), eq(schema.storeExpenses.orgId, orgId), isNull(schema.storeExpenses.deletedAt))).returning({ id: schema.storeExpenses.id, amount: schema.storeExpenses.amountPaise, category: schema.storeExpenses.category, spentOn: schema.storeExpenses.spentOn });
  if (!r.length) throw new StoreError("Expense not found");
  return r[0];
}

export async function listExpenses(orgId: string, from: string, to: string) {
  const db = await getDb();
  const E = schema.storeExpenses;
  return db.select({ e: E, order: schema.storeOrders.number }).from(E).leftJoin(schema.storeOrders, eq(schema.storeOrders.id, E.storeOrderId))
    .where(and(eq(E.orgId, orgId), isNull(E.deletedAt), gte(E.spentOn, from), lte(E.spentOn, to))).orderBy(desc(E.spentOn), desc(E.createdAt)).limit(2000);
}

export async function expenseReceipt(orgId: string, id: string) {
  const db = await getDb();
  const [e] = await db.select().from(schema.storeExpenses).where(and(eq(schema.storeExpenses.id, id), eq(schema.storeExpenses.orgId, orgId)));
  if (!e?.receiptKey) return null;
  return { data: await getPrivate(e.receiptKey), mime: e.receiptMime ?? "application/octet-stream" };
}

/** Background: copy each recurring expense into every month since it started (same day, capped at the month's end). */
export async function sweepRecurringExpenses(now = new Date()) {
  const db = await getDb();
  const today = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const src = await db.select().from(schema.storeExpenses).where(and(eq(schema.storeExpenses.recurring, true), isNull(schema.storeExpenses.deletedAt), isNull(schema.storeExpenses.recurringOf))).limit(1000);
  let made = 0;
  for (const e of src) {
    let [y, m] = e.spentOn.split("-").map(Number);
    const d = Number(e.spentOn.slice(8, 10));
    for (let i = 0; i < 24; i++) {
      m++; if (m > 12) { m = 1; y++; }
      const month = `${y}-${String(m).padStart(2, "0")}`;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const on = `${month}-${String(Math.min(d, last)).padStart(2, "0")}`;
      if (on > today) break;
      const r = await db.insert(schema.storeExpenses).values({
        id: newId("sex"), storeId: e.storeId, orgId: e.orgId, spentOn: on, category: e.category, amountPaise: e.amountPaise, gstPaise: e.gstPaise, gstRecoverable: e.gstRecoverable,
        note: e.note, recurring: false, recurringOf: e.id, recurringMonth: month, createdBy: e.createdBy,
      }).onConflictDoNothing().returning({ id: schema.storeExpenses.id });
      made += r.length;
    }
  }
  return made;
}
