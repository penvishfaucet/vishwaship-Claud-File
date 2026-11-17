// Usage: node scripts/pdf-to-text.mjs <input.pdf> <output.txt>
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [, , input, output] = process.argv;
const data = new Uint8Array(await readFile(input));
const doc = await getDocument({ data, isEvalSupported: false }).promise;
let out = "";
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  let lastY = null, line = "";
  const lines = [];
  for (const it of tc.items) {
    const y = Math.round(it.transform[5]);
    if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ""; }
    line += it.str + (it.hasEOL ? "" : "");
    lastY = y;
  }
  lines.push(line);
  out += `\n===== PAGE ${p} =====\n` + lines.join("\n");
}
writeFileSync(output, out);
console.log(`Wrote ${doc.numPages} pages to ${output}`);
