import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: vi.fn(), schema: {} }));
import { clientIp, ipKey } from "./rate-limit";

const req = (h: Record<string, string>) => new Request("https://vishwaship.in/x", { headers: h });

describe("clientIp", () => {
  it("uses x-real-ip set by the proxy, never the client's own X-Forwarded-For", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.99, 49.36.1.2", "x-real-ip": "49.36.1.2" }))).toBe("49.36.1.2");
  });
  it("falls back to the last X-Forwarded-For entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.99, 49.36.1.2" }))).toBe("49.36.1.2");
  });
  it("groups IPv6 by /64", () => {
    expect(ipKey("2401:4900:a5f9:e0d8:90b0:a666:4746:c72")).toBe("2401:4900:a5f9:e0d8::/64");
    expect(ipKey("2401:4900:a5f9:e0d8::1")).toBe("2401:4900:a5f9:e0d8::/64");
    expect(ipKey("2401:db8::1")).toBe("2401:db8:0:0::/64");
  });
});
