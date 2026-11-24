import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { bankFileCsv } from "@/server/cod/payouts";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";

/** GET /api/admin/cod/bank-file?run=… or ?ids=a,b — bank bulk-transfer CSV of scheduled COD payouts (account numbers in full). */
export async function GET(req: Request) {
  const s = await apiStaff("cod.remit");
  if (!s) return apiError(403, "forbidden", "You cannot download payout files");
  const u = new URL(req.url);
  const run = u.searchParams.get("run");
  let ids = (u.searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 500);
  if (run) {
    const db = await getDb();
    ids = (await db.select({ id: schema.codRemittances.id }).from(schema.codRemittances).where(and(eq(schema.codRemittances.runId, run), eq(schema.codRemittances.status, "scheduled")))).map((x) => x.id);
  }
  if (!ids.length) {
    const db = await getDb();
    ids = (await db.select({ id: schema.codRemittances.id }).from(schema.codRemittances).where(eq(schema.codRemittances.status, "scheduled"))).map((x) => x.id);
  }
  const f = await bankFileCsv(ids);
  if (!f.count) return apiError(404, "not_found", "No scheduled payouts with a bank account to pay");
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "admin.cod_bank_file", details: { count: f.count, totalPaise: f.totalPaise, run } });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(f.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="vishwaship-cod-payouts-${day}.csv"`, "cache-control": "no-store" } });
}
