import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { PDFDocument, rgb } from "pdf-lib";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

// --- a live courier stand-in: label() answers from `carrierReply`; book() must never be called by a download
let carrierReply: Array<() => unknown> = [];
const carrierCalls: string[] = [];
const fakeAdapter = {
  key: "fake", label: vi.fn(async (_ctx: unknown, ref: { awb: string }, fmt: string) => { carrierCalls.push(`${ref.awb}:${fmt}`); const next = carrierReply.shift(); return next ? next() : { ok: false, error: { message: "no label", retryable: false } }; }),
  book: vi.fn(() => { throw new Error("a label download must never book"); }),
};
vi.mock("@/server/providers/registry", async (orig) => ({ ...(await orig<object>()), adapterFor: () => fakeAdapter, providerContext: async () => ({ accountId: "pa_live", mode: "live", config: {}, secrets: {}, fetch: async () => new Response("") }) }));
// --- label links: a redirect, an expired link, and a good file
const files = new Map<string, () => Response>();
vi.mock("@/server/security/safe-fetch", () => ({ safeFetch: async (url: string) => (files.get(url) ?? (() => new Response("missing", { status: 404 })))() }));

const { renderLabels } = await import("./render");
const { delhiveryB2bAdapter } = await import("@/server/providers/delhivery-b2b");
const PT = 72 / 25.4;
const ORG = "org_lbl", OTHER = "org_lbl2";
const LONG_ADDR = "Plot 1234, Shri Ganesh Industrial Estate Phase Two, Behind Old Railway Goods Shed, Near Hanuman Mandir Chauraha, Opposite Bharat Petroleum Pump, Gate Number Seven";

async function pdfPages(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    const items = (await p.getTextContent()).items.filter((x) => "str" in x) as Array<{ str: string; transform: number[] }>;
    out.push({ w: vp.width, h: vp.height, rotate: p.rotate, view: p.view, text: items.map((x) => x.str).join(" "), items, ops: await p.getOperatorList(), OPS: pdfjs.OPS });
  }
  return out;
}

// ---- independent Code 128 reader: rebuilds the bar/space widths from the drawn rectangles and decodes them
const C128 = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232"];
function decodeBarcodes(page: Awaited<ReturnType<typeof pdfPages>>[number]): string[] {
  const { fnArray, argsArray } = page.ops; const O = page.OPS;
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  let stack: Array<[number, number]> = [], t: [number, number] = [0, 0];
  for (let i = 0; i < fnArray.length; i++) {
    const f = fnArray[i], a = argsArray[i] as unknown[];
    if (f === O.save) stack.push([...t]);
    else if (f === O.restore) t = stack.pop() ?? [0, 0];
    else if (f === O.transform) { const m = a as number[]; t = [t[0] + m[4], t[1] + m[5]]; }
    else if (f === O.constructPath) { const mm = Array.from(a[2] as ArrayLike<number>); if (mm.length === 4) rects.push({ x: t[0] + mm[0], y: t[1] + mm[1], w: mm[2] - mm[0], h: mm[3] - mm[1] }); }
  }
  const bands = new Map<string, typeof rects>();
  for (const r of rects) if (r.h > 10 && r.w < 6) { const k = `${r.y.toFixed(2)}:${r.h.toFixed(2)}`; bands.set(k, [...(bands.get(k) ?? []), r]); }
  const out: string[] = [];
  for (const bars of bands.values()) {
    if (bars.length < 10) continue;
    bars.sort((a, b) => a.x - b.x);
    const mod = Math.min(...bars.map((b) => b.w));
    const el: number[] = [];
    bars.forEach((b, i) => { el.push(Math.round(b.w / mod)); if (i < bars.length - 1) el.push(Math.round((bars[i + 1].x - b.x - b.w) / mod)); });
    const codes: number[] = [];
    for (let i = 0; i + 6 <= el.length - 7; i += 6) codes.push(C128.indexOf(el.slice(i, i + 6).join("")));
    if (codes[0] !== 104 || codes.some((c) => c < 0)) continue;
    const data = codes.slice(1, -1), check = codes.at(-1)!;
    if ((104 + data.reduce((s, c, i) => s + c * (i + 1), 0)) % 103 !== check) continue;
    out.push(data.map((c) => String.fromCharCode(c + 32)).join(""));
  }
  return out;
}

