import { NextResponse } from "next/server";
import { apiError } from "@/server/http";
import { fail, run, storeAudit, storeGuard } from "@/server/store/api";
import { ExpenseInput, addExpense, deleteExpense } from "@/server/store/expenses";

/** Add an expense: multipart form with `data` (JSON of ExpenseInput) and an optional `receipt` file (JPG / PNG / PDF, 5 MB). */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  let form: FormData;
  try { form = await req.formData(); } catch { return fail("Send the expense as a form"); }
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("data") ?? "")); } catch { return fail("Expense details are missing"); }
  const p = ExpenseInput.safeParse(raw);
  if (!p.success) return apiError(422, "validation_error", p.error.issues[0]?.message ?? "Check the expense details");
  const f = form.get("receipt");
  const receipt = f instanceof File && f.size > 0 ? Buffer.from(await f.arrayBuffer()) : undefined;
  return run(async () => {
    const r = await addExpense(g.s.orgId, g.s.userId, p.data, receipt);
    await storeAudit(g.s, "expense.add", r.id, { category: p.data.category, amountPaise: p.data.amountPaise, gstPaise: p.data.gstPaise, spentOn: p.data.spentOn, order: p.data.orderNumber || null, receipt: !!receipt });
    return r;
  });
}

/** DELETE ?id= → removed from the P&L (the row is kept for the audit trail). */
export async function DELETE(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return run(async () => {
    const r = await deleteExpense(g.s.orgId, id);
    await storeAudit(g.s, "expense.delete", id, { old: r });
    return NextResponse.json({ ok: true });
  });
}
