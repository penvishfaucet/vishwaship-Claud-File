import { type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";
import type { LabelFormat } from "@/server/providers/types";

/**
 * Labels come in two sizes — A4 (4 per sheet) and thermal 4 × 6 in — plus the courier's own label.
 *  - matched:  the Vishwaship label for a courier with a label API. The courier's own label is fetched and read: one
 *              Vishwaship label per courier label, carrying exactly the barcodes read from it (same numbers, Code 128)
 *              and its 2D code. If any barcode cannot be read, that shipment gets the courier's own label instead.
 *  - carrier:  the courier's own label file, untouched except our account name / logo ("original").
 *  - branded:  the Vishwaship label drawn from the booking — the demo courier and couriers without a label API.
 *  - unavailable: with the reason shown in the menu.
 */
type Source = { kind: "branded" } | { kind: "carrier"; carrierFormat: LabelFormat } | { kind: "matched"; carrierFormat: LabelFormat } | { kind: "unavailable"; reason: string };

/** The two label sizes (plus the courier's own label). Older saved choices map to the nearest one. */
export const LABEL_SIZES: PrintFormat[] = ["a4_4up", "thermal_4x6"];
export function normalizeLabelFormat(f: string | null | undefined): PrintFormat {
  if (f === "original") return "original";
  return PRINT_FORMATS.find((p) => p.key === f)?.group === "thermal" ? "thermal_4x6" : "a4_4up";
}

/** Courier label formats each integration can return; first = the courier's default size. */
export const CARRIER_NATIVE: Record<string, LabelFormat[]> = {
  delhivery_b2b: ["thermal_3x4", "thermal_4x4", "thermal_2x4", "a4"],
  delhivery_b2c: ["thermal_4x6", "a4"],
  shipmozo: ["thermal_4x6"],
};

/** Carrier rules for the drawn Vishwaship label (couriers without a label API). */
export const CARRIER_POLICY: Record<string, { carrierLabelAdvised: boolean; note?: string }> = {
  shiporax: { carrierLabelAdvised: true },
};

/** The courier's own size closest to what was asked: the same size if the courier has it, A4 for A4 sheets, else its default. */
export function carrierFormatFor(provider: string, f: PrintFormat): LabelFormat | null {
  const native = CARRIER_NATIVE[provider];
  if (!native) return null;
  if (native.includes(f as LabelFormat)) return f as LabelFormat;
  if (PRINT_FORMATS.find((p) => p.key === f)?.group === "a4" && native.includes("a4")) return "a4";
  return native[0];
}

export function labelSource(provider: string, f: PrintFormat): Source {
  const native = CARRIER_NATIVE[provider];
  // the courier's A4 render is its largest image: its barcodes read most reliably
  if (native && f !== "original") return { kind: "matched", carrierFormat: native.includes("a4") ? "a4" : native[0] };
  const carrierFormat = carrierFormatFor(provider, f);
  if (carrierFormat) return { kind: "carrier", carrierFormat };
  if (f !== "original") return { kind: "branded" };
  if (provider === "demo") return { kind: "branded" }; // the demo courier has no label of its own
  return { kind: "unavailable", reason: provider === "shiporax" ? "Open this shipment's label from its order page" : "This courier's own label is not available through Vishwaship yet" };
}

/** Per-format availability for a shipment's menu. */
export function labelFormatsFor(provider: string): Array<{ key: PrintFormat; name: string; ok: boolean; reason?: string }> {
  return PRINT_FORMATS.filter((p) => (LABEL_SIZES.includes(p.key) || p.key === "original") && !(provider === "demo" && p.key === "original")).map((p) => {
    const s = labelSource(provider, p.key);
    return { key: p.key, name: p.name, ok: s.kind !== "unavailable", reason: s.kind === "unavailable" ? s.reason : undefined };
  });
}
