import "server-only";
import { redirect } from "next/navigation";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";
import { storeForOrg } from "./service";

export const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");

/** Portal page guard: session org + Online Store module. Store may be null (not created yet). */
export async function storePage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "online_store");
  return { ctx, store: await storeForOrg(ctx.org.id) };
}

/** Same, but sends the merchant to the start page when there is no store yet. */
export async function requireStorePage() {
  const r = await storePage();
  if (!r.store) redirect("/portal/store/");
  return { ctx: r.ctx, store: r.store };
}
