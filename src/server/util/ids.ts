import { randomBytes } from "node:crypto";

const ALPHA = "0123456789abcdefghijkmnpqrstuvwxyz";

/** Prefixed, sortable-ish random id: e.g. ord_m3x9k2h4p7q8r2s5 */
export function newId(prefix: string, len = 16): string {
  const bytes = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return `${prefix}_${Date.now().toString(36)}${s}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
