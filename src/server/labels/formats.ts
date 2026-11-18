import { type PrintFormat, MIN_SCALE, PRINT_FORMATS, fitScale } from "@/lib/order-view";
import type { LabelFormat } from "@/server/providers/types";

/**
 * How each provider's real label becomes each print layout.
 *  - native:  the carrier renders that size itself (we request it).
 *  - scaled:  we place the carrier's own label (image or PDF page) onto the page, scaled only
 *             down to MIN_SCALE so bars, quiet zones and mandatory text stay readable.
 *  - generated: Vishwaship draws the label (demo courier only — never for live carriers).
 */
type Source = { kind: "native"; carrierFormat: LabelFormat } | { kind: "scaled"; carrierFormat: LabelFormat; mm: [number, number] } | { kind: "generated" } | { kind: "unavailable"; reason: string };

const MM: Partial<Record<LabelFormat, [number, number]>> = { thermal_4x6: [101.6, 152.4], thermal_3x4: [76.2, 101.6], thermal_4x4: [101.6, 101.6], thermal_2x4: [50.8, 101.6], thermal_38x100: [38, 100], a4: [210, 297] };

/** Formats the carrier itself renders; first entry = its original/default label. */
const CARRIER_NATIVE: Record<string, LabelFormat[]> = {
  delhivery_b2b: ["thermal_3x4", "thermal_4x4", "thermal_2x4", "a4"],
  delhivery_b2c: ["thermal_4x6", "a4"],
};

export function labelSource(provider: string, f: PrintFormat): Source {
  if (provider === "demo") return { kind: "generated" };
  const native = CARRIER_NATIVE[provider];
  if (!native) return { kind: "unavailable", reason: "This courier's labels are not available through Vishwaship yet" };
  if (f === "original") return { kind: "native", carrierFormat: native[0] };
  if (native.includes(f)) return { kind: "native", carrierFormat: f };
  const page = PRINT_FORMATS.find((p) => p.key === f)!.mm!;
  // smallest-loss scaling from any thermal format the carrier offers
  const best = native.filter((n) => n !== "a4").map((n) => ({ n, s: fitScale(MM[n]!, page) })).sort((a, b) => b.s - a.s)[0];
  if (best && best.s >= MIN_SCALE) return { kind: "scaled", carrierFormat: best.n, mm: MM[best.n]! };
  return { kind: "unavailable", reason: `The courier's label cannot be reduced to ${PRINT_FORMATS.find((p) => p.key === f)!.name} without making the barcode unreadable` };
}

/** Per-format availability for the row menu. */
export function labelFormatsFor(provider: string): Array<{ key: PrintFormat; name: string; ok: boolean; reason?: string }> {
  return PRINT_FORMATS.map((p) => {
    const s = labelSource(provider, p.key);
    return { key: p.key, name: p.name, ok: s.kind !== "unavailable", reason: s.kind === "unavailable" ? s.reason : s.kind === "scaled" ? "Carrier label scaled to fit" : undefined };
  });
}
