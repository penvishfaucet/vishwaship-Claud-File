import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { activationChecklist, depositSummary, termState } from "@/lib/franchise";
import { canonicalDistrict, canonicalState, districtKey } from "@/lib/india-districts";

// Real SQL on in-memory PGlite.
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const s = await import("./service");
const ADMIN = "u_admin";
const base = { businessName: "Pune Logistics", ownerName: "Ravi Patil", mobile: "9876543210", email: "ravi@example.test", depositRupees: 50_000, monthlyTarget: 300, termStart: "2026-11-01", termEnd: "2027-10-31", pan: "ABCDE1234F", line1: "Shop 4, FC Road", city: "Pune", state: "Maharashtra", pincode: "411004" };
const pins: Record<string, { status: string; city?: string; state?: string; source?: string; partial?: boolean }> = {
  "411001": { status: "found", city: "Pune", state: "Maharashtra", source: "india_post" },
  "413001": { status: "found", city: "Solapur", state: "Maharashtra", source: "india_post" },
  "413002": { status: "found", city: "Solapur", state: "Maharashtra", source: "india_post" },
  "400001": { status: "found", city: "", state: "Maharashtra", source: "offline", partial: true },
};
const lookup = async (p: string) => pins[p] ?? { status: "not_found" };

beforeAll(async () => { await migrate(db, { migrationsFolder: "./migrations" }); });

describe("pure rules", () => {
  it("state and district names are matched loosely; & equals and", () => {
    expect(canonicalState("jammu and kashmir")).toBe("Jammu & Kashmir");
    expect(canonicalState("Narnia")).toBeNull();
    expect(canonicalDistrict("Maharashtra", "  pune ")).toEqual({ name: "Pune", known: true });
    expect(canonicalDistrict("Maharashtra", "New District")).toEqual({ name: "New District", known: false });
    expect(districtKey("Maharashtra", "PUNE")).toBe(districtKey("maharashtra", "pune"));
  });
  it("deposit summary", () => {
    expect(depositSummary(0, []).state).toBe("not_required");
    expect(depositSummary(5000, []).state).toBe("pending");
    const part = depositSummary(5000, [{ amountPaise: 2000, status: "held", refundPaise: 0, forfeitPaise: 0 }]);
    expect(part).toMatchObject({ state: "partial", heldPaise: 2000, duePaise: 3000 });
    expect(depositSummary(5000, [{ amountPaise: 5000, status: "refunded", refundPaise: 5000, forfeitPaise: 0 }]).state).toBe("closed");
  });
  it("term state and checklist", () => {
    const now = new Date("2026-11-21T00:00:00Z");
    expect(termState(null, now)).toBe("none");
    expect(termState(new Date("2026-12-01T00:00:00Z"), now)).toBe("ending");
    expect(termState(new Date("2026-11-01T00:00:00Z"), now)).toBe("ended");
    const c = activationChecklist({ kycVerifiedAt: null, agreementSignedAt: null, termsVersion: null, termStart: null, termEnd: null }, 0, { requiredPaise: 100, heldPaise: 0 }, 1, now);
    expect(c.every((x) => !x.ok)).toBe(true);
  });
});

