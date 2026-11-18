/** Wallet recharge: shared (client-safe) amounts, statuses and settings types. All money in paise. */

export type RechargeMethod = "razorpay" | "cashfree" | "manual" | "demo";
export type Gateway = "razorpay" | "cashfree" | "none";

export interface ManualUpiSettings {
  enabled: boolean;
  upiId: string;
  payeeName: string;
  /** Private storage key of the uploaded QR image ("" = none). */
  qrKey: string;
  qrMime: string;
  instructions: string;
  /** Discount in basis points: 50 = 0.5 %. */
  discountBps: number;
  minPaise: number;
  maxPaise: number;
  reviewMessage: string;
}
export interface PaymentSettings {
  activeGateway: Gateway;
  onlineMinPaise: number;
  onlineMaxPaise: number;
  manual: ManualUpiSettings;
}
export const PAYMENT_DEFAULTS: PaymentSettings = {
  activeGateway: "razorpay",
  onlineMinPaise: 100_00,
  onlineMaxPaise: 2_00_000_00,
  manual: {
    enabled: false, upiId: "", payeeName: "", qrKey: "", qrMime: "",
    instructions: "Scan the QR code or pay to the UPI ID using any UPI app (Google Pay, PhonePe, Paytm, BHIM). Pay the exact amount shown, then submit the UTR / transaction reference and a screenshot.",
    discountBps: 50, minPaise: 500_00, maxPaise: 2_00_000_00,
    reviewMessage: "Your recharge request has been submitted. We aim to verify your payment and update your wallet within 10 minutes. You can track progress using your Request ID.",
  },
};

/**
 * Manual UPI amounts. discount = recharge × rate, rounded half-up to the paisa;
 * payable = recharge − discount; the wallet is credited the full recharge on approval.
 * ₹1,000 at 0.5 % → discount ₹5, payable ₹995, credit ₹1,000.
 */
export function manualQuote(rechargePaise: number, discountBps: number) {
  const bps = Math.max(0, Math.min(10_000, Math.round(discountBps)));
  const discountPaise = Math.floor((rechargePaise * bps + 5_000) / 10_000);
  return { rechargePaise, discountBps: bps, discountPaise, payablePaise: rechargePaise - discountPaise, creditPaise: rechargePaise };
}

export const bpsLabel = (bps: number) => `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

export const RECHARGE_STATUS: Record<string, { label: string; chip: string }> = {
  payment_pending: { label: "Payment Pending", chip: "c-pending" },
  pending_verification: { label: "Pending Verification", chip: "c-pending" },
  info_required: { label: "More Information Required", chip: "c-awaiting_customer" },
  credited: { label: "Credited", chip: "c-active" },
  rejected: { label: "Rejected", chip: "c-failed" },
  failed: { label: "Failed", chip: "c-failed" },
  expired: { label: "Expired", chip: "c-draft" },
  cancelled: { label: "Cancelled", chip: "c-draft" },
  mismatch: { label: "Failed (amount mismatch)", chip: "c-failed" },
  // legacy values
  pending: { label: "Payment Pending", chip: "c-pending" },
  captured: { label: "Credited", chip: "c-active" },
};
export const rechargeStatus = (s: string) => RECHARGE_STATUS[s] ?? { label: s.replace(/_/g, " "), chip: "c-pending" };
export const METHOD_LABEL: Record<string, string> = { razorpay: "Razorpay", cashfree: "Cashfree", manual: "Manual UPI / QR", demo: "Demo" };

/** UTR / UPI transaction reference: letters and digits, 6–30 chars, normalised upper-case. */
export const normaliseUtr = (v: string) => v.replace(/\s+/g, "").toUpperCase();
export const validUtr = (v: string) => /^[A-Z0-9]{6,30}$/.test(v);
