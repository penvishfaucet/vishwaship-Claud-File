/**
 * GST arithmetic shared by billing documents, reports and exports. Pure functions, integer paise only.
 *
 * Rules used (configuration owned by the CA; see Admin → Invoices & Notes → company details):
 * - Supplier state = first two digits of Vishwaship's GSTIN (or the configured state code).
 * - Place of supply (courier / transport of goods, IGST Act s.12): a registered recipient's GSTIN state;
 *   an unregistered recipient's billing-address state; else the supplier's state.
 * - Same state → CGST + SGST (UTGST instead of SGST for UTs without a legislature); different state → IGST.
 * - Tax-inclusive amounts: taxable = round(gross × 10000 / (10000 + rate)); GST = gross − taxable.
 */

export const STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};
/** Union territories without a legislature: intra-state supply there is CGST + UTGST. */
const UT_WITHOUT_LEGISLATURE = new Set(["04", "26", "31", "35", "38"]);

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
const BY_NAME = new Map(Object.entries(STATE_CODES).map(([c, n]) => [norm(n), c]));
for (const [alias, c] of Object.entries({ orissa: "21", pondicherry: "34", nctofdelhi: "07", newdelhi: "07", jammukashmir: "01", andaman: "35", daman: "26", dadranagarhaveli: "26", uttaranchal: "05" })) BY_NAME.set(alias, c);

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const isGstin = (g?: string | null) => !!g && GSTIN_RE.test(g.trim().toUpperCase());
export const gstinState = (g?: string | null) => (isGstin(g) ? g!.trim().slice(0, 2) : null);
export function stateCodeOf(nameOrCode?: string | null): string | null {
  if (!nameOrCode) return null;
  const t = nameOrCode.trim();
  if (/^\d{2}$/.test(t)) return STATE_CODES[t] ? t : null;
  return BY_NAME.get(norm(t)) ?? null;
}
export const stateName = (code?: string | null) => (code ? STATE_CODES[code] ?? code : "");

export function placeOfSupply(a: { recipientGstin?: string | null; recipientState?: string | null; supplierState?: string | null }) {
  return gstinState(a.recipientGstin) ?? stateCodeOf(a.recipientState) ?? a.supplierState ?? null;
}

export type GstSplit = { cgstPaise: number; sgstPaise: number; utgstPaise: number; igstPaise: number };
/** Split a GST amount by supply type. Unknown states fall back to IGST (never under-reports tax). */
export function splitGst(gstPaise: number, supplierState: string | null, pos: string | null): GstSplit {
  if (supplierState && pos && supplierState === pos) {
    const c = Math.trunc(gstPaise / 2); // odd paise go to SGST / UTGST so the parts always add up
    return UT_WITHOUT_LEGISLATURE.has(pos)
      ? { cgstPaise: c, sgstPaise: 0, utgstPaise: gstPaise - c, igstPaise: 0 }
      : { cgstPaise: c, sgstPaise: gstPaise - c, utgstPaise: 0, igstPaise: 0 };
  }
  return { cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: gstPaise };
}

/** Tax-inclusive gross → taxable + GST at a rate in basis points (1800 = 18%). */
export function fromInclusive(grossPaise: number, rateBps: number) {
  const taxablePaise = Math.round((grossPaise * 10_000) / (10_000 + rateBps));
  return { taxablePaise, gstPaise: grossPaise - taxablePaise };
}
/** Tax-exclusive taxable → GST at a rate. */
export function fromExclusive(taxablePaise: number, rateBps: number) {
  const gstPaise = Math.round((taxablePaise * rateBps) / 10_000);
  return { taxablePaise, gstPaise };
}

/** YYYY-MM return period of a date in India time. */
export function taxPeriodOf(d: Date) {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------- period presets (India time, April–March financial year) ----------
export type PresetKey = "this_week" | "last_week" | "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_fy" | "last_fy" | "custom";
export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "this_week", label: "This Week" }, { key: "last_week", label: "Last Week" }, { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" }, { key: "this_quarter", label: "This Quarter" }, { key: "last_quarter", label: "Last Quarter" },
  { key: "this_fy", label: "Financial Year" }, { key: "last_fy", label: "Last Financial Year" }, { key: "custom", label: "Custom Range" },
];
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
/** Resolve a preset to inclusive YYYY-MM-DD dates (IST calendar). Quarters follow the financial year (Apr–Jun = Q1). */
export function presetRange(key: PresetKey, now = new Date(), custom?: { from?: string; to?: string }): { from: string; to: string; label: string } {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = ist.getUTCDate(), dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const fyStart = m >= 3 ? y : y - 1;
  const q0 = Math.floor(((m + 9) % 12) / 3); // FY quarter index 0..3
  const qStartMonth = (3 + q0 * 3) % 12, qStartYear = qStartMonth < 3 ? fyStart + 1 : fyStart;
  const label = PRESETS.find((p) => p.key === key)?.label ?? "Custom Range";
  switch (key) {
    case "this_week": return { from: ymd(y, m, d - dow), to: ymd(y, m, d), label };
    case "last_week": return { from: ymd(y, m, d - dow - 7), to: ymd(y, m, d - dow - 1), label };
    case "this_month": return { from: ymd(y, m, 1), to: ymd(y, m, d), label };
    case "last_month": return { from: ymd(y, m - 1, 1), to: ymd(y, m, 0), label };
    case "this_quarter": return { from: ymd(qStartYear, qStartMonth, 1), to: ymd(y, m, d), label };
    case "last_quarter": { const s = new Date(Date.UTC(qStartYear, qStartMonth - 3, 1)); return { from: ymd(s.getUTCFullYear(), s.getUTCMonth(), 1), to: ymd(qStartYear, qStartMonth, 0), label }; }
    case "this_fy": return { from: ymd(fyStart, 3, 1), to: ymd(y, m, d), label: `FY ${fyStart}-${String(fyStart + 1).slice(2)}` };
    case "last_fy": return { from: ymd(fyStart - 1, 3, 1), to: ymd(fyStart, 2, 31), label: `FY ${fyStart - 1}-${String(fyStart).slice(2)}` };
    default: {
      const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
      const to = ok(custom?.to) ?? ymd(y, m, d), from = ok(custom?.from) ?? ymd(y, m, 1);
      return from <= to ? { from, to, label } : { from: to, to: from, label };
    }
  }
}
export const istFrom = (d: string) => new Date(`${d}T00:00:00+05:30`);
export const istTo = (d: string) => new Date(`${d}T23:59:59.999+05:30`);
export const rupees = (p: number) => (p / 100).toFixed(2);
