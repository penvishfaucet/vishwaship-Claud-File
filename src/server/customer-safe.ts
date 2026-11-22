/**
 * Customers must never see which aggregator Vishwaship books through (Shipmozo, Shipora X, Shiprocket) — only Admin does.
 * Real carriers (Delhivery, Blue Dart, …) may be named. Applied to every message that reaches the customer
 * portal, the public calculator and the customer API.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/(?:https?:\/\/)?[a-z0-9.-]*shiprocket\.(?:in|co|com)\S*/gi, "courier partner"], // links first, before the name
  [/\bship\s*mozo\b/gi, "courier partner"], [/\bshipora\s*x\b/gi, "courier partner"], [/\bshiporax\b/gi, "courier partner"], [/\bshipora\b/gi, "courier partner"], [/\bship\s*rocket\b/gi, "courier partner"],
  [/\b(shipping-api\.com|shiporax\.com)\S*/gi, "courier partner"],
];
export function hideProviders(msg: string | null | undefined): string {
  let s = String(msg ?? "");
  for (const [re, to] of PATTERNS) s = s.replace(re, to);
  return s.replace(/(courier partner)(\s*[:·-]\s*courier partner)+/gi, "$1").replace(/^courier partner/, "Courier partner");
}
