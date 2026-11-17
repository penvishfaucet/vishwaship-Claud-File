import { describe, expect, it } from "vitest";
import { BULK_COLUMNS, BULK_SAMPLE_ROW, parseCsv, validateBulk } from "./bulk";

const header = [...BULK_COLUMNS];
const row = (patch: Partial<Record<(typeof BULK_COLUMNS)[number], string>>) => BULK_COLUMNS.map((c, i) => patch[c] ?? BULK_SAMPLE_ROW[i]);

describe("parseCsv", () => {
  it("handles quotes, embedded commas, CRLF and BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });
  it("drops blank lines", () => {
    expect(parseCsv("a\n\n\nb\n")).toEqual([["a"], ["b"]]);
  });
});

describe("validateBulk", () => {
  it("accepts a valid row", () => {
    const { results } = validateBulk([header, row({})], "wh1", new Set());
    expect(results[0].ok).toBe(true);
    expect(results[0].input?.consignee.pincode).toBe("411001");
  });
  it("reports row-level errors with spreadsheet row numbers", () => {
    const { results } = validateBulk([header, row({}), row({ order_id: "B2", pincode: "12", payment: "cod", cod_amount: "" })], "wh1", new Set());
    expect(results[1].row).toBe(3);
    expect(results[1].ok).toBe(false);
    expect(results[1].errors.join(" ")).toMatch(/PIN code/);
    expect(results[1].errors.join(" ")).toMatch(/COD amount/);
  });
  it("flags duplicates inside the file and against existing orders", () => {
    const { results } = validateBulk([header, row({ order_id: "X1" }), row({ order_id: "X1" }), row({ order_id: "OLD" })], "wh1", new Set(["OLD"]));
    expect(results[1].errors[0]).toMatch(/also on row 2/);
    expect(results[2].errors[0]).toMatch(/already exists/);
  });
  it("rejects a file with missing columns", () => {
    expect(validateBulk([["order_id"], ["x"]], "wh1", new Set()).headerError).toMatch(/Missing column/);
  });
});
