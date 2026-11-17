import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { decrypt, encrypt, hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { randomToken } from "@/server/util/ids";

/**
 * Private document storage. Local dev: files encrypted (AES-GCM) under ./.data/private.
 * Staging/production: set S3_* env vars; the S3 driver (server-side encryption + private bucket)
 * replaces these functions without changing callers. Documents are NEVER served from /public.
 */
const ROOT = join(process.cwd(), ".data", "private");

function safePath(key: string) {
  if (!/^[a-z0-9_\-/]+\.[a-z0-9]+$/i.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const p = normalize(join(ROOT, key));
  if (!p.startsWith(ROOT)) throw new Error("Invalid storage key");
  return p;
}

export async function putPrivate(key: string, data: Buffer) {
  const p = safePath(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, encrypt(data.toString("base64")));
}

export async function getPrivate(key: string): Promise<Buffer> {
  return Buffer.from(decrypt(await readFile(safePath(key), "utf8")), "base64");
}

/** Short-lived signed link (default 5 min) for authorised viewers. */
export function signedLink(key: string, ttlSec = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = hmacSha256Hex(process.env.APP_ENCRYPTION_KEY ?? "dev", `${key}:${exp}`);
  return `/api/files?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
}
export function verifyLink(key: string, exp: string, sig: string) {
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmacSha256Hex(process.env.APP_ENCRYPTION_KEY ?? "dev", `${key}:${exp}`), sig);
}

const MAGIC: Array<[string, number[]]> = [["application/pdf", [0x25, 0x50, 0x44, 0x46]], ["image/png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", [0xff, 0xd8, 0xff]]];
/** Validate by content (magic bytes), not by the client-supplied type. Max 5 MB. */
export function sniffUpload(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length === 0 || buf.length > 5 * 1024 * 1024) return null;
  for (const [mime, sig] of MAGIC) if (sig.every((b, i) => buf[i] === b)) return { mime, ext: mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg" };
  return null;
}

export const newKey = (prefix: string, ext: string) => `${prefix}/${randomToken(12).replace(/[^a-z0-9]/gi, "x")}.${ext}`;