let n = 0;
async function ship(o: { org?: string; provider?: string; mode?: "B2B" | "B2C"; awb?: string | null; pieces?: string[]; boxes?: number; pay?: "prepaid" | "cod"; address?: string; status?: string }) {
  const id = `${++n}`;
  await db.insert(schema.orders).values({ id: `o${id}`, orgId: o.org ?? ORG, orderNumber: `VS-L${id}`, mode: o.mode ?? "B2B", paymentType: o.pay ?? "prepaid", codAmountPaise: o.pay === "cod" ? 123456 : 0,
    declaredValuePaise: 75_000_00, warehouseId: "wh_l", status: "booked", invoiceNumber: `INV-${id}`, meta: { grandTotalPaise: 75_000_00 },
    products: [{ name: "Steel Almirah", qty: 2, unitPrice: 25_000_00 }, { name: "Office Chair", qty: 1, unitPrice: 25_000_00 }],
    pickupSnapshot: { label: "Main Godown", line1: "Plot 7, Sidcul", city: "Haridwar", state: "Uttarakhand", pincode: "249403", mobile: "9876500000" },
    consignee: { name: "Shree Balaji Traders Pvt Ltd", mobile: "9123456780", line1: o.address ?? "45 Ring Road", line2: "Lajpat Nagar", city: "New Delhi", state: "Delhi", pincode: "110024" } });
  await db.insert(schema.packages).values({ id: `p${id}`, orderId: `o${id}`, count: o.boxes ?? 1, lengthMm: 500, breadthMm: 400, heightMm: 400, actualWeightGrams: 20_000 });
  const awb = o.awb === undefined ? `2200${String(n).padStart(8, "0")}` : o.awb;
  await db.insert(schema.shipments).values({ id: `s${id}`, orgId: o.org ?? ORG, orderId: `o${id}`, providerAccountId: "pa_live", provider: o.provider ?? "delhivery_b2b", carrierCode: "delhivery", carrierName: "Delhivery",
    serviceName: "B2B Surface", awb, lrNumber: (o.mode ?? "B2B") === "B2B" ? awb : null, pieceIds: o.pieces ?? null, bookingStatus: "confirmed", pickupStatus: "scheduled", status: o.status ?? "booked",
    quoteId: "q", sellPaise: 300_000, costPaise: 250_000, chargeableWeightGrams: 20_000 });
  return `s${id}`;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: ORG, name: "Penvish", businessName: "Penvish Bath Fittings", gstin: "05AAAPZ1234F1Z5" }, { id: OTHER, name: "X", businessName: "Other Co" }]);
  await db.insert(schema.orgSettings).values({ orgId: ORG, key: "invoice_settings", value: { businessName: "Penvish Bath Fittings LLP", gstin: "05ABCPZ9876K1Z2" } });
  await db.insert(schema.providerAccounts).values({ id: "pa_live", adapter: "delhivery_b2b", category: "shipping", label: "Delhivery B2B", mode: "live", status: "enabled" });
  await db.insert(schema.warehouses).values({ id: "wh_l", orgId: ORG, label: "Main Godown", contactName: "R", mobile: "9876500000", line1: "Plot 7, Sidcul", pincode: "249403", city: "Haridwar", state: "Uttarakhand", code: "W1" });
});

