"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/server/audit";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

/** Admin → Plans & Features → Free first month: switch the launch offer and set its length / start date. */
export async function saveFreeTrial(fd: FormData) {
  const s = await requireStaff("pricing.write");
  const days = Number(fd.get("days"));
  const startsOn = String(fd.get("startsOn") ?? "");
  if (!(Number.isInteger(days) && days >= 0 && days <= 365) || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) redirect("/admin/plans/?err=" + encodeURIComponent("Free month: enter whole days (0–365) and a start date"));
  const value = { enabled: fd.get("enabled") === "on", days, startsOn };
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: "free_trial", value })
    .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "free_trial.updated", targetType: "setting", targetId: "free_trial", details: value });
  revalidatePath("/admin/plans/");
  redirect("/admin/plans/?ok=" + encodeURIComponent("Free first month saved"));
}
