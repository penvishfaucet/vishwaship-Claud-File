import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getPrivate, newKey, putPrivate } from "@/server/storage";

/**
 * Profile avatar of one signed-in user: a photo (cropped on the device, re-encoded here), a single emoji, or nothing
 * (initials). Kept in users.prefs.avatar so it follows the account to every device. Only the user's own session can
 * read or change it; the photo lives in private storage.
 */
export type Avatar = { type: "photo"; v: number } | { type: "emoji"; value: string } | null;
type Stored = { type: "photo"; key: string; v: number } | { type: "emoji"; value: string };
export class AvatarError extends Error {}

const MAX_BYTES = 5 * 1024 * 1024;

async function prefsOf(userId: string) {
  const db = await getDb();
  const [u] = await db.select({ prefs: schema.users.prefs }).from(schema.users).where(eq(schema.users.id, userId));
  return (u?.prefs as Record<string, unknown>) ?? {};
}
async function save(userId: string, avatar: Stored | null) {
  const db = await getDb();
  const prefs = { ...(await prefsOf(userId)) };
  if (avatar) prefs.avatar = avatar; else delete prefs.avatar;
  await db.update(schema.users).set({ prefs }).where(eq(schema.users.id, userId));
}

/** What the pages show (never the storage key). */
export async function readAvatar(userId: string): Promise<Avatar> {
  const a = (await prefsOf(userId)).avatar as Stored | undefined;
  if (a?.type === "photo") return { type: "photo", v: a.v };
  if (a?.type === "emoji" && isOneEmoji(a.value)) return { type: "emoji", value: a.value };
  return null;
}

/** Exactly one emoji (keeps skin tones, ZWJ families, flags and keycaps). */
export function isOneEmoji(s: string) {
  const t = s.trim();
  if (!t || t.length > 32) return false;
  const seg = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(t)];
  if (seg.length !== 1) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(t);
}

export async function setEmoji(userId: string, emoji: string) {
  if (!isOneEmoji(emoji)) throw new AvatarError("Choose one emoji");
  await save(userId, { type: "emoji", value: emoji.trim() });
  return readAvatar(userId);
}

const isWebp = (b: Buffer) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

/** Photo: JPEG / PNG / WebP up to 5 MB, checked by its bytes, re-encoded square (strips location and other metadata). */
export async function setPhoto(userId: string, buf: Buffer) {
  if (!buf.length || buf.length > MAX_BYTES) throw new AvatarError("Photo must be under 5 MB");
  if (!isJpeg(buf) && !isPng(buf) && !isWebp(buf)) throw new AvatarError("Use a JPG, PNG or WebP photo");
  let out: Buffer;
  try {
    const sharp = (await import("sharp")).default;
    out = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize(320, 320, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
  } catch { throw new AvatarError("That photo could not be read. Try another one."); }
  const key = newKey(`avatars/${userId.replace(/[^a-z0-9_-]/gi, "").toLowerCase()}`, "jpg");
  await putPrivate(key, out);
  await save(userId, { type: "photo", key, v: Date.now() });
  return readAvatar(userId);
}

export async function clearAvatar(userId: string) {
  await save(userId, null);
  return null;
}

export async function avatarPhoto(userId: string) {
  const a = (await prefsOf(userId)).avatar as Stored | undefined;
  if (a?.type !== "photo") return null;
  try { return await getPrivate(a.key); } catch { return null; }
}
