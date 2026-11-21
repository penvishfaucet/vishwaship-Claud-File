"use server";
import { redirect } from "next/navigation";
import { requireStaff } from "@/server/auth/session";
import type { Permission } from "@/server/auth/rbac";
import { lookupPincode } from "@/server/pincode";
import {
  FranchiseError, addDistrict, addPincode, createFranchise, publishTerms, recordAgreement, recordDeposit, releaseArea, setKycVerified, setStatus,
  settleDeposit, updateFranchise, type FranchiseInputT, type FranchiseStatus,
} from "@/server/franchise/service";

/**
 * Admin → Franchises form actions. Permissions: customers.write for the record, areas, KYC and agreement;
 * finance.adjust for deposits; modules.manage (owner) for activate / suspend / terminate and the Terms.
 */
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const q = (k: "ok" | "err", m: string) => `${k}=${encodeURIComponent(m)}`;
const detail = (id: string) => `/admin/franchises/${encodeURIComponent(id)}/`;

async function run(perm: Permission, back: string, okMsg: string, fn: (actor: string) => Promise<unknown>) {
  const staff = await requireStaff(perm);
  let msg: string;
  try {
    await fn(staff.userId);
    msg = q("ok", okMsg);
  } catch (e) {
    if (!(e instanceof FranchiseError)) throw e;
    msg = q("err", e.message);
  }
  redirect(`${back}${back.includes("?") ? "&" : "?"}${msg}`);
}

const formInput = (fd: FormData): FranchiseInputT => ({
  businessName: str(fd, "businessName"), ownerName: str(fd, "ownerName"), mobile: str(fd, "mobile").replace(/\D/g, "").slice(-10), email: str(fd, "email"),
  gstin: str(fd, "gstin"), pan: str(fd, "pan"), line1: str(fd, "line1"), line2: str(fd, "line2"), city: str(fd, "city"), state: str(fd, "state"), pincode: str(fd, "pincode"),
  depositRupees: str(fd, "depositRupees") || "0", monthlyTarget: str(fd, "monthlyTarget") || "0", termStart: str(fd, "termStart"), termEnd: str(fd, "termEnd"), notes: str(fd, "notes"),
});

/** values: what was typed, sent back so React's automatic form reset refills the fields after an error. */
export type FormState = { error?: string; values?: Record<string, string> } | undefined;

/** Create and edit use useActionState so a mistake keeps what was typed. */
export async function saveFranchise(_: FormState, fd: FormData): Promise<FormState> {
  const staff = await requireStaff("customers.write");
  const id = str(fd, "id");
  let target: string;
  try {
    if (id) { await updateFranchise(staff.userId, id, formInput(fd)); target = `${detail(id)}?${q("ok", "Saved")}`; }
    else { const nid = await createFranchise(staff.userId, formInput(fd)); target = `${detail(nid)}?${q("ok", "Franchise created. Next: give an area, record the deposit, KYC and agreement.")}`; }
  } catch (e) {
    if (e instanceof FranchiseError) {
      const values: Record<string, string> = {};
      for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) values[k] = v.slice(0, 2000);
      return { error: e.message, values };
    }
    throw e;
  }
  redirect(target);
}

export async function addFranchiseArea(fd: FormData) {
  const id = str(fd, "franchiseId");
  const kind = str(fd, "kind");
  await run("customers.write", detail(id), kind === "pincode" ? "PIN added" : "District added", async (actor) => {
    if (kind === "pincode") await addPincode(actor, id, str(fd, "pincode"), lookupPincode);
    else await addDistrict(actor, id, str(fd, "state"), str(fd, "district"));
  });
}

export async function releaseFranchiseArea(fd: FormData) {
  await run("customers.write", detail(str(fd, "franchiseId")), "Area released", (actor) => releaseArea(actor, str(fd, "areaId")));
}

export async function recordFranchiseDeposit(fd: FormData) {
  const id = str(fd, "franchiseId");
  await run("finance.adjust", detail(id), "Deposit recorded", (actor) => recordDeposit(actor, id, {
    amountRupees: str(fd, "amountRupees"), method: str(fd, "method") as "upi", reference: str(fd, "reference"), receivedOn: str(fd, "receivedOn"),
  }));
}

export async function settleFranchiseDeposit(fd: FormData) {
  await run("finance.adjust", detail(str(fd, "franchiseId")), "Deposit closed", (actor) => settleDeposit(actor, str(fd, "depositId"), {
    refundRupees: str(fd, "refundRupees") || "0", forfeitRupees: str(fd, "forfeitRupees") || "0", refundReference: str(fd, "refundReference"), note: str(fd, "note"),
  }));
}

export async function setFranchiseKyc(fd: FormData) {
  const verified = str(fd, "verified") === "1";
  await run("customers.write", detail(str(fd, "franchiseId")), verified ? "KYC marked verified" : "KYC mark removed", (actor) => setKycVerified(actor, str(fd, "franchiseId"), verified));
}

export async function recordFranchiseAgreement(fd: FormData) {
  await run("customers.write", detail(str(fd, "franchiseId")), "Signed agreement recorded", (actor) => recordAgreement(actor, str(fd, "franchiseId"), str(fd, "signedOn")));
}

export async function setFranchiseStatus(fd: FormData) {
  const next = str(fd, "status") as FranchiseStatus;
  const label: Record<string, string> = { active: "Franchise activated", suspended: "Franchise suspended", terminated: "Franchise terminated. Its areas are free now." };
  await run("modules.manage", detail(str(fd, "franchiseId")), label[next] ?? "Updated", (actor) => setStatus(actor, str(fd, "franchiseId"), next, str(fd, "reason")));
}

export async function publishFranchiseTerms(fd: FormData) {
  await run("modules.manage", "/admin/franchises/?tab=terms", "New Terms version published", (actor) => publishTerms(actor, String(fd.get("body") ?? "")));
}
