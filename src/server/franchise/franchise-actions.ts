"use server";
import { redirect } from "next/navigation";
import { setCustomerPrice } from "./commission";
import { FranchiseError } from "./service";
import { requireFranchise } from "./session";

/** Franchise dashboard: set one customer's price (percent), or reset it to Vishwaship's standard rate. */
export async function saveCustomerPrice(fd: FormData) {
  const { session, franchise } = await requireFranchise();
  const orgId = String(fd.get("orgId") ?? "");
  const reset = String(fd.get("reset") ?? "") === "1";
  const raw = String(fd.get("percent") ?? "").trim();
  let q: string;
  try {
    await setCustomerPrice(session.userId, franchise, orgId, reset ? null : raw === "" ? NaN : Number(raw));
    q = `ok=${encodeURIComponent(reset ? "Price set back to Vishwaship standard" : "Price saved. New quotes use it at once.")}`;
  } catch (e) {
    if (!(e instanceof FranchiseError)) throw e;
    q = `err=${encodeURIComponent(e.message)}`;
  }
  redirect(`/franchise/pricing/?${q}`);
}
