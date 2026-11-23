import "server-only";
import { podFile } from "./pod";

/** Response for a stored POD file: inline (preview) or attachment (Download POD). Never cached by shared proxies. */
export async function podResponse(shipmentId: string, orgId: string | null, url: URL) {
  const part = url.searchParams.get("part") === "signature" ? "signature" : "pod";
  const f = await podFile(shipmentId, orgId, part);
  if (!f) return null;
  const disp = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": f.mime, "content-disposition": `${disp}; filename="${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
