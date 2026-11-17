import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { storageDriver, testStorage } from "@/server/storage";

/** Which file storage is active (no secrets returned). */
export async function GET() {
  const s = await apiStaff("integrations.read");
  if (!s) return apiError(403, "forbidden", "You cannot view integrations");
  return NextResponse.json({ driver: storageDriver(), bucket: process.env.S3_BUCKET ?? null });
}

/** Upload, download and delete a tiny test file. */
export async function POST() {
  const s = await apiStaff("integrations.write");
  if (!s) return apiError(403, "forbidden", "You cannot test integrations");
  const r = await testStorage();
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "storage.test", details: { ok: r.ok, driver: r.driver } });
  return NextResponse.json(r);
}
