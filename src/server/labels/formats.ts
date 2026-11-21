import { type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";
import type { LabelFormat } from "@/server/providers/types";

/**
 * Where each Download Label format comes from.
 *  - carrier:  the courier's own label file, pages and barcodes untouched (the hub scans these). Used for EVERY size
 *              of a courier with a label API: the chosen size only picks which of the courier's own sizes to ask for.
 *              `document`: an LR booking (Delhivery B2B) also gets its shipment document after the labels;
 *              an AWB booking (B2C, Shipmozo) gets only the courier's label, exactly as the courier gives it.
 *  - branded:  the Vishwaship label drawn from the booking — only for the demo courier and couriers without a label API.
 *  - unavailable: with the reason shown in the menu.
 */
type Source = { kind: "branded" } | { kind: "carrier"; carrierFormat: LabelFormat; document: boolean } | { kind: "unavailable"; reason: string };

/** Courier label formats each integration can return; first = the courier's default size. */
export const CARRIER_NATIVE: Record<string, LabelFormat[]> = {
  delhivery_b2b: ["thermal_3x4", "thermal_4x4", "thermal_2x4", "a4"],
  delhivery_b2c: ["thermal_4x6", "a4"],
  shipmozo: ["thermal_4x6"],
};

/** Couriers whose booking is an LR (lorry receipt): their labels come with the shipment document. */
const LR_PROVIDERS = new Set(["delhivery_b2b"]);

/** The courier's own size closest to what was asked: the same size if the courier has it, A4 for A4 sheets, else its default. */
export function carrierFormatFor(provider: string, f: PrintFormat): LabelFormat | null {
  const native = CARRIER_NATIVE[provider];
  if (!native) return null;
  if (native.includes(f as LabelFormat)) return f as LabelFormat;
  const group = PRINT_FORMATS.find((p) => p.key === f)?.group;
  if (group === "a4" && native.includes("a4")) return "a4";
  return native[0];
}

export function labelSource(provider: string, f: PrintFormat): Source {
  const carrierFormat = carrierFormatFor(provider, f);
  if (carrierFormat) return { kind: "carrier", carrierFormat, document: LR_PROVIDERS.has(provider) };
  if (f !== "original") return { kind: "branded" };
  if (provider === "demo") return { kind: "branded" }; // the demo courier has no label of its own
  return { kind: "unavailable", reason: provider === "shiporax" ? "Open this shipment's label from its order page" : "This courier's own label is not available through Vishwaship yet" };
}

/** Per-format availability for a shipment's menu. */
export function labelFormatsFor(provider: string): Array<{ key: PrintFormat; name: string; ok: boolean; reason?: string }> {
  return PRINT_FORMATS.filter((p) => !(provider === "demo" && p.key === "original")).map((p) => {
    const s = labelSource(provider, p.key);
    return { key: p.key, name: p.name, ok: s.kind !== "unavailable", reason: s.kind === "unavailable" ? s.reason : undefined };
  });
}
