import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => ({}), schema: {} }));
vi.mock("@/server/integrations/services", () => ({ activeService: async () => null }));
vi.mock("@/server/quotes/service", () => ({ getSetting: async () => null }));
const { adReferral } = await import("./whatsapp");

describe("Click-to-WhatsApp ad referral", () => {
  it("names the ad a WhatsApp chat came from", () => {
    const r = adReferral({ from: "919876543210", id: "wamid.1", type: "text", referral: { source_type: "ad", source_id: "120200000000001", headline: "Fake COD orders band karo", ctwa_clid: "abc" } });
    expect(r).toEqual({ campaign: "Meta ad (WhatsApp): Fake COD orders band karo", adName: "ad 120200000000001", note: "📣 Came from meta ad → WhatsApp — “Fake COD orders band karo”" });
  });
  it("is null for a normal chat", () => {
    expect(adReferral({ from: "919876543210", id: "wamid.2", type: "text" })).toBeNull();
  });
});
