"use server";
import { redirect } from "next/navigation";
import { eq, max } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import { ThemeConfig, themeByKey } from "@/lib/store-themes";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (id: string, q: string) => redirect(`/admin/online-stores/${id}/?${q}`);

async function storeById(id: string) {
  const db = await getDb();
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, id));
  return s ?? null;
}

/** Pause a store (buyers get 404, merchant cannot re-publish) or let it go back to the merchant's control. */
export async function setStoreSuspended(fd: FormData) {
  const staff = await requireStaff("modules.manage");
  const s = await storeById(str(fd, "storeId"));
  if (!s) redirect("/admin/online-stores/?err=Store+not+found");
  const suspend = str(fd, "suspend") === "1";
  const reason = str(fd, "reason").slice(0, 300);
  if (suspend && reason.length < 5) back(s.id, "err=Enter+a+reason+the+merchant+will+see");
  const db = await getDb();
  await db.update(schema.stores).set({ status: suspend ? "suspended" : (s.publishedTheme ? "paused" : "draft"), suspendedReason: suspend ? reason : null, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  await audit({ actorUserId: staff.userId, actorKind: "staff", orgId: s.orgId, action: suspend ? "store.suspend" : "store.unsuspend", targetType: "store", targetId: s.id, details: suspend ? { reason } : undefined });
  back(s.id, `ok=${suspend ? "Store+paused" : "Store+released.+The+merchant+can+publish+again."}`);
}

/**
 * Apply a custom design: writes the theme config into the merchant's draft (optionally publishing it) and can lock
 * theme switching so the merchant keeps the custom look. Only this store is touched.
 */
export async function applyCustomDesign(fd: FormData) {
  const staff = await requireStaff("modules.manage");
  const s = await storeById(str(fd, "storeId"));
  if (!s) redirect("/admin/online-stores/?err=Store+not+found");
  let parsed: ThemeConfig;
  try {
    const p = ThemeConfig.safeParse(JSON.parse(str(fd, "config")));
    if (!p.success) back(s.id, `err=${encodeURIComponent(`Invalid design: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}`)}`);
    parsed = p.data!;
  } catch { back(s.id, "err=Design+must+be+valid+JSON"); return; }
  const lock = str(fd, "lock") === "1";
  const publish = str(fd, "publish") === "1";
  const themeKey = themeByKey(str(fd, "themeKey") || s.themeKey).key;
  const db = await getDb();
  await db.update(schema.stores).set({ draftTheme: parsed, themeKey, customDesign: lock, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
  if (publish && s.status === "live") {
    const [{ v }] = await db.select({ v: max(schema.storeThemeVersions.version) }).from(schema.storeThemeVersions).where(eq(schema.storeThemeVersions.storeId, s.id));
    await db.insert(schema.storeThemeVersions).values({ id: newId("stv"), storeId: s.id, orgId: s.orgId, version: (v ?? 0) + 1, themeKey, config: parsed, publishedBy: staff.userId, note: "Custom design by Vishwaship" });
    await db.update(schema.stores).set({ publishedTheme: parsed, publishedAt: new Date() }).where(eq(schema.stores.id, s.id));
  }
  await audit({ actorUserId: staff.userId, actorKind: "staff", orgId: s.orgId, action: "store.custom_design", targetType: "store", targetId: s.id, details: { lock, published: publish && s.status === "live", themeKey } });
  back(s.id, "ok=Custom+design+applied");
}

/** Record the SSL state after the edge proxy issued (or failed) a certificate for a merchant domain. */
export async function setDomainSsl(fd: FormData) {
  const staff = await requireStaff("integrations.write");
  const id = str(fd, "domainId");
  const ssl = str(fd, "ssl");
  if (!["pending_setup", "pending", "active", "failed"].includes(ssl)) redirect("/admin/online-stores/?err=Bad+status");
  const db = await getDb();
  const [d] = await db.select().from(schema.storeDomains).where(eq(schema.storeDomains.id, id));
  if (!d) redirect("/admin/online-stores/?err=Domain+not+found");
  if (ssl === "active" && d.status !== "verified") back(d.storeId, "err=Verify+the+domain+DNS+first");
  await db.update(schema.storeDomains).set({ sslStatus: ssl }).where(eq(schema.storeDomains.id, id));
  await audit({ actorUserId: staff.userId, actorKind: "staff", orgId: d.orgId, action: "store.domain_ssl", targetType: "store_domain", targetId: id, details: { hostname: d.hostname, ssl } });
  back(d.storeId, "ok=SSL+status+updated");
}

export async function setHelpRequestStatus(fd: FormData) {
  const staff = await requireStaff("tickets.write");
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!["new", "contacted", "closed"].includes(status)) redirect("/admin/online-stores/?tab=help&err=Bad+status");
  const db = await getDb();
  await db.update(schema.storeHelpRequests).set({ status }).where(eq(schema.storeHelpRequests.id, id));
  await audit({ actorUserId: staff.userId, actorKind: "staff", action: "store.help_request", targetType: "store_help_request", targetId: id, details: { status } });
  redirect("/admin/online-stores/?tab=help&ok=Updated");
}
