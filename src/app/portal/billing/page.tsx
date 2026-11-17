import { redirect } from "next/navigation";

/** Old /portal/billing/?tab=… links → the per-section billing pages. */
const MAP: Record<string, string> = { passbook: "passbook", cod: "cod-remittance", charges: "shipping-charges", invoices: "invoices", notes: "credit-notes", credits: "notification-credits", disputes: "../tools/weight-discrepancy", recharges: "recharges" };

export default async function BillingIndex({ searchParams }: { searchParams: Promise<{ tab?: string; recharge?: string }> }) {
  const sp = await searchParams;
  const target = MAP[sp.tab ?? ""] ?? "passbook";
  redirect(`/portal/billing/${target}/${sp.recharge ? "?recharge=1" : ""}`);
}
