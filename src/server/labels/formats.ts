import { type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";
import type { LabelFormat } from "@/server/providers/types";

/**
 * Where each Download Label format comes from.
 *  - branded:  the Vishwaship label, drawn from the booking (all sizes; one label per carton). The barcode is the
 *              carrier's own identifier (AWB / LRN and the carton waybill) in Code 128, which these carriers scan.
 *  - carrier:  the courier's original label, untouched (requested from the courier API in its own format).
 *  - unavailable: with the reason shown in the menu.
 */
type Source = { kind: "branded" } | { kind: "carrier"; carrierFormat: LabelFormat } | { kind: "unavailable"; reason: string };

/** Courier label formats each integration can return; first = the courier's default size. */
export const CARRIER_NATIVE: Record<string, LabelFormat[]> = {
  delhivery_b2b: ["thermal_3x4", "thermal_4x4", "thermal_2x4", "a4"],
  delhivery_b2c: ["thermal_4x6", "a4"],
  shipmozo: ["thermal_4x6"],
};

/**
 * Carrier rules for the Vishwaship label. `carrierLabelAdvised`: the courier's own label carries routing / sort codes
 * that its API does not give us; the hub may ask for it — the Carrier label is always offered next to ours.
 */
export const CARRIER_POLICY: Record<string, { carrierLabelAdvised: boolean; note?: string }> = {
  delhivery_b2b: { carrierLabelAdvised: true, note: "Delhivery's own label adds its routing codes. If the pickup team asks for it, print the Carrier label too." },
  delhivery_b2c: { carrierLabelAdvised: true, note: "Delhivery's own label adds its sort code. If the pickup team asks for it, print the Carrier label too." },
  shipmozo: { carrierLabelAdvised: true, note: "The courier's own label adds its routing code. If the pickup team asks for it, print the Carrier label too." },
  shiporax: { carrierLabelAdvised: true },
};

export function labelSource(provider: string, f: PrintFormat): Source {
  if (f !== "original") return { kind: "branded" };
  if (provider === "demo") return { kind: "branded" }; // the demo courier has no label of its own
  const native = CARRIER_NATIVE[provider];
  if (!native) return { kind: "unavailable", reason: provider === "shiporax" ? "Open this shipment's label from its order page" : "This courier's own label is not available through Vishwaship yet" };
  return { kind: "carrier", carrierFormat: native[0] };
}

/** Per-format availability for a shipment's menu. */
export function labelFormatsFor(provider: string): Array<{ key: PrintFormat; name: string; ok: boolean; reason?: string }> {
  return PRINT_FORMATS.filter((p) => !(provider === "demo" && p.key === "original")).map((p) => {
    const s = labelSource(provider, p.key);
    return { key: p.key, name: p.name, ok: s.kind !== "unavailable", reason: s.kind === "unavailable" ? s.reason : undefined };
  });
}
