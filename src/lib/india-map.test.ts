import { describe, expect, it } from "vitest";
import { INDIA_STATES, districtKey, pincodeKey } from "./india-districts";
import { INDIA_TILES, TILE_COLS, TILE_ROWS, computeCoverage, coverageLevel } from "./india-map";

describe("India tile map", () => {
  it("every state / UT has exactly one tile, inside the grid, with no overlaps", () => {
    expect(Object.keys(INDIA_TILES).sort()).toEqual([...INDIA_STATES].sort());
    const spots = Object.values(INDIA_TILES).map((t) => `${t.c},${t.r}`);
    expect(new Set(spots).size).toBe(spots.length);
    for (const t of Object.values(INDIA_TILES)) { expect(t.c).toBeLessThan(TILE_COLS); expect(t.r).toBeLessThan(TILE_ROWS); }
    const abbrs = Object.values(INDIA_TILES).map((t) => t.abbr);
    expect(new Set(abbrs).size).toBe(abbrs.length);
  });

  it("coverage counts districts and PINs per state and names the holder", () => {
    const fr = [{ id: "f1", code: "VSF-0001", businessName: "Pune Co", status: "active" }, { id: "f2", code: "VSF-0002", businessName: "Solapur Co", status: "suspended" }];
    const areas = [
      { franchiseId: "f1", kind: "district", state: "Maharashtra", district: "Pune", pincode: null, areaKey: districtKey("Maharashtra", "Pune") },
      { franchiseId: "f2", kind: "pincode", state: "Maharashtra", district: "Solapur", pincode: "413001", areaKey: pincodeKey("413001") },
      { franchiseId: "f1", kind: "district", state: "Maharashtra", district: "New Dist", pincode: null, areaKey: districtKey("Maharashtra", "New Dist") },
    ];
    const mh = computeCoverage(areas, fr).find((s) => s.state === "Maharashtra")!;
    expect(mh.heldDistricts).toBe(2);
    expect(mh.totalDistricts).toBe(37); // 36 listed + 1 typed
    expect(mh.pins).toBe(1);
    expect(mh.franchises.map((f) => f.code)).toEqual(["VSF-0001", "VSF-0002"]);
    expect(mh.districts.find((d) => d.name === "Pune")?.holder?.code).toBe("VSF-0001");
    expect(mh.districts.find((d) => d.name === "Solapur")).toMatchObject({ holder: null, pins: [{ pincode: "413001" }] });
    expect(mh.districts.find((d) => d.name === "New Dist")?.listed).toBe(false);
    expect(coverageLevel(mh)).toBe(2);
    const goa = computeCoverage([{ franchiseId: "f1", kind: "district", state: "Goa", district: "North Goa", pincode: null, areaKey: districtKey("Goa", "North Goa") }], fr).find((s) => s.state === "Goa")!;
    expect(coverageLevel(goa)).toBe(3);
    expect(coverageLevel({ totalDistricts: 10, heldDistricts: 0, pins: 0 })).toBe(0);
    expect(coverageLevel({ totalDistricts: 10, heldDistricts: 0, pins: 2 })).toBe(1);
    expect(coverageLevel({ totalDistricts: 3, heldDistricts: 2, pins: 0 })).toBe(4);
  });
});
