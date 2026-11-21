/** Shared franchise rules (no server imports, so pages and tests can use them). */

export const DEFAULT_FRANCHISE_TERMS = `VISHWASHIP FRANCHISE TERMS & CONDITIONS

1. Appointment and area
1.1 Vishwaship appoints the Franchise as its partner for the area(s) written in the franchise record (districts and/or PIN codes).
1.2 The area is exclusive: while this agreement is active, Vishwaship will not appoint another franchise for the same area.
1.3 Exclusivity covers franchise appointment only. Customers anywhere may still sign up with Vishwaship directly, and the Franchise may serve customers from outside its area, without exclusivity there.

2. Term and renewal
2.1 The agreement runs from the term start date to the term end date in the franchise record (12 months unless written otherwise).
2.2 It may be renewed for a further term by written confirmation from both sides. Vishwaship may revise the commission, target or Terms on renewal.
2.3 If the term ends without renewal, Vishwaship may suspend the franchise until it is renewed or terminated.

3. Security deposit
3.1 The Franchise pays the security deposit amount set by Vishwaship before activation. It carries no interest and is not a fee.
3.2 The deposit is refunded within 30 days after the agreement ends, minus any amount the Franchise owes Vishwaship (unpaid dues, chargebacks, penalties under these Terms, or losses caused by the Franchise). Every deduction is explained in writing.
3.3 The deposit may be forfeited in full or in part if the Franchise commits fraud, misuses the brand, breaches the non-solicitation clause, or leaves without the notice in clause 7.

4. Business target
4.1 The Franchise aims to reach the minimum monthly shipments written in the franchise record, counted across its customers.
4.2 If the target is missed for 3 months in a row, Vishwaship may reduce the area, remove exclusivity, or end the agreement with 30 days' notice.

5. Customers, pricing and commission
5.1 Customers who sign up through the Franchise's referral link are linked to the Franchise. Customers stay customers of Vishwaship and agree to Vishwaship's own terms.
5.2 The Franchise may set its customers' shipping prices only within the limits Vishwaship allows in the franchise dashboard.
5.3 Commission is earned only on delivered shipments that the customer has paid for. Commission on cancelled, lost, RTO or disputed shipments is not earned or is reversed.
5.4 Commission is paid out monthly after Vishwaship's review, by bank transfer to the Franchise's verified account, after TDS and GST rules as applicable.

6. Brand and conduct
6.1 The Franchise may use the Vishwaship name and logo only as Vishwaship approves, and only to promote Vishwaship services.
6.2 The Franchise must not make false promises (prices, delivery times, insurance), collect money from customers in Vishwaship's name outside the platform, or present itself as Vishwaship itself.
6.3 The Franchise must not ship or help ship prohibited, illegal or dangerous goods.
6.4 Customer data seen in the franchise dashboard is confidential. It may be used only to serve those customers and must never be sold, shared or used for another business.

7. Suspension and termination
7.1 Either side may end the agreement with 30 days' written notice.
7.2 Vishwaship may suspend or end the agreement at once for fraud, brand misuse, data misuse, a legal or KYC issue, or a serious breach of these Terms.
7.3 While suspended, the Franchise cannot add customers or change prices, and commission is held until the matter is closed.
7.4 On termination the area becomes free, the referral link stops working, and the Franchise's customers continue with Vishwaship directly.

8. KYC and agreement
8.1 The Franchise must give valid KYC (PAN, GST if registered, address proof and bank details) before activation and keep it up to date.
8.2 A signed copy of this agreement is required before activation.

9. General
9.1 The Franchise is an independent business, not an employee or agent of Vishwaship.
9.2 Vishwaship may update these Terms. A new version applies to a Franchise from the date it signs or accepts it.
9.3 These Terms are governed by the laws of India.`;

export const STATUS_LABEL: Record<string, string> = { draft: "Draft", active: "Active", suspended: "Suspended", terminated: "Terminated" };
export const STATUS_CHIP: Record<string, string> = { draft: "c-draft", active: "c-active", suspended: "c-failed", terminated: "c-failed" };
export const DEPOSIT_METHOD_LABEL: Record<string, string> = { bank_transfer: "Bank transfer", upi: "UPI", cheque: "Cheque", cash: "Cash" };

export type DepositState = "not_required" | "pending" | "partial" | "held" | "closed";
export const DEPOSIT_STATE_LABEL: Record<DepositState, string> = { not_required: "Not required", pending: "Pending", partial: "Partly paid", held: "Held", closed: "Refunded / forfeited" };

/** What is held now against what the admin asked for. */
export function depositSummary(requiredPaise: number, deposits: Array<{ amountPaise: number; status: string; refundPaise: number; forfeitPaise: number }>) {
  const heldPaise = deposits.filter((d) => d.status === "held").reduce((s, d) => s + d.amountPaise, 0);
  const refundedPaise = deposits.reduce((s, d) => s + d.refundPaise, 0);
  const forfeitedPaise = deposits.reduce((s, d) => s + d.forfeitPaise, 0);
  const anyClosed = deposits.some((d) => d.status !== "held");
  let state: DepositState;
  if (heldPaise > 0 && heldPaise >= requiredPaise) state = "held";
  else if (heldPaise > 0) state = "partial";
  else if (requiredPaise === 0) state = "not_required";
  else state = anyClosed ? "closed" : "pending";
  return { requiredPaise, heldPaise, refundedPaise, forfeitedPaise, duePaise: Math.max(0, requiredPaise - heldPaise), state };
}

/** Everything that must be true before a franchise can be activated. */
export function activationChecklist(
  f: { kycVerifiedAt: Date | null; agreementSignedAt: Date | null; termsVersion: number | null; termStart: Date | null; termEnd: Date | null },
  liveAreas: number,
  deposit: { requiredPaise: number; heldPaise: number },
  currentTermsVersion: number,
  now = new Date(),
) {
  return [
    { key: "area", label: "Give at least one area", ok: liveAreas > 0 },
    { key: "deposit", label: "Receive the full security deposit", ok: deposit.heldPaise >= deposit.requiredPaise },
    { key: "kyc", label: "Verify KYC", ok: !!f.kycVerifiedAt },
    { key: "agreement", label: "Record the signed agreement", ok: !!f.agreementSignedAt && f.termsVersion != null && currentTermsVersion > 0 },
    { key: "term", label: "Set a term that has not ended", ok: !!f.termStart && !!f.termEnd && f.termEnd > now },
  ];
}

/** Term state for display: running, ends within 30 days, or ended. */
export function termState(termEnd: Date | null, now = new Date()): "none" | "running" | "ending" | "ended" {
  if (!termEnd) return "none";
  const left = termEnd.getTime() - now.getTime();
  return left <= 0 ? "ended" : left <= 30 * 86400_000 ? "ending" : "running";
}

export const rupeesText = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
