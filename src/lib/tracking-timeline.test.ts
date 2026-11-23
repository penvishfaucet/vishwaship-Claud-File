import { describe, expect, it } from "vitest";
import { buildMilestones, buildScans, fmtScanTime, maskPhones, scanText } from "./tracking-timeline";

const ist = (s: string) => new Date(`${s}+05:30`).toISOString();

describe("scan time and text", () => {
  it("formats in India time like the reference (15 Nov, 04:26am)", () => {
    expect(fmtScanTime(ist("2026-11-15T04:26:00"))).toBe("15 Nov, 04:26am");
    expect(fmtScanTime(ist("2026-11-13T16:40:00"))).toBe("13 Nov, 04:40pm");
    expect(fmtScanTime(ist("2026-11-14T00:41:00"))).toBe("14 Nov, 12:41am");
    expect(fmtScanTime(ist("2026-11-20T12:05:00"))).toBe("20 Nov, 12:05pm");
  });
  it("uses the courier's instruction text and adds the location", () => {
    // Delhivery B2C stores "Scan — Instructions" + remark = Instructions + ScannedLocation
    expect(scanText({ status: "in_transit", rawStatus: "In Transit — Shipment Recieved at Origin Center", remark: "Shipment Recieved at Origin Center", location: "Haridwar_Bahadrabad1_L (Uttarakhand)", occurredAt: new Date() }))
      .toBe("Shipment Recieved at Origin Center at Haridwar_Bahadrabad1_L (Uttarakhand)");
    expect(scanText({ status: "delivered", rawStatus: "Delivered", location: null, occurredAt: new Date() })).toBe("Delivered");
    expect(scanText({ status: "out_for_delivery", rawStatus: "", location: "Berhampore_Mankara_I (West Bengal)", occurredAt: new Date() })).toBe("Out for delivery at Berhampore_Mankara_I (West Bengal)");
    // location already in the text → not repeated
    expect(scanText({ status: "in_transit", rawStatus: "Trip Arrived at Gurgaon_Tauru_GW", location: "Gurgaon_Tauru_GW", occurredAt: new Date() })).toBe("Trip Arrived at Gurgaon_Tauru_GW");
  });
  it("hides internal partner names and masks phone numbers for public pages", () => {
    const lines = buildScans([{ status: "out_for_delivery", rawStatus: "Out for delivery via Shipmozo, executive 9876543210", location: "Pune", occurredAt: new Date() }],
      (t) => maskPhones(t.replace(/ship\s*mozo/gi, "courier partner")));
    expect(lines[0].text).not.toMatch(/shipmozo|9876543210/i);
    expect(lines[0].text).toContain("courier partner");
  });
  it("lists every scan oldest first", () => {
    const lines = buildScans([
      { status: "delivered", rawStatus: "Delivered", occurredAt: ist("2026-11-20T11:12:00") },
      { status: "booked", rawStatus: "Manifest uploaded", occurredAt: ist("2026-11-13T16:40:00") },
      { status: "in_transit", rawStatus: "Bag Added To Trip", occurredAt: ist("2026-11-15T06:59:00") },
    ]);
    expect(lines.map((l) => l.text)).toEqual(["Manifest uploaded", "Bag Added To Trip", "Delivered"]);
    expect(lines[0].when).toBe("13 Nov, 04:40pm");
  });
});