describe("Vishwaship B2B label", { timeout: 20_000 }, () => {
  it("one carton: delivery + pickup mapping, shipper's own GSTIN, invoice value, products, LRN and carton barcodes that decode", async () => {
    const sid = await ship({ pieces: ["22009988776601"] });
    const r = await renderLabels(ORG, [sid], "thermal_4x6");
    expect(r.skipped).toEqual([]);
    const [p, docPage] = await pdfPages(r.pdf!);
    // B2B: the shipment document comes first (stapled with the invoice), then one label per carton
    expect(docPage.text).toContain("SHIPMENT DOCUMENT");
    expect(docPage.text).toMatch(/Staple this\s+document\s+with\s+the\s+invoice/);
    expect(docPage.text).toContain("MPS: Documents");
    expect(p.text).toContain("Paste on carton 1 of 1");
    expect(r.notices.join(" ")).toContain("staple the shipment document with the invoice");
    expect([p.w, p.h].map((x) => +x.toFixed(2))).toEqual([288, 432]);
    for (const t of ["Shipping address :", "Shree Balaji Traders Pvt Ltd", "45 Ring Road, Lajpat Nagar", "PIN 110024", "Return address :", "Penvish Bath Fittings LLP", "05ABCPZ9876K1Z2", "Plot 7, Sidcul", "249403", "INV-", "Rs. 75,000.00", "Steel Almirah x2", "Office Chair", "VS-L", "LRN: 2200", "Box : 1/1", "B2B", "PREPAID"]) expect(p.text).toContain(t);
    // table order, as on the courier's label: ID at the top, the barcode, then the shipping and return addresses
    const yOf = (s: string) => p.items.find((i) => i.str.includes(s))!.transform[5];
    expect(yOf("LRN: 2200")).toBeGreaterThan(yOf("Box : 1/1"));
    expect(yOf("Box : 1/1")).toBeGreaterThan(yOf("Shipping address"));
    expect(yOf("Shipping address")).toBeGreaterThan(yOf("Return address"));
    const [row] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, sid));
    // as on the courier label: one barcode per box (its carton waybill); the LRN is printed at the top
    expect(decodeBarcodes(p)).toEqual(["22009988776601"]);
    expect(p.text).toContain(`LRN: ${row.awb}`);
    // terms at the foot, below every mandatory detail
    expect(p.text).toContain("vishwaship.in/terms");
    expect(yOf("vishwaship.in/terms")).toBeLessThan(yOf("Return address"));
  });

  it("multi-carton: one label per carton, each with its own carton barcode", async () => {
    const pieces = ["22001111000101", "22001111000102", "22001111000103"];
    const sid = await ship({ boxes: 3, pieces });
    const r = await renderLabels(ORG, [sid], "thermal_4x4");
    const all = await pdfPages(r.pdf!);
    const doc = all.at(-1)!, pages = all.slice(0, -1);
    expect(doc.text).toContain("SHIPMENT DOCUMENT");
    expect(doc.text).toContain("MPS: Documents");
    expect(pages).toHaveLength(3);
    pages.forEach((p, i) => { expect(p.text).toContain(`Box : ${i + 1}/3`); expect(p.text).toContain(i === 0 ? "MASTER" : "CHILD"); expect(p.text).toContain(`Master: ${pieces[0]}`); expect(decodeBarcodes(p)).toContain(pieces[i]); });
  });

  it("multi-carton B2B without the carrier's carton barcodes is not guessed: skipped with Retry", async () => {
    const sid = await ship({ boxes: 2 });
    const r = await renderLabels(ORG, [sid], "thermal_4x6");
    expect(r.pdf).toBeNull();
    expect(r.skipped[0]).toMatchObject({ shipmentId: sid, retryable: true, reason: expect.stringMatching(/carton barcodes/) });
  });

  it("COD: the amount is not on the Vishwaship label nor in its PDF data", async () => {
    const sid = await ship({ pay: "cod", mode: "B2C", provider: "delhivery_b2c" });
    const r = await renderLabels(ORG, [sid], "thermal_4x6");
    const [p] = await pdfPages(r.pdf!);
    expect(p.text).toContain("COD");
    expect(p.text).not.toMatch(/1,234\.56|1234\.56|Rs\.? ?1,?234/); // (the receiver's phone 9123456780 legitimately contains "123456")
    const raw = Buffer.from(r.pdf!).toString("latin1");
    expect(raw).not.toMatch(/1,234\.56|1234\.56/);
    const d = await PDFDocument.load(r.pdf!);
    expect(`${d.getTitle()} ${d.getSubject() ?? ""} ${d.getKeywords() ?? ""}`).not.toMatch(/1234|COD/);
  });

  it("long address and names wrap fully on 4×6 and 3×4 (address, PIN and barcode never clipped)", async () => {
    const sid = await ship({ address: LONG_ADDR, pieces: ["22007777000001"] });
    for (const f of ["thermal_4x6", "thermal_3x4"] as const) {
      const r = await renderLabels(ORG, [sid], f);
      if (!r.pdf) { expect(r.skipped[0].reason).toMatch(/Use/); continue; }
      const [p] = await pdfPages(r.pdf);
      const words = LONG_ADDR.replace(/,/g, "").split(" ");
      const flat = p.text.replace(/,/g, "").replace(/\s+/g, " ");
      for (const w of words) expect(flat).toContain(w);
      expect(p.text).toContain("PIN 110024");
      for (const it of p.items) { expect(it.transform[4]).toBeGreaterThanOrEqual(0); expect(it.transform[5]).toBeGreaterThanOrEqual(0); expect(it.transform[5]).toBeLessThanOrEqual(p.view[3]); }
      expect(decodeBarcodes(p).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("print formats", { timeout: 20_000 }, () => {
  it("thermal rolls: exact PDF page sizes; narrow rolls rotate so the barcode runs along the long side", async () => {
    const sid = await ship({ pieces: ["22005555000001"] });
    const want: Record<string, [number, number]> = { thermal_4x6: [101.6, 152.4], thermal_3x4: [76.2, 101.6], thermal_4x4: [101.6, 101.6], thermal_2x4: [50.8, 101.6], thermal_38x100: [38, 100] };
    for (const [f, mm] of Object.entries(want)) {
      const r = await renderLabels(ORG, [sid], f as never);
      if (!r.pdf) { expect(f).toMatch(/2x4|38x100/); expect(r.skipped[0].reason).toMatch(/Use Thermal 4 × 6 inches/); continue; }
      const [p] = await pdfPages(r.pdf);
      expect(p.w).toBeCloseTo(mm[0] * PT, 1); // printed size after rotation
      expect(p.h).toBeCloseTo(mm[1] * PT, 1);
      if (mm[0] < 60) expect(p.rotate).toBe(90);
    }
  });

  it("38 × 100 mm single-carton B2C label fits and its AWB decodes", async () => {
    const sid = await ship({ mode: "B2C", provider: "delhivery_b2c" });
    const r = await renderLabels(ORG, [sid], "thermal_38x100");
    if (!r.pdf) throw new Error(r.skipped.map((s) => s.reason).join());
    const [p] = await pdfPages(r.pdf);
    expect(decodeBarcodes(p)).toHaveLength(1);
  });

  it("A4 4 per page (2 × 2): labels in order, unused slots blank; A4 2 per page: top then bottom", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await ship({ mode: "B2C", provider: "delhivery_b2c" }));
    const r = await renderLabels(ORG, ids, "a4_4up");
    const pages = await pdfPages(r.pdf!);
    expect(pages).toHaveLength(2);
    expect(pages[0].w).toBeCloseTo(595.28, 1); expect(pages[0].h).toBeCloseTo(841.89, 1);
    const slot = (p: typeof pages[number]) => p.items.filter((i) => i.str === "Shipping address :").map((i) => [i.transform[4] < p.w / 2 ? "L" : "R", i.transform[5] > p.h / 2 ? "T" : "B"].join(""));
    expect(slot(pages[0])).toEqual(["LT", "RT", "LB", "RB"]);
    expect(slot(pages[1])).toEqual(["LT"]);
    // printer-safe margin: nothing within 5 mm of the sheet edge
    for (const p of pages) for (const it of p.items) { expect(it.transform[4]).toBeGreaterThan(5 * PT); expect(it.transform[5]).toBeGreaterThan(5 * PT); }
    const order = pages[0].items.filter((i) => /^OID: VS-L/.test(i.str)).map((i) => i.str);
    expect(order.join(" ")).toMatch(new RegExp(ids.slice(0, 4).map((id) => `VS-L${id.slice(1)}`).join(".*")));

    const r2 = await renderLabels(ORG, ids.slice(0, 3), "a4_2up");
    const p2 = await pdfPages(r2.pdf!);
    expect(p2).toHaveLength(2);
    expect(p2[0].items.filter((i) => i.str === "Shipping address :").map((i) => (i.transform[5] > p2[0].h / 2 ? "T" : "B"))).toEqual(["T", "B"]);
  });
});

describe("thermal 38 × 200 mm", { timeout: 20_000 }, () => {
  it("page is 38 × 200 mm, rotated so the barcode runs along the roll, and the AWB decodes", async () => {
    const sid = await ship({ mode: "B2C", provider: "delhivery_b2c" });
    const r = await renderLabels(ORG, [sid], "thermal_38x200");
    expect(r.skipped).toEqual([]);
    const [p] = await pdfPages(r.pdf!);
    expect([p.view[2], p.view[3]].map((x) => Math.round(x / PT))).toEqual([200, 38]);
    expect(p.rotate).toBe(90);
    expect(decodeBarcodes(p).length).toBeGreaterThanOrEqual(1);
  });
});

describe("A4 sheets for one shipment", { timeout: 30_000 }, () => {
  const delivers = (p: Awaited<ReturnType<typeof pdfPages>>[number]) => p.items.filter((i) => i.str === "Shipping address :");

  it("A4 · 1 label per page: one label on each sheet", async () => {
    const ids = [await ship({ mode: "B2C", provider: "delhivery_b2c" }), await ship({ mode: "B2C", provider: "delhivery_b2c" })];
    const r = await renderLabels(ORG, ids, "a4_1up");
    expect(r.skipped).toEqual([]);
    const pages = await pdfPages(r.pdf!);
    expect(pages).toHaveLength(2);
    for (const p of pages) { expect(p.w).toBeCloseTo(595.28, 1); expect(delivers(p)).toHaveLength(1); }
  });

  it("A4 · all labels on one page: 1, 2 and 3 cartons each fit one sheet; two shipments never share a sheet", async () => {
    for (const boxes of [1, 2, 3]) {
      const sid = await ship({ boxes, pieces: Array.from({ length: boxes }, (_, i) => `99${boxes}00${i}`) });
      const r = await renderLabels(ORG, [sid], "a4_fit");
      expect(r.skipped).toEqual([]);
      const pages = await pdfPages(r.pdf!);
      expect(pages).toHaveLength(1);
      expect(delivers(pages[0])).toHaveLength(boxes + 1); // + the B2B shipment document
      expect(pages[0].text).toContain("SHIPMENT DOCUMENT");
      // (barcode decoding is covered on thermal pages: the test decoder cannot split two barcodes side by side in the 2 × 2 grid)
    }
    const a = await ship({ mode: "B2C", provider: "delhivery_b2c" }), b = await ship({ mode: "B2C", provider: "delhivery_b2c" });
    const pages = await pdfPages((await renderLabels(ORG, [a, b], "a4_fit")).pdf!);
    expect(pages).toHaveLength(2);
  });

  it("A4 · label + invoice: labels on the top half, the shipper's invoice below the cut line, no COD amount", async () => {
    const sid = await ship({ boxes: 2, pieces: ["7700001", "7700002"], pay: "cod", mode: "B2C", provider: "delhivery_b2c" });
    const r = await renderLabels(ORG, [sid], "a4_doc");
    expect(r.skipped).toEqual([]);
    const [p, ...more] = await pdfPages(r.pdf!);
    expect(more).toHaveLength(0);
    const labels = delivers(p);
    expect(labels).toHaveLength(2);
    for (const l of labels) expect(l.transform[5]).toBeGreaterThan(p.h / 2);
    const inv = p.items.find((i) => i.str === "INVOICE")!;
    expect(inv.transform[5]).toBeLessThan(p.h / 2);
    for (const t of ["cut here", "Penvish Bath Fittings LLP", "05ABCPZ9876K1Z2", "Bill / ship to", "Shree Balaji Traders Pvt Ltd", "Steel Almirah", "Office Chair", "Rs. 25,000.00", "Rs. 50,000.00", "Total Rs. 75,000.00", "COD"]) expect(p.text).toContain(t);
    expect(p.text).not.toContain("1,234.56"); // the COD amount (₹1,234.56) is never printed
    // B2B, 3 cartons: sheet 1 = shipment document + invoice (stapled together), sheet 2 = the 3 carton labels
    const sid3 = await ship({ boxes: 3, pieces: ["7710001", "7710002", "7710003"] });
    const p3 = await pdfPages((await renderLabels(ORG, [sid3], "a4_doc")).pdf!);
    expect(p3).toHaveLength(2);
    expect(p3[0].text).toContain("SHIPMENT DOCUMENT");
    expect(p3[0].text).toContain("INVOICE");
    expect(delivers(p3[1])).toHaveLength(3);
    expect(p3[1].text).not.toContain("SHIPMENT DOCUMENT");
  });
});

describe("downloads are safe", { timeout: 20_000 }, () => {
  it("another account's shipment is not found for a customer; Admin (no org filter) can download it", async () => {
    const theirs = await ship({ org: OTHER, mode: "B2C", provider: "delhivery_b2c" });
    expect((await renderLabels(ORG, [theirs], "thermal_4x6")).skipped[0]).toMatchObject({ reason: "Not found" });
    expect((await renderLabels(null, [theirs], "thermal_4x6")).pdf).not.toBeNull();
  });

  it("bulk with a partial failure: available labels download; the pending one is listed for Retry", async () => {
    const good = await ship({ mode: "B2C", provider: "delhivery_b2c" });
    const pending = await ship({ mode: "B2C", provider: "delhivery_b2c", awb: null });
    const cancelled = await ship({ mode: "B2C", provider: "delhivery_b2c", status: "cancelled" });
    const r = await renderLabels(ORG, [good, pending, cancelled], "a4_2up");
    expect(r.pages).toBe(1);
    expect(r.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ shipmentId: pending, retryable: true }), expect.objectContaining({ shipmentId: cancelled, retryable: false }),
    ]));
  });

  it("demo shipments never print in production", async () => {
    const sid = await ship({ provider: "demo", mode: "B2C" });
    const env = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try { expect((await renderLabels(ORG, [sid], "thermal_4x6")).skipped[0].reason).toMatch(/Demo shipment/); }
    finally { (process.env as Record<string, string>).NODE_ENV = env!; }
  });
});

