import "server-only";
import { guessPincode } from "@/lib/pincodes";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * PIN → City/District + State. Source: India Post public directory (api.postalpincode.in), cached in memory.
 * Only the 6-digit PIN is sent. The directory is sometimes slow or briefly answers "Error" for a real PIN,
 * so each lookup tries twice; if it is still down we fall back to the offline state guess (marked partial)
 * instead of failing the form. A "no match" is remembered for 1 hour only, so a hiccup never sticks.
 */
export type PinResult = { status: "found"; city: string; state: string; locality?: string; source: "india_post" | "offline"; partial?: boolean } | { status: "not_found" } | { status: "error"; message: string };
const cache = new Map<string, { at: number; ttl: number; v: PinResult }>();
const FOUND_TTL = 7 * 86400_000, MISS_TTL = 3600_000;

type Answer = Array<{ Status?: string; PostOffice?: Array<{ Name?: string; District?: string; State?: string; Block?: string }> | null }>;

async function askIndiaPost(pin: string, timeoutMs: number): Promise<PinResult> {
  const r = await safeFetch(`https://api.postalpincode.in/pincode/${pin}`, { timeoutMs, allowedHosts: ["api.postalpincode.in"] });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as Answer;
  const po = j?.[0]?.PostOffice?.find((p) => p?.State) ?? null;
  if (j?.[0]?.Status === "Success" && po?.State) return { status: "found", city: po.District || po.Block || "", state: po.State, locality: po.Name || undefined, source: "india_post" };
  return { status: "not_found" };
}

export async function lookupPincode(pin: string): Promise<PinResult> {
  if (!/^[1-9]\d{5}$/.test(pin)) return { status: "not_found" };
  const hit = cache.get(pin);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
  let v: PinResult | null = null;
  let err: Error | null = null;
  for (const timeoutMs of [5000, 7000]) {
    try {
      v = await askIndiaPost(pin, timeoutMs);
      if (v.status === "found") break; // a "no match" is asked once more: the directory sometimes says Error for a real PIN
    } catch (e) { err = e as Error; }
  }
  if (v?.status === "found" || (v?.status === "not_found" && !err)) {
    cache.set(pin, { at: Date.now(), ttl: v.status === "found" ? FOUND_TTL : MISS_TTL, v });
    if (cache.size > 20_000) cache.clear();
    return v;
  }
  // directory down: suggest the state from the PIN's prefix (the user can correct it), never cached
  const g = guessPincode(pin);
  if (g.state) return { status: "found", city: g.city ?? "", state: g.state, source: "offline", partial: !g.city };
  if (v?.status === "not_found") return v;
  return { status: "error", message: `PIN lookup service unavailable (${err?.message ?? "no answer"})` };
}
