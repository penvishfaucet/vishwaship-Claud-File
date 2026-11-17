import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("escapes formula injection", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+91 99")).toBe("'+91 99");
    expect(csvCell("@sum")).toBe("'@sum");
  });
  it("keeps negative numbers as numbers", () => {
    expect(csvCell(-125.5)).toBe("-125.5");
  });
  it("quotes commas and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(toCsv(["h"], [["x"]])).toBe("﻿h\r\nx\r\n");
  });
});
