/**
 * Strings inside a courier's JSON reply that look like a label: an HTTPS link, a data: URL, or a long base64 blob.
 * Couriers wrap labels in many shapes ({ data: [...] }, { label_urls: {...} }, [{ url }], { label: "JVBERi..." }).
 * Error / message / status fields are ignored so an error text is never mistaken for a label.
 */
export function labelStrings(j: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 5 || j == null) return out;
  if (typeof j === "string") {
    const s = j.trim();
    if (/^https:\/\//.test(s) || /^data:[a-z/+.-]+;base64,/i.test(s) || (s.length > 200 && /^[A-Za-z0-9+/=\s_-]+$/.test(s))) out.push(s);
    return out;
  }
  if (Array.isArray(j)) { for (const x of j) labelStrings(x, out, depth + 1); return out; }
  if (typeof j === "object") for (const [k, v] of Object.entries(j as Record<string, unknown>)) if (!/^(error|errors|message|msg|status|success|remark|detail)$/i.test(k)) labelStrings(v, out, depth + 1);
  return out;
}
