import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { documents } from "@/server/gst/reports";
import { documentPdf } from "@/server/gst/pdf";
import { companyTax } from "@/server/gst/posting";
import { getDb, schema } from "@/server/db/client";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** PDF of one of the customer's own invoices / notes. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [d] = await db.select({ docDate: schema.billingDocuments.docDate }).from(schema.billingDocuments).where(and(eq(schema.billingDocuments.id, id), eq(schema.billingDocuments.orgId, s.orgId)));
  if (!d) return apiError(404, "not_found", "Document not found");
  const row = (await documents(s.orgId, d.docDate, d.docDate)).find((x) => x.id === id);
  if (!row) return apiError(404, "not_found", "Document not found");
  const pdf = await documentPdf(row, await companyTax());
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${row.number.replace(/[\/:*?"<>|]+/g, "-")}.pdf"`, "cache-control": "no-store" } });
}