describe("franchise lifecycle", () => {
  let A = "", B = "";
  it("creates franchises with sequential codes and validates input", async () => {
    A = await s.createFranchise(ADMIN, base);
    B = await s.createFranchise(ADMIN, { ...base, businessName: "Solapur Express", email: "s@example.test" });
    expect((await s.getFranchise(A))?.code).toBe("VSF-0001");
    expect((await s.getFranchise(B))?.code).toBe("VSF-0002");
    expect((await s.getFranchise(A))?.depositRequiredPaise).toBe(5_000_000);
    await expect(s.createFranchise(ADMIN, { ...base, mobile: "12345" })).rejects.toThrow(/mobile/);
    await expect(s.createFranchise(ADMIN, { ...base, termEnd: "2026-10-01" })).rejects.toThrow(/after the start/);
    await expect(s.createFranchise(ADMIN, { ...base, gstin: "BAD" })).rejects.toThrow(/GSTIN/);
  });

  it("areas are exclusive across franchises, PINs inside a held district are refused", async () => {
    expect(await s.addDistrict(ADMIN, A, "maharashtra", "pune")).toMatchObject({ state: "Maharashtra", district: "Pune", known: true });
    await expect(s.addDistrict(ADMIN, B, "Maharashtra", "PUNE")).rejects.toThrow(/belongs to Pune Logistics \(VSF-0001\)/);
    await expect(s.addDistrict(ADMIN, A, "Maharashtra", "Pune")).rejects.toThrow(/already has/);
    await expect(s.addPincode(ADMIN, B, "411001", lookup)).rejects.toThrow(/in Pune, which belongs to Pune Logistics/);
    await expect(s.addDistrict(ADMIN, A, "Atlantis", "X")).rejects.toThrow(/state/);
    // offline directory (no district) never allows a PIN, so exclusivity cannot be bypassed
    await expect(s.addPincode(ADMIN, B, "400001", lookup)).rejects.toThrow(/not answering/);
    await expect(s.addPincode(ADMIN, B, "999999", lookup)).rejects.toThrow(/valid|not found/);
  });

  it("a district cannot be given while another franchise holds a PIN in it; own PINs merge into the district", async () => {
    await s.addPincode(ADMIN, B, "413001", lookup);
    await expect(s.addPincode(ADMIN, A, "413001", lookup)).rejects.toThrow(/already belongs to Solapur Express/);
    await expect(s.addDistrict(ADMIN, A, "Maharashtra", "Solapur")).rejects.toThrow(/PIN 413001 in Solapur belongs to Solapur Express/);
    await s.addPincode(ADMIN, B, "413002", lookup);
    await s.addDistrict(ADMIN, B, "Maharashtra", "Solapur");
    const live = await s.areasOf(B);
    expect(live.map((a) => a.kind)).toEqual(["district"]);
    expect((await s.areaStatus("Maharashtra", "Solapur")).holder?.code).toBe("VSF-0002");
    expect((await s.areaStatus("Maharashtra", "Satara")).holder).toBeNull();
  });

  it("the database itself refuses a second live holder of an area", async () => {
    const [a] = await s.areasOf(A);
    await expect(db.insert(schema.franchiseAreas).values({ id: "fra_dupe", franchiseId: B, kind: "district", state: "Maharashtra", district: "Pune", areaKey: a.areaKey })).rejects.toThrow();
  });

  it("cannot activate until area, full deposit, KYC, signed agreement and term are in place", async () => {
    await expect(s.setStatus(ADMIN, A, "active")).rejects.toThrow(/deposit.*KYC.*agreement/);
    await expect(s.recordAgreement(ADMIN, A, "2026-11-10")).rejects.toThrow(/Publish the Terms/);
    await expect(s.publishTerms(ADMIN, "too short")).rejects.toThrow(/short/);
    const v1 = await s.publishTerms(ADMIN, "Terms version one. ".repeat(5));
    expect(v1).toBe(1);
    await expect(s.publishTerms(ADMIN, "Terms version one. ".repeat(5))).rejects.toThrow(/No change/);
    await s.recordAgreement(ADMIN, A, "2026-11-10");
    await s.setKycVerified(ADMIN, A, true);
    await expect(s.recordDeposit(ADMIN, A, { amountRupees: 20_000, method: "bank_transfer", receivedOn: "2026-11-12" })).rejects.toThrow(/UTR/);
    await s.recordDeposit(ADMIN, A, { amountRupees: 20_000, method: "bank_transfer", reference: "UTR123456789", receivedOn: "2026-11-12" });
    await expect(s.setStatus(ADMIN, A, "active")).rejects.toThrow(/full security deposit/);
    await s.recordDeposit(ADMIN, A, { amountRupees: 30_000, method: "upi", reference: "UPI98765432", receivedOn: "2026-11-13" });
    await s.setStatus(ADMIN, A, "active");
    const f = await s.getFranchise(A);
    expect(f?.status).toBe("active");
    expect(f?.termsVersion).toBe(1);
    // a newer Terms version keeps the franchise on the version it signed
    await s.publishTerms(ADMIN, "Terms version two. ".repeat(5));
    expect((await s.getFranchise(A))?.termsVersion).toBe(1);
  });

  it("guards on an active franchise: last area, deposit closing, KYC removal", async () => {
    const [area] = await s.areasOf(A);
    await expect(s.releaseArea(ADMIN, area.id)).rejects.toThrow(/at least one area/);
    const [dep] = await s.depositsOf(A);
    await expect(s.settleDeposit(ADMIN, dep.id, { refundRupees: 30_000, forfeitRupees: 0, refundReference: "UTR1111", note: "End of term" })).rejects.toThrow(/Suspend or terminate/);
    await expect(s.setKycVerified(ADMIN, A, false)).rejects.toThrow(/Suspend/);
  });

  it("suspend needs a reason; terminate frees the areas; deposits settle as refund + forfeit", async () => {
    await expect(s.setStatus(ADMIN, A, "suspended", "")).rejects.toThrow(/reason/);
    await s.setStatus(ADMIN, A, "suspended", "Target missed 3 months");
    await s.setStatus(ADMIN, A, "terminated", "Agreement ended by notice");
    expect(await s.areasOf(A)).toHaveLength(0);
    expect((await s.areaStatus("Maharashtra", "Pune")).holder).toBeNull();
    await s.addDistrict(ADMIN, B, "Maharashtra", "Pune"); // free for another franchise now
    await expect(s.setStatus(ADMIN, A, "active")).rejects.toThrow(/terminated/);

    const deps = await s.depositsOf(A);
    const d30 = deps.find((d) => d.amountPaise === 3_000_000)!, d20 = deps.find((d) => d.amountPaise === 2_000_000)!;
    await expect(s.settleDeposit(ADMIN, d30.id, { refundRupees: 10_000, forfeitRupees: 10_000, refundReference: "UTR2", note: "Partial" })).rejects.toThrow(/add up/);
    await expect(s.settleDeposit(ADMIN, d30.id, { refundRupees: 30_000, forfeitRupees: 0, note: "Refund" })).rejects.toThrow(/UTR of the refund/);
    expect(await s.settleDeposit(ADMIN, d30.id, { refundRupees: 25_000, forfeitRupees: 5_000, refundReference: "UTR777777", note: "Brand misuse penalty" })).toBe("partly_refunded");
    expect(await s.settleDeposit(ADMIN, d20.id, { refundRupees: 0, forfeitRupees: 20_000, note: "Left without notice" })).toBe("forfeited");
    await expect(s.settleDeposit(ADMIN, d20.id, { refundRupees: 0, forfeitRupees: 20_000, note: "Again" })).rejects.toThrow(/already closed/);
    const sum = depositSummary(5_000_000, await s.depositsOf(A));
    expect(sum).toMatchObject({ state: "closed", heldPaise: 0, refundedPaise: 2_500_000, forfeitedPaise: 2_500_000 });
  });

  it("lists with filters and audits every change", async () => {
    expect((await s.listFranchises({ status: "active" })).length).toBe(0);
    expect((await s.listFranchises({ q: "solapur" })).map((r) => r.f.code)).toEqual(["VSF-0002"]);
    expect((await s.listFranchises({ state: "Maharashtra" })).map((r) => r.f.code)).toEqual(["VSF-0002"]);
    const logs = await db.select().from(schema.auditLog).where(eq(schema.auditLog.targetId, A));
    const actions = logs.map((l) => l.action);
    for (const a of ["franchise.created", "franchise.area_added", "franchise.deposit_recorded", "franchise.status_active", "franchise.status_terminated", "franchise.deposit_settled"]) expect(actions).toContain(a);
  });
});
