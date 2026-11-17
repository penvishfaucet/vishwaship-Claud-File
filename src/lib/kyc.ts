export const KYC_DOCS = [
  { type: "pan", label: "PAN card", required: true, numberLabel: "PAN number" },
  { type: "aadhaar", label: "Aadhaar", required: true, numberLabel: "Aadhaar number" },
  { type: "cancelled_cheque", label: "Cancelled cheque", required: true, numberLabel: "Bank account number" },
  { type: "gst_certificate", label: "GST certificate", required: false, numberLabel: "GSTIN" },
] as const;