describe("carrier label (courier's original)", { timeout: 20_000 }, () => {
  async function pdfBytes(text: string) { const d = await PDFDocument.create(); d.addPage([288, 432]).drawText(text, { x: 20, y: 200, size: 12, color: rgb(0, 0, 0) }); return d.save(); }

  it("PDF bytes, base64 inside JSON, and a redirected link all become PDF pages; repeated downloads never book or charge", async () => {
    const sid = await ship({ mode: "B2B", pieces: ["1"] });
    const before = { ships: (await db.select().from(schema.shipments)).length, ledger: (await db.select().from(schema.ledgerEntries)).length };
    const pdf = await pdfBytes("CARRIER-PDF");
    const b64 = Buffer.from(await pdfBytes("CARRIER-B64")).toString("base64");
    files.set("https://labels.example/one.pdf", () => new Response(null, { status: 302, headers: { location: "https://cdn.labels.example/one.pdf" } }));
    files.set("https://cdn.labels.example/one.pdf", () => new Response(Buffer.from(pdf), { status: 200 }));
    carrierReply = [
      () => ({ ok: true, value: { pdf, formatsAvailable: [] } }),
      () => ({ ok: true, value: { pdf: Buffer.from(JSON.stringify({ success: true, data: [{ label: b64 }] })), formatsAvailable: [] } }),
      () => ({ ok: true, value: { images: ["https://labels.example/one.pdf"], formatsAvailable: [] } }),
    ];
    for (const want of ["CARRIER-PDF", "CARRIER-B64", "CARRIER-PDF"]) {
      const r = await renderLabels(ORG, [sid], "original");
      expect(r.skipped).toEqual([]);
      expect((await pdfPages(r.pdf!))[0].text).toContain(want);
    }
    expect(fakeAdapter.book).not.toHaveBeenCalled();
    expect((await db.select().from(schema.shipments)).length).toBe(before.ships);
    expect((await db.select().from(schema.ledgerEntries)).length).toBe(before.ledger);
    const [row] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, sid));
    expect(row.labelStatus).toBe("available");
  });

  it("an expired label link is refreshed once from the courier; a pending label is retryable", async () => {
    const sid = await ship({ mode: "B2B", pieces: ["1"] });
    const pdf = await pdfBytes("FRESH");
    files.set("https://labels.example/old.pdf", () => new Response("expired", { status: 403 }));
    files.set("https://labels.example/new.pdf", () => new Response(Buffer.from(pdf), { status: 200 }));
    carrierReply = [() => ({ ok: true, value: { url: "https://labels.example/old.pdf", formatsAvailable: [] } }), () => ({ ok: true, value: { url: "https://labels.example/new.pdf", formatsAvailable: [] } })];
    const r = await renderLabels(ORG, [sid], "original");
    expect((await pdfPages(r.pdf!))[0].text).toContain("FRESH");
    carrierReply = [() => ({ ok: false, error: { message: "Delhivery has not generated labels for this LR yet", retryable: true } }), () => ({ ok: false, error: { message: "Delhivery has not generated labels for this LR yet", retryable: true } })];
    const p = await renderLabels(ORG, [sid], "original");
    expect(p.skipped[0]).toMatchObject({ shipmentId: sid, retryable: true });
  });

  it("COD carrier label: notice that the courier's label shows the COD amount", async () => {
    const sid = await ship({ mode: "B2C", provider: "delhivery_b2c", pay: "cod" });
    carrierReply = [async () => ({ ok: true, value: { pdf: await pdfBytes("COD LABEL"), formatsAvailable: [] } })];
    const r = await renderLabels(ORG, [sid], "original");
    expect(r.notices.join()).toMatch(/COD amount/);
  });
});

