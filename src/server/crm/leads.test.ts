import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const crm = await import("./leads");
const { normMobile, waLink, fillTemplate, fromIstInput, istInput } = await import("@/lib/crm");
const { can } = await import("@/server/auth/rbac");

beforeAll(async () => { await migrate(db, { migrationsFolder: "./migrations" }); });

const metaLead = (id: string, phone: string) => ({
  id, created_time: "2026-11-28T10:15:00+0000", campaign_name: "VS | Cold | B2B Cargo Leads", ad_name: "W1_REEL_B2B-8kg_VS", platform: "ig",
  field_data: [
    { name: "full_name", values: ["Ramesh Kumar"] }, { name: "phone_number", values: [phone] }, { name: "city", values: ["Jaipur"] },
    { name: "company_name", values: ["RK Traders"] }, { name: "monthly_shipping_volume", values: ["2_t–10_t"] }, { name: "what_do_you_ship?", values: ["Tiles"] },
  ],
});

describe("CRM Leads", () => {
  it("helpers: mobile, WhatsApp link, IST times", () => {
    expect(normMobile("+91 98765-43210")).toBe("9876543210");
    expect(normMobile("09876543210")).toBe("9876543210");
    expect(waLink("+91 98765 43210", "Hi Ram")).toBe("https://wa.me/919876543210?text=Hi%20Ram");
    expect(fillTemplate("Namaste {name} ji", "Ramesh Kumar")).toBe("Namaste Ramesh ji");
    const d = fromIstInput("2026-11-28T19:30")!;
    expect(d.toISOString()).toBe("2026-11-28T14:00:00.000Z");
    expect(istInput(d)).toBe("2026-11-28T19:30");
  });

  it("a Meta form lead becomes one CRM lead with every answer; the same lead ID or mobile never duplicates", async () => {
    const a = await crm.ingestMetaLead(metaLead("111222333444", "+919876543210"));
    expect(a.created).toBe(true);
    const l = (await crm.getLead(a.id))!;
    expect(l).toMatchObject({ name: "Ramesh Kumar", mobile: "9876543210", city: "Jaipur", company: "RK Traders", volume: "2 t–10 t", interest: "Tiles", source: "meta_form", status: "new", campaign: "VS | Cold | B2B Cargo Leads" });
    expect(l.lastNote).toContain("Form filled");
    expect(await crm.ingestMetaLead(metaLead("111222333444", "+919876543210"))).toEqual({ id: a.id, created: false });
    const again = await crm.ingestMetaLead(metaLead("555666777888", "9876543210"));
    expect(again).toEqual({ id: a.id, created: false });
    expect((await db.select().from(schema.crmLeads)).length).toBe(1);
    const acts = await db.select().from(schema.crmActivities).where(eq(schema.crmActivities.leadId, a.id));
    expect(acts.filter((x) => x.kind === "form").length).toBe(2);
  });

  it("a lead whose mobile signs up is marked Signed up", async () => {
    await db.insert(schema.orgs).values({ id: "org_x", name: "RK", businessName: "RK Traders" });
    await db.insert(schema.users).values({ id: "usr_c", kind: "customer", orgId: "org_x", name: "Ramesh", mobile: "9876543210" });
    expect(await crm.sweepSignedUp()).toBe(1);
    const [l] = await db.select().from(schema.crmLeads);
    expect(l).toMatchObject({ status: "signed_up", orgId: "org_x" });
  });

  it("sales staff see only their own leads; the owner sees every lead", async () => {
    const r = await crm.createLead({ name: "Sunita", mobile: "9123456780", source: "whatsapp", assignedTo: null }, "usr_owner");
    const l = (await crm.getLead(r.id))!;
    expect(crm.canSee({ userId: "usr_s", role: "sales" }, l)).toBe(false);
    expect(crm.canSee({ userId: "usr_o", role: "owner" }, l)).toBe(true);
    expect(crm.canSee({ userId: "usr_s", role: "sales" }, { assignedTo: "usr_s" })).toBe(true);
    expect(can("sales", "crm.read")).toBe(true);
    expect(can("sales", "crm.manage")).toBe(false);
    expect(can("sales", "shipments.read")).toBe(false);
    expect((await crm.createLead({ name: "Sunita again", mobile: "+91 91234 56780" }, "usr_owner")).existing).toBe(true);
  });
});
