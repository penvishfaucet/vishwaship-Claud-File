import { INDIA_DISTRICTS, INDIA_STATES, districtKey } from "./india-districts";

/**
 * Tile map of India: every state / UT is one square, placed roughly where it is on the map (column, row).
 * No map-boundary data is needed, so it stays small and readable on a phone.
 */
export const INDIA_TILES: Record<string, { c: number; r: number; abbr: string }> = {
  "Jammu & Kashmir": { c: 2, r: 0, abbr: "JK" }, "Ladakh": { c: 3, r: 0, abbr: "LA" },
  "Chandigarh": { c: 1, r: 1, abbr: "CH" }, "Punjab": { c: 2, r: 1, abbr: "PB" }, "Himachal Pradesh": { c: 3, r: 1, abbr: "HP" }, "Uttarakhand": { c: 4, r: 1, abbr: "UK" },
  "Rajasthan": { c: 1, r: 2, abbr: "RJ" }, "Haryana": { c: 2, r: 2, abbr: "HR" }, "Delhi": { c: 3, r: 2, abbr: "DL" }, "Uttar Pradesh": { c: 4, r: 2, abbr: "UP" },
  "Bihar": { c: 5, r: 2, abbr: "BR" }, "Sikkim": { c: 6, r: 2, abbr: "SK" }, "Arunachal Pradesh": { c: 8, r: 2, abbr: "AR" },
  "Gujarat": { c: 0, r: 3, abbr: "GJ" }, "Madhya Pradesh": { c: 2, r: 3, abbr: "MP" }, "Chhattisgarh": { c: 3, r: 3, abbr: "CG" }, "Jharkhand": { c: 4, r: 3, abbr: "JH" },
  "West Bengal": { c: 5, r: 3, abbr: "WB" }, "Assam": { c: 7, r: 3, abbr: "AS" }, "Nagaland": { c: 8, r: 3, abbr: "NL" },
  "Dadra and Nagar Haveli and Daman and Diu": { c: 0, r: 4, abbr: "DD" }, "Maharashtra": { c: 1, r: 4, abbr: "MH" }, "Telangana": { c: 2, r: 4, abbr: "TG" },
  "Odisha": { c: 4, r: 4, abbr: "OD" }, "Meghalaya": { c: 6, r: 4, abbr: "ML" }, "Tripura": { c: 7, r: 4, abbr: "TR" }, "Manipur": { c: 8, r: 4, abbr: "MN" },
  "Goa": { c: 1, r: 5, abbr: "GA" }, "Karnataka": { c: 2, r: 5, abbr: "KA" }, "Andhra Pradesh": { c: 3, r: 5, abbr: "AP" }, "Mizoram": { c: 8, r: 5, abbr: "MZ" },
  "Lakshadweep": { c: 0, r: 6, abbr: "LD" }, "Kerala": { c: 2, r: 6, abbr: "KL" }, "Tamil Nadu": { c: 3, r: 6, abbr: "TN" }, "Puducherry": { c: 4, r: 6, abbr: "PY" },
  "Andaman and Nicobar Islands": { c: 6, r: 6, abbr: "AN" },
};
export const TILE_COLS = 9, TILE_ROWS = 7;

export type CoverageArea = { franchiseId: string; kind: string; state: string; district: string | null; pincode: string | null; areaKey: string };
export type CoverageFranchise = { id: string; code: string; businessName: string; status: string };

export type StateCoverage = {
  state: string; totalDistricts: number; heldDistricts: number; pins: number;
  franchises: CoverageFranchise[];
  districts: Array<{ name: string; listed: boolean; holder: CoverageFranchise | null; pins: Array<{ pincode: string; holder: CoverageFranchise }> }>;
};

/** Per-state coverage from the live areas (district holders, extra PINs) and the franchises that hold them. */
export function computeCoverage(areas: CoverageArea[], franchises: CoverageFranchise[]): StateCoverage[] {
  const fr = new Map(franchises.map((f) => [f.id, f]));
  return INDIA_STATES.map((state) => {
    const mine = areas.filter((a) => a.state === state && fr.has(a.franchiseId));
    const listed = INDIA_DISTRICTS[state] ?? [];
    const held = new Map(mine.filter((a) => a.kind === "district").map((a) => [a.areaKey, a]));
    const typed = mine.filter((a) => a.kind === "district" && !listed.some((d) => districtKey(state, d) === a.areaKey)).map((a) => a.district!);
    const pinDistricts = mine.filter((a) => a.kind === "pincode").map((a) => a.district ?? "").filter((d) => d && !listed.some((x) => districtKey(state, x) === districtKey(state, d)) && !typed.some((x) => districtKey(state, x) === districtKey(state, d)));
    const names = [...listed.map((n) => ({ n, listed: true })), ...[...new Set([...typed, ...pinDistricts])].map((n) => ({ n, listed: false }))];
    const districts = names.map(({ n, listed: isListed }) => {
      const key = districtKey(state, n);
      const h = held.get(key);
      return {
        name: n, listed: isListed, holder: h ? fr.get(h.franchiseId)! : null,
        pins: mine.filter((a) => a.kind === "pincode" && a.district && districtKey(state, a.district) === key).map((a) => ({ pincode: a.pincode!, holder: fr.get(a.franchiseId)! })),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const ids = [...new Set(mine.map((a) => a.franchiseId))];
    return {
      state, totalDistricts: districts.length, heldDistricts: districts.filter((d) => d.holder).length, pins: mine.filter((a) => a.kind === "pincode").length,
      franchises: ids.map((id) => fr.get(id)!).sort((a, b) => a.code.localeCompare(b.code)), districts,
    };
  });
}

/** Colour step 0..4 for a tile: 0 = nothing, 1 = only PINs, 2..4 = share of districts held. */
export function coverageLevel(s: Pick<StateCoverage, "totalDistricts" | "heldDistricts" | "pins">) {
  if (!s.heldDistricts) return s.pins ? 1 : 0;
  const share = s.heldDistricts / Math.max(1, s.totalDistricts);
  return share >= 0.66 ? 4 : share >= 0.33 ? 3 : 2;
}
