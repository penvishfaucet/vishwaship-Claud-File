import { describe, expect, it, vi } from "vitest";
import type { ProviderContext } from "./types";

vi.mock("server-only", () => ({}));
const { documentLinks, documentMeta } = await import("./delhivery-common");
const { parsePod } = await import("./shiprocket");
const { delhiveryB2cAdapter } = await import("./delhivery-b2c");
const { delhiveryB2bAdapter } = await import("./delhivery-b2b");
const { shipmozoAdapter } = await import("./shipmozo");
const { shiporaAdapter } = await import("./shiporax");

const ctx = (fetch: ProviderContext["fetch"], secrets: Record<string, string>): ProviderContext => ({ accountId: `t${Math.random()}`, mode: "live", config: {}, secrets, fetch });

describe("POD parsing", () => {
  it("collects https links from an undocumented JSON reply, POD-like keys first", () => {
    expect(documentLinks({ data: [{ thumb: "https://cdn.x/t.png", pod_url: "https://s3.x/pod.pdf" }], note: "http://insecure/x" }))
      .toEqual(["https://s3.x/pod.pdf", "https://cdn.x/t.png"]);
    expect(documentMeta({ data: { receiver_name: "Asha", delivered_at: "2026-11-20 11:12:00" } })).toEqual({ receiverName: "Asha", deliveredAt: "2026-11-20T05:42:00.000Z" });
  });
  it("Shiprocket: the POD image is in pod_status when available; OTP deliveries have none", () => {
    const sample = { tracking_data: { shipment_track: [{ awb_code: "141123221084922", pod: "Available", pod_status: "https://s3-ap-southeast-1.amazonaws.com/kr-shipmultichannel/courier/51/pod/141123221084922.png", delivered_to: "Mumbai", delivered_date: "2023-11-18 17:30:00" }] } };
    expect(parsePod(sample)).toEqual({ ready: true, deliveryMode: "pod", files: [{ kind: "pod", url: sample.tracking_data.shipment_track[0].pod_status }], receiverName: "Mumbai", deliveredAt: "2023-11-18T12:00:00.000Z" });
    expect(parsePod({ tracking_data: { shipment_track: [{ pod: "Not Available", pod_status: "OTP Based Delivery" }] } })).toEqual({ ready: false, files: [], deliveryMode: "otp" });
  });
});

describe("POD calls", () => {
  it("Delhivery B2C asks the documented document API for EPOD and SIGNATURE_URL", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("doc_type=EPOD")) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "content-type": "application/pdf" } });
      return new Response(JSON.stringify({ data: { url: "https://s3.delhivery/sig.png" } }), { headers: { "content-type": "application/json" } });
    });
    const r = await delhiveryB2cAdapter.pod!(ctx(fetch as never, { apiToken: "tok" }), { awb: "123", providerOrderRef: "x" });
    expect(calls).toEqual([
      "https://track.delhivery.com/api/rest/fetch/pkg/document/?doc_type=EPOD&waybill=123",
      "https://track.delhivery.com/api/rest/fetch/pkg/document/?doc_type=SIGNATURE_URL&waybill=123",
    ]);
    expect(r.ok && r.value.ready).toBe(true);
    expect(r.ok && r.value.files.map((f) => [f.kind, f.url ?? "bytes"])).toEqual([["pod", "bytes"], ["signature", "https://s3.delhivery/sig.png"]]);
  });
  it("Delhivery B2C: nothing published yet → not ready (retried later)", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 404 }));
    const r = await delhiveryB2cAdapter.pod!(ctx(fetch as never, { apiToken: "tok" }), { awb: "123", providerOrderRef: "x" });
    expect(r).toEqual({ ok: true, value: { ready: false, files: [] } });
  });
  it("Delhivery B2B asks /document/download for the LM_POD of the LR", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/ums/login")) return new Response(JSON.stringify({ jwt: "j" }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ data: [{ link: "https://s3.delhivery/lm_pod.pdf" }] }), { headers: { "content-type": "application/json" } });
    });
    const r = await delhiveryB2bAdapter.pod!(ctx(fetch as never, { username: "u", password: "p" }), { awb: "AWB1", providerOrderRef: "job", lrNumber: "220079606" });
    expect(calls[1]).toBe("https://ltl-clients-api.delhivery.com/document/download?lrn=220079606&doc_type=LM_POD&version=latest");
    expect(r.ok && r.value.files).toEqual([{ kind: "pod", url: "https://s3.delhivery/lm_pod.pdf" }]);
    expect(r.ok && r.value.deliveryMode).toBe("pod");
  });
  it("Delhivery B2B falls back to ALTERNATE_LM_POD; nothing uploaded yet means not ready", async () => {
    const calls: string[] = [];
    const login = () => new Response(JSON.stringify({ jwt: "j" }), { headers: { "content-type": "application/json" } });
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/ums/login")) return login();
      if (url.includes("doc_type=LM_POD")) return new Response("{}", { status: 404 });
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "content-type": "application/pdf" } });
    });
    const r = await delhiveryB2bAdapter.pod!(ctx(fetch as never, { username: "u", password: "p" }), { awb: "LR9", providerOrderRef: "job" });
    expect(calls.slice(1).map((u) => new URL(u).searchParams.get("doc_type"))).toEqual(["LM_POD", "ALTERNATE_LM_POD"]);
    expect(r.ok && r.value.ready).toBe(true);
    const none = vi.fn(async (url: string) => (url.endsWith("/ums/login") ? login() : new Response("{}", { status: 404 })));
    const r2 = await delhiveryB2bAdapter.pod!(ctx(none as never, { username: "u", password: "p" }), { awb: "LR9", providerOrderRef: "job" });
    expect(r2).toEqual({ ok: true, value: { ready: false, files: [] } });
  });
  it("Shipmozo and Shipora X have no documented POD API", () => {
    expect(shipmozoAdapter.pod).toBeUndefined();
    expect(shiporaAdapter.pod).toBeUndefined();
    expect(shipmozoAdapter.implemented).not.toContain("pod");
  });
});
