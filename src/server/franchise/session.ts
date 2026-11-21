import "server-only";
import { redirect } from "next/navigation";
import { readSession } from "@/server/auth/session";
import { franchiseForUser } from "./portal";

/** Pages in the franchise dashboard: signed-in franchise user with a franchise that is not terminated. */
export async function requireFranchise() {
  const s = await readSession("franchise");
  if (!s) redirect("/franchise/login/");
  const f = await franchiseForUser(s.userId);
  if (!f) redirect("/franchise/login/?err=closed");
  return { session: s, franchise: f };
}
