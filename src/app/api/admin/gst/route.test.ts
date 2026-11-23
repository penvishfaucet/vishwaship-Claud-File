import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
let role: "owner" | "finance" | "readonly" | "support" | null = "finance";
let customer: { userId: string; orgId: string; impersonatorId: null } | null = null;
vi.mock("@/server/auth/session", async () => {
  const { can } = await import("@/server/auth/rbac");
  return {
    apiStaff: async (perm?: string) => (role && (!perm || can(role, perm as never)) ? { userId: `usr_${role}`, role } : null),
    apiCustomer: async () => customer,
  };
});
const admin = await import("./route");
const pack = await import("@/app/api/portal/billing/gst/route");
const doc = await import("@/app/api/portal/billing/gst/document/[id]/route");
const post = (body: unknown) => admin.POST(new Request("http://x/api/admin/gst", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const bill = { op: "bill_add", kind: "invoice", supplierName: "Delhivery Ltd", number: "D-1", docDate: "2026-11-20", taxable: "1000", igst: "180" };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const id of ["org_x", "org_y"]) await db.insert(schema.orgs).values({ id, name: id, businessName: id });
  await db.insert(schema.billingDocuments).values({ id: "doc_x", orgId: "org_x", kind: "invoice", number: "VS/INV/X", docDate: new Date("2026-11-10T12:00:00+05:30"), taxablePaise: 100, gstPaise: 18, totalPaise: 118, lines: [] });
});

describe("Finance & GST permissions", () => {
  it("only staff with cost + finance.adjust can record courier bills; read-only and support cannot see courier costs", async () => {
    role = "readonly";
    expect((await post(bill)).status).toBe(403);
    expect((await admin.GET(new Request("http://x/api/admin/gst?export=purchases&from=2026-11-01&to=2026-11-30"))).status).toBe(403);
    expect((await admin.GET(new Request("http://x/api/admin/gst?export=outward&from=2026-11-01&to=2026-11-30"))).status).toBe(200); // finance.read
    role = "support";
    expect((await admin.GET(new Request("http://x/api/admin/gst?export=outward&from=2026-11-01&to=2026-11-30"))).status).toBe(403);
    role = "finance";
    expect((await post(bill)).status).toBe(200);
    expect((await post(bill)).status).toBe(409); // same supplier + number again
    expect((await admin.GET(new Request("http://x/api/admin/gst?export=purchases&from=2026-11-01&to=2026-11-30"))).headers.get("content-type")).toContain("spreadsheetml");
  }, 30_000);
  it("customers download only their own pack and documents", async () => {
    customer = null;
    expect((await pack.GET(new Request("http://x/api/portal/billing/gst/?preset=this_month"))).status).toBe(401);
    customer = { userId: "u_y", orgId: "org_y", impersonatorId: null };
    expect((await doc.GET(new Request("http://x"), { params: Promise.resolve({ id: "doc_x" }) })).status).toBe(404); // another customer's invoice
    customer = { userId: "u_x", orgId: "org_x", impersonatorId: null };
    const r = await doc.GET(new Request("http://x"), { params: Promise.resolve({ id: "doc_x" }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    const z = await pack.GET(new Request("http://x/api/portal/billing/gst/?preset=custom&from=2026-11-01&to=2026-11-30"));
    expect(z.headers.get("content-type")).toBe("application/zip");
  }, 30_000);
});
