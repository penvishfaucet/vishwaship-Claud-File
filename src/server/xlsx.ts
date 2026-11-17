import "server-only";

/** Build an .xlsx with the same rows as the CSV export. Text cells get the same formula-injection guard. */
export async function toXlsx(sheet: string, headers: string[], rows: unknown[][]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Vishwaship";
  const ws = wb.addWorksheet(sheet.slice(0, 31));
  ws.addRow(headers).font = { bold: true };
  for (const r of rows) {
    ws.addRow(r.map((v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return v;
      const s = v instanceof Date ? v.toISOString() : String(v);
      if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 15) return Number(s); // numeric amounts stay numeric for SUM()
      return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    }));
  }
  ws.columns.forEach((c) => { c.width = 18; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
