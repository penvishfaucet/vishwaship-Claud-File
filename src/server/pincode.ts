import "server-only";
import { guessPincode } from "@/lib/pincodes";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * PIN → City/District + State. Source: India Post public directory (api.postalpincode.in), cached in memory for 7 days.
 * Only the 6-digit PIN is sent. Falls back to the offline state guess when the service is down (marked partial).
 */
export type PinResult = { status: "found"; city: string; state: string; source: "india_post" | "offline"; partial?: boolean } | { status: "not_found" } | { status: "error"; message: string };
const cache = new Map<string, { at: number; v: PinResult }>();

export async function lookupPincode(pin: string): Promise<PinResult> {
  if (!/^[1-9]\d{5}$/.test(pin)) return { status: "not_found" };
  const hit = cache.get(pin);
  if (hit && Date.now() - hit.at < 7 * 86400_000) return hit.v;
  let v: PinResult;
  try {
    const r = await safeFetch(`https://api.postalpincode.in/pincode/${pin}`, { timeoutMs: 6000, allowedHosts: ["api.postalpincode.in"] });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as Array<{ Status?: string; PostOffice?: Array<{ District?: string; State?: string; Block?: string }> | null }>;
    const po = j?.[0]?.PostOffice?.[0];
    v = j?.[0]?.Status === "Success" && po?.State ? { status: "found", city: po.District ?? po.Block ?? "", state: po.State, source: "india_post" } : { status: "not_found" };
  } catch (e) {
    const g = guessPincode(pin);
    if (g.state) return { status: "found", city: g.city ?? "", state: g.state, source: "offline", partial: !g.city };
    return { status: "error", message: `PIN lookup service unavailable (${(e as Error).message})` };
  }
  cache.set(pin, { at: Date.now(), v });
  if (cache.size > 20_000) cache.clear();
  return v;
}
