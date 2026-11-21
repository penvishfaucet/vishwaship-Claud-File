import { Fragment } from "react";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { rupees } from "@/lib/store-themes";
import { getDb, schema } from "@/server/db/client";
import { requireStorePage } from "@/server/store/portal";
import { PrintButton } from "./PrintButton";
import "@/styles/store.css";

export const metadata = { title: "Receipt — Vishwaship" };
const day = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

/** Receipt for a plan payment or a security deposit. Only the merchant's own records (org from the session). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, store } = await requireStorePage();
  const { id } = await params;
  const db = await getDb();
  const [sub] = await db.select().from(schema.storeSubscriptions).where(and(eq(schema.storeSubscriptions.id, id), eq(schema.storeSubscriptions.orgId, ctx.org.id)));
  const [dep] = sub ? [] : await db.select().from(schema.storeDeposits).where(and(eq(schema.storeDeposits.id, id), eq(schema.storeDeposits.orgId, ctx.org.id)));
  if (!sub && !dep) notFound();
  const rows: Array<[string, string]> = sub ? [
    ["Receipt number", sub.receiptNumber], ["Date", day(sub.createdAt)], ["For", `Online Store ${sub.planName} plan (${store.name})`],
    ["Period", `${day(sub.periodStart)} to ${day(sub.periodEnd)}`], ["Taxable value", rupees(sub.basePaise)], ["GST", rupees(sub.gstPaise)], ["Total paid", rupees(sub.amountPaise)], ["Paid from", "Vishwaship wallet"],
  ] : [
    ["Receipt number", dep!.receiptNumber], ["Date", day(dep!.createdAt)], ["For", `Managed Meta Ads security deposit (${store.name})`],
    ["Amount held", rupees(dep!.amountPaise)], ["Paid from", "Vishwaship wallet"], ["Terms version", String(dep!.termsVersion)],
    ["Status", dep!.status === "held" ? "Held (refundable)" : dep!.status === "refund_requested" ? "Refund requested" : dep!.status === "refunded" ? `Refunded ${rupees(dep!.refundPaise ?? 0)}${dep!.decidedAt ? ` on ${day(dep!.decidedAt)}` : ""}` : "Not refunded"],
    ...(dep!.decisionNote && dep!.status !== "held" ? [["Note", dep!.decisionNote] as [string, string]] : []),
  ];
  return (
    <div className="card" style={{ padding: 24, maxWidth: 640 }}>
      <div className="row between wrap" style={{ gap: 8 }}><h1 style={{ margin: 0, fontSize: 20 }}>{sub ? "Payment receipt" : "Security deposit receipt"}</h1><PrintButton /></div>
      <p className="small muted" style={{ margin: "4px 0 16px" }}>Vishwaship · issued to {ctx.org.businessName}</p>
      <dl className="kv-list">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      {!sub && <p className="tiny muted" style={{ marginTop: 16 }}>A security deposit is not a fee and is not spent on ads. It is returned to your wallet as per the Managed Ads terms you accepted.</p>}
    </div>
  );
}
