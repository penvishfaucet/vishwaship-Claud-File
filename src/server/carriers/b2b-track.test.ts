import { describe, expect, it } from "vitest";
import { mapB2bStatus, parseB2bTrack } from "@/server/providers/delhivery-b2b";

describe("Delhivery B2B tracking parser", () => {
  it("reads the latest status, place and expected delivery date", () => {
    const t = parseB2bTrack({ data: { status: "LEFT_ORIGIN", status_time: "2026-11-21 09:15:00", location: "Ambala_Hub", edd: "2026-11-25" } }, "LR1")!;
    expect(t.status).toBe("in_transit");
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({ location: "Ambala_Hub", occurredAt: "2026-11-21T03:45:00.000Z" });
    expect(t.etaDate?.slice(0, 10)).toBe("2026-11-25");
  });
  it("keeps every scan in a scan list, wherever it sits in the body", () => {
    const t = parseB2bTrack({ data: [{ status: "IN_TRANSIT", promised_delivery_date: "2026-11-26T00:00:00+05:30", wbns: [{ wbn: "1", scans: [
      { scan_status: "PICKED_UP", scan_timestamp: "2026-11-20T18:00:00+05:30", scan_location: "Haridwar" },
      { scan_status: "IN_TRANSIT", scan_timestamp: "2026-11-21T06:00:00+05:30", scan_location: { name: "Noida_Gateway" }, remarks: "Bag received" },
      { scan_status: "IN_TRANSIT", scan_timestamp: "2026-11-22T04:30:00+05:30", scan_location: "Varanasi_Hub" },
    ] }] }] }, "LR2")!;
    expect(t.events.map((e) => e.location)).toEqual(["Haridwar", "Noida_Gateway", "Varanasi_Hub"]);
    expect(t.events[1].remark).toBe("Bag received");
    expect(t.status).toBe("in_transit");
    expect(t.etaDate).toBe("2026-11-25T18:30:00.000Z");
  });
  it("returns nothing when Delhivery has no status yet", () => {
    expect(parseB2bTrack({ data: {} }, "LR3")).toBeNull();
  });
  it("does not call a not-yet-picked shipment in transit", () => {
    expect(mapB2bStatus("Scheduled")).toBe("pickup_pending");
    expect(mapB2bStatus("Out for delivery")).toBe("out_for_delivery");
    expect(mapB2bStatus("REACH_DESTINATION")).toBe("at_delivery_center");
  });
});
