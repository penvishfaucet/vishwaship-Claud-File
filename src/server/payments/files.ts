import "server-only";

/** Payment screenshots / QR images are accepted by content (magic bytes), never by the browser-supplied type. */
const isPng = (b: Buffer) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebp = (b: Buffer) => b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
const isPdf = (b: Buffer) => b.length > 5 && b.subarray(0, 5).toString("ascii") === "%PDF-";

export const PROOF_MAX = 5 * 1024 * 1024;
export const QR_MAX = 2 * 1024 * 1024;

export function sniffProof(b: Buffer): { mime: string; ext: string } | null {
  if (!b.length || b.length > PROOF_MAX) return null;
  if (isPng(b)) return { mime: "image/png", ext: "png" };
  if (isJpeg(b)) return { mime: "image/jpeg", ext: "jpg" };
  if (isWebp(b)) return { mime: "image/webp", ext: "webp" };
  if (isPdf(b)) return { mime: "application/pdf", ext: "pdf" };
  return null;
}

export function sniffQr(b: Buffer): { mime: string; ext: string } | null {
  if (!b.length || b.length > QR_MAX) return null;
  if (isPng(b)) return { mime: "image/png", ext: "png" };
  if (isJpeg(b)) return { mime: "image/jpeg", ext: "jpg" };
  if (isWebp(b)) return { mime: "image/webp", ext: "webp" };
  return null;
}

export const fileResponse = (buf: Buffer, mime: string, name: string, download = false) => new Response(new Uint8Array(buf), {
  headers: {
    "content-type": mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/[^\w.-]/g, "_")}"`,
  },
});
