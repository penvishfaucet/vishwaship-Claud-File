import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { decrypt, encrypt, hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { randomToken } from "@/server/util/ids";

/**
 * Private document storage. Files are always encrypted (AES-GCM, APP_ENCRYPTION_KEY) before they leave the app.
 * - S3_ENDPOINT + S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY set → private S3-compatible bucket
 *   (Cloudflare R2, Backblaze B2, AWS S3, …). Needed on hosts whose disk is replaced on every deploy (Hostinger).
 * - Otherwise → ./.data/private on local disk (development).
 * Reads fall back to local disk so files saved before the bucket was configured still open.
 * Documents are NEVER served from /public; viewers get short-lived signed links (/api/files).
 */
const ROOT = join(process.cwd(), ".data", "private");

type S3Conf = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
function s3Conf(): S3Conf | null {
  const endpoint = process.env.S3_ENDPOINT?.trim().replace(/\/+$/, "");
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.S3_REGION?.trim() || "auto" };
}
export const storageDriver = () => (s3Conf() ? "s3" : "disk");

let s3Client: { c: S3Conf; client: import("aws4fetch").AwsClient } | null = null;
async function s3(): Promise<{ c: S3Conf; client: import("aws4fetch").AwsClient } | null> {
  const c = s3Conf();
  if (!c) return null;
  if (!s3Client || s3Client.c.accessKeyId !== c.accessKeyId || s3Client.c.endpoint !== c.endpoint) {
    const { AwsClient } = await import("aws4fetch");
    s3Client = { c, client: new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, region: c.region, service: "s3" }) };
  }
  return s3Client;
}
// Path-style URL (works for R2, B2, MinIO and AWS); keys are already restricted to [a-z0-9_-/.] by safeKey().
const objectUrl = (c: S3Conf, key: string) => `${c.endpoint}/${encodeURIComponent(c.bucket)}/${key}`;

function safeKey(key: string) {
  if (!/^[a-z0-9_\-/]+\.[a-z0-9]+$/i.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
  return key;
}

function safePath(key: string) {
  if (!/^[a-z0-9_\-/]+\.[a-z0-9]+$/i.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const p = normalize(join(ROOT, key));
  if (!p.startsWith(ROOT)) throw new Error("Invalid storage key");
  return p;
}

export async function putPrivate(key: string, data: Buffer) {
  const body = encrypt(data.toString("base64"));
  const b = await s3();
  if (b) {
    const res = await b.client.fetch(objectUrl(b.c, safeKey(key)), { method: "PUT", body, headers: { "content-type": "application/octet-stream" } });
    if (!res.ok) throw new Error(`File storage rejected the upload (HTTP ${res.status}). Check the S3_* settings.`);
    return;
  }
  const p = safePath(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body);
}

export async function getPrivate(key: string): Promise<Buffer> {
  const b = await s3();
  if (b) {
    const res = await b.client.fetch(objectUrl(b.c, safeKey(key)), { method: "GET" });
    if (res.ok) return Buffer.from(decrypt(await res.text()), "base64");
    if (res.status !== 404) throw new Error(`File storage error (HTTP ${res.status})`);
    // not in the bucket: maybe saved on disk before the bucket was configured
  }
  return Buffer.from(decrypt(await readFile(safePath(key), "utf8")), "base64");
}

/** Admin check: write, read back and delete a small test object. */
export async function testStorage(): Promise<{ ok: boolean; driver: "s3" | "disk"; message: string }> {
  const b = await s3();
  if (!b) return { ok: true, driver: "disk", message: "Using local disk (.data/private). Files are lost when the host replaces the disk on deploy." };
  const key = `healthcheck/${randomToken(8).replace(/[^a-z0-9]/gi, "x")}.txt`;
  try {
    await putPrivate(key, Buffer.from("ok"));
    const back = (await getPrivate(key)).toString();
    await b.client.fetch(objectUrl(b.c, key), { method: "DELETE" });
    return back === "ok" ? { ok: true, driver: "s3", message: `Bucket "${b.c.bucket}" works: upload, download and delete succeeded.` } : { ok: false, driver: "s3", message: "Bucket returned different content" };
  } catch (e) {
    return { ok: false, driver: "s3", message: (e as Error).message };
  }
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