describe("milestones", () => {
  it("delivered: Manifested → In-transit → Out for delivery → Delivered, all done with times", () => {
    const m = buildMilestones([
      { status: "booked", occurredAt: ist("2026-11-13T16:40:00") },
      { status: "picked_up", occurredAt: ist("2026-11-14T17:03:00") },
      { status: "out_for_delivery", occurredAt: ist("2026-11-20T10:14:00") },
      { status: "delivered", occurredAt: ist("2026-11-20T11:12:00") },
    ], "delivered");
    expect(m.map((x) => x.label)).toEqual(["Manifested", "In-transit", "Out for delivery", "Delivered"]);
    expect(m.every((x) => x.done)).toBe(true);
    expect(fmtScanTime(m[3].at!)).toBe("20 Nov, 11:12am");
  });
  it("in transit: later steps are pending; a missing manifest scan falls back to the booking time", () => {
    const m = buildMilestones([{ status: "in_transit", occurredAt: ist("2026-11-15T04:26:00") }], "in_transit", ist("2026-11-13T16:40:00"));
    expect(m.map((x) => [x.key, x.done])).toEqual([["manifested", true], ["in_transit", true], ["out_for_delivery", false], ["delivered", false]]);
    expect(m[0].at).toBe(ist("2026-11-13T16:40:00"));
  });
  it("NDR then delivered keeps the failed attempt in the steps", () => {
    const m = buildMilestones([
      { status: "booked", occurredAt: ist("2026-11-13T10:00:00") },
      { status: "out_for_delivery", occurredAt: ist("2026-11-18T09:00:00") },
      { status: "ndr", occurredAt: ist("2026-11-18T18:00:00") },
      { status: "out_for_delivery", occurredAt: ist("2026-11-19T09:00:00") },
      { status: "delivered", occurredAt: ist("2026-11-19T12:00:00") },
    ], "delivered");
    expect(m.map((x) => x.key)).toEqual(["manifested", "in_transit", "ndr", "out_for_delivery", "delivered"]);
    expect(m.find((x) => x.key === "ndr")!.tone).toBe("warn");
  });
  it("RTO replaces Delivered with the RTO steps", () => {
    const m = buildMilestones([
      { status: "booked", occurredAt: ist("2026-11-13T10:00:00") },
      { status: "in_transit", occurredAt: ist("2026-11-14T10:00:00") },
      { status: "ndr", occurredAt: ist("2026-11-16T10:00:00") },
      { status: "rto_initiated", occurredAt: ist("2026-11-17T10:00:00") },
    ], "rto_initiated");
    expect(m.map((x) => x.key)).toEqual(["manifested", "in_transit", "ndr", "rto_initiated", "rto_in_transit", "rto_delivered"]);
    expect(m.map((x) => x.done)).toEqual([true, true, true, true, false, false]);
  });
  it("cancelled before pickup", () => {
    const m = buildMilestones([{ status: "booked", occurredAt: ist("2026-11-13T10:00:00") }, { status: "cancelled", occurredAt: ist("2026-11-13T12:00:00") }], "cancelled");
    expect(m.map((x) => [x.key, x.tone])).toEqual([["manifested", "ok"], ["cancelled", "bad"]]);
  });
});

describe("OTP or POD delivery", async () => {
  const { deliveryModeFromText, deliveryModeFromScans } = await import("./tracking-timeline");
  it("reads the courier's words", () => {
    expect(deliveryModeFromText("OTP Based Delivery")).toBe("otp");
    expect(deliveryModeFromText("Delivered — OTP verified delivery")).toBe("otp");
    expect(deliveryModeFromText("POD uploaded")).toBe("pod");
    expect(deliveryModeFromText("Delivered to consignee", "signature captured")).toBe("pod");
    expect(deliveryModeFromText("Delivered to consignee")).toBeNull();
    expect(deliveryModeFromText("Shipment dispatched from Podanur hub")).toBeNull(); // "pod" only as a word
  });
  it("uses only scans from the delivery onwards; OTP wins over a later POD upload", () => {
    const ist = (s: string) => new Date(`${s}+05:30`).toISOString();
    expect(deliveryModeFromScans([{ status: "in_transit", rawStatus: "POD pending at hub", occurredAt: ist("2026-11-19T10:00:00") }, { status: "delivered", rawStatus: "Delivered", occurredAt: ist("2026-11-20T11:00:00") }])).toBeNull();
    expect(deliveryModeFromScans([{ status: "delivered", rawStatus: "Delivered", remark: "OTP verified", occurredAt: ist("2026-11-20T11:00:00") }, { status: "delivered", rawStatus: "POD uploaded", occurredAt: ist("2026-11-20T21:00:00") }])).toBe("otp");
    expect(deliveryModeFromScans([{ status: "delivered", rawStatus: "Delivered", occurredAt: ist("2026-11-20T11:00:00") }, { status: "delivered", rawStatus: "POD uploaded", occurredAt: ist("2026-11-20T21:00:00") }])).toBe("pod");
  });
});
