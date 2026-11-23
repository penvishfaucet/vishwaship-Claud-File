/**
 * Per-piece costs of a store product on top of its purchase cost (owner 2026-11-23): packaging (box, tape, filler),
 * labour / handling, other variable costs, and a share of overheads (rent, salaries … spread per piece).
 * Stored on store_products.cost_extras; the full cost per piece = purchase cost + these.
 */
export type CostExtras = { packagingPaise: number; labourPaise: number; otherPaise: number; overheadPaise: number };
export const EXTRA_FIELDS = [
  { key: "packagingPaise", label: "Packaging", hint: "box, tape, bubble wrap, label", csv: "packaging_cost" },
  { key: "labourPaise", label: "Labour / handling", hint: "packing, quality check", csv: "labour_cost" },
  { key: "otherPaise", label: "Other variable cost", hint: "freebie, printing, commission", csv: "other_cost" },
  { key: "overheadPaise", label: "Overheads per piece", hint: "share of rent, salaries, electricity", csv: "overhead_cost" },
] as const;

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
export function readExtras(raw: unknown): CostExtras {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { packagingPaise: n(r.packagingPaise), labourPaise: n(r.labourPaise), otherPaise: n(r.otherPaise), overheadPaise: n(r.overheadPaise) };
}
export const extrasTotal = (raw: unknown) => { const x = readExtras(raw); return x.packagingPaise + x.labourPaise + x.otherPaise + x.overheadPaise; };