describe("Delhivery B2B label reply formats", () => {
  const ctxWith = (reply: () => Response) => ({ accountId: `acct_${Math.random()}`, mode: "live" as const, config: {}, secrets: { username: "u", password: "p" },
    fetch: async (url: string) => (url.endsWith("/ums/login") ? new Response(JSON.stringify({ jwt: "t" })) : reply()) });
  it("PDF file, PNG file, JSON with links, JSON with base64 per carton, and an empty reply", async () => {
    const pdf = Buffer.from("%PDF-1.4 test");
    let r = await delhiveryB2bAdapter.label(ctxWith(() => new Response(pdf)), { providerOrderRef: "x", awb: "220011" }, "thermal_3x4");
    expect(r.ok && r.value.pdf).toBeTruthy();
    r = await delhiveryB2bAdapter.label(ctxWith(() => new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]))), { providerOrderRef: "x", awb: "220011" }, "thermal_3x4");
    expect(r.ok && r.value.images?.[0]).toMatch(/^data:image\/png;base64,/);
    r = await delhiveryB2bAdapter.label(ctxWith(() => new Response(JSON.stringify({ data: { label_urls: ["https://s3.example/a.png", "https://s3.example/b.png"] } }))), { providerOrderRef: "x", awb: "220011" }, "thermal_3x4");
    expect(r.ok && r.value.images).toEqual(["https://s3.example/a.png", "https://s3.example/b.png"]);
    r = await delhiveryB2bAdapter.label(ctxWith(() => new Response(JSON.stringify([{ wbn: "1", label: "A".repeat(300) }]))), { providerOrderRef: "x", awb: "220011" }, "thermal_3x4");
    expect(r.ok && r.value.images?.[0]).toMatch(/^data:application\/octet-stream;base64,A+$/);
    r = await delhiveryB2bAdapter.label(ctxWith(() => new Response(JSON.stringify({ success: true, data: [] }))), { providerOrderRef: "x", awb: "220011" }, "thermal_3x4");
    expect(r).toMatchObject({ ok: false, error: { retryable: true, message: expect.stringMatching(/not generated/) } });
  });
});
