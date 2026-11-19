import type { ComponentCode, ProviderQuoteComponent } from "@/server/pricing/engine";

/**
 * Helpers shared by the Delhivery adapters. Delhivery's developer portal documents requests but not
 * response bodies, so responses are parsed defensively (several known field spellings) and a quote is
 * only returned when a positive base freight is found — a missing rate is never shown as ₹0.
 */
export async function jsonOrNull(r: Response): Promise<unknown> {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t ? { raw: t.slice(0, 500) } : null; }
}

/** Read the first non-empty value at any of the dotted paths (array indexes allowed: "data.0.x"). */
export function firstString(obj: unknown, paths: string[]): string | null {
  for (const p of paths) {
    let cur: unknown = obj;
    for (const k of p.split(".")) {
      if (cur == null) break;
      cur = Array.isArray(cur) ? cur[Number(k)] : (cur as Record<string, unknown>)[k];
    }
    if (cur != null && cur !== "" && (typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean")) return String(cur);
  }
  return null;
}

export function providerError(j: unknown, fallback: string) {
  const m = firstString(j, ["error.message", "message", "error", "detail", "rmk", "data.message", "packages.0.remarks.0", "remarks", "raw"]);
  return (m ? `${fallback}: ${m}` : fallback).slice(0, 300);
}

export const rupees = (paise: number) => Math.round(paise) / 100;
export function amountToPaise(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[,₹\s]/g, "")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const TAX = /(^|_)(gst|igst|cgst|sgst|utgst|tax|taxes)(_|$)/i;
const TOTAL = /(^|_)(total|grand|gross|net_amount|amount_payable|final)/i;
function classify(key: string): { code: ComponentCode; label: string } | null {
  const k = key.toLowerCase();
  if (/green/.test(k)) return { code: "docket", label: "Green tax" }; // a carrier charge, not GST
  if (TAX.test(k) || TOTAL.test(k)) return null;
  // request echoes / non-money fields
  if (/cod_amount|inv_amount|invoice|weight|wt$|pin|box|count|length|width|height|_cm$|_g$|tat|days|zone|rate$|percent|pct/.test(k)) return null;
  if (/(^|_)(base_freight|freight_charge|basic_freight|freight|base|min_freight|charge_dl)$/.test(k) || k === "freight_charges") return { code: "freight", label: "Base freight" };
  if (/fuel|fsc|charge_fs/.test(k)) return { code: "fuel", label: "Fuel surcharge" };
  if (/rov|fov|insurance|risk/.test(k)) return { code: "fov", label: "ROV / insurance" };
  if (/oda|odc|remote/.test(k)) return { code: "oda", label: "ODA charge" };
  if (/fod/.test(k)) return { code: "other", label: "FOD charge" };
  if (/cod|charge_cod|charge_ccod/.test(k)) return { code: "cod_fee", label: "COD charge" };
  if (/docket|lr_charge|lr_fee|green|dph|charge_dph/.test(k)) return { code: "docket", label: "Docket / handling" };
  if (/handling|appointment|labour|loading|warai|mathadi/.test(k)) return { code: "handling", label: "Handling" };
  if (/charge|fee|surcharge/.test(k)) return { code: "other", label: key.replace(/_/g, " ") };
  return null;
}

const CONTAINER = /^(data|result|details|price|price_breakup|breakup|break_up|charges|freight|freight_charges|meta_charges)$/i;
type Pair = [string, number, string]; // [key, value, path]

/**
 * Collect every numeric field of the breakup, including nested charge objects. Children of a container
 * (data / price_breakup / meta_charges …) keep their own key; children of a charge object are prefixed with it,
 * e.g. Delhivery's `oda: { fm: 0, lm: 750 }` becomes oda_fm / oda_lm (missed before 2026-11-19 — ₹750 ODA on 768028).
 */
function collect(obj: unknown, depth = 0, out: Pair[] = [], prefix = "", path = ""): Pair[] {
  if (!obj || typeof obj !== "object" || depth > 5) return out;
  if (Array.isArray(obj)) { if (obj.length) collect(obj[0], depth + 1, out, prefix, path); return out; }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}_${k}` : k;
    const at = path ? `${path}.${k}` : k;
    if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) out.push([key, Number(v), at]);
    else if (v && typeof v === "object") collect(v, depth + 1, out, CONTAINER.test(k) ? prefix : key, at);
  }
  return out;
}

function toComponents(pairs: Array<[string, number] | Pair>): ProviderQuoteComponent[] {
  const byCode = new Map<string, ProviderQuoteComponent>();
  for (const [k, v] of pairs) {
    if (!(v > 0)) continue;
    const c = classify(k);
    if (!c) continue;
    const key = c.code === "other" ? `other:${c.label}` : c.code;
    const prev = byCode.get(key);
    byCode.set(key, { code: c.code, label: c.label, amount: (prev?.amount ?? 0) + amountToPaise(v) });
  }
  return [...byCode.values()];
}

/** B2B /freight/estimate → components (pre-tax, paise) + chargeable weight if returned. */
export function b2bCharges(j: unknown): { components: ProviderQuoteComponent[]; chargeableGrams?: number } | null {
  const all = collect(j);
  // Delhivery states its own pre-tax total. When it does, that total is the truth: meta_charges (to_pay, cod …) are
  // informational and not part of it, and any charge we do not recognise is added as one line so we never quote less.
  const preTax = all.find(([k]) => /(^|_)pre_tax(_freight)?(_charges?)?$/i.test(k))?.[1];
  const pairs = preTax ? all.filter(([, , at]) => !/(^|\.)meta_charges\./i.test(at)) : all;
  const components = toComponents(pairs);
  if (!components.some((c) => c.code === "freight")) return null;
  if (preTax) {
    const diff = amountToPaise(preTax) - components.reduce((t, c) => t + c.amount, 0);
    if (diff > 100) components.push({ code: "other", label: "Other Delhivery charges", amount: diff });
  }
  const cw = pairs.find(([k]) => /charged_wt|chargeable_weight|charged_weight|billed_weight/i.test(k))?.[1];
  return { components, chargeableGrams: cw ? (cw < 1000 ? Math.round(cw * 1000) : Math.round(cw)) : undefined };
}

/** B2C kinko invoice charges → components (pre-tax, paise). */
export function b2cCharges(j: unknown): ProviderQuoteComponent[] | null {
  const row = Array.isArray(j) ? j[0] : j;
  if (!row || typeof row !== "object") return null;
  const pairs = Object.entries(row as Record<string, unknown>).filter(([k, v]) => /^charge_/i.test(k) && Number(v) > 0).map(([k, v]) => [k, Number(v)] as [string, number]);
  let components = toComponents(pairs);
  if (!components.some((c) => c.code === "freight")) {
    const gross = Number((row as Record<string, unknown>).gross_amount);
    if (gross > 0) components = [{ code: "freight", label: "Base freight", amount: amountToPaise(gross) - components.reduce((t, c) => t + c.amount, 0) }, ...components];
  }
  return components.some((c) => c.code === "freight" && c.amount > 0) ? components : null;
}

/** Pickup executive details, when the courier returns them with a pickup request (field names vary by API). */
export function pickupAgent(j: unknown): { agentName?: string; agentPhone?: string } {
  const name = firstString(j, ["pickup_executive_name", "executive_name", "fe_name", "rider_name", "agent_name", "data.pickup_executive_name", "data.executive_name", "data.fe_name", "data.rider_name", "data.agent_name"]);
  const phone = firstString(j, ["pickup_executive_phone", "executive_phone", "executive_mobile", "fe_phone", "fe_mobile", "rider_phone", "agent_phone", "data.pickup_executive_phone", "data.executive_phone", "data.executive_mobile", "data.fe_phone", "data.rider_phone", "data.agent_phone"]);
  const digits = phone?.replace(/\D/g, "").slice(-10);
  return { ...(name ? { agentName: name.slice(0, 80) } : {}), ...(digits && digits.length === 10 ? { agentPhone: digits } : {}) };
}
