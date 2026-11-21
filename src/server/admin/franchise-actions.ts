"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/server/auth/session";
import type { Permission } from "@/server/auth/rbac";
import { lookupPincode } from "@/server/pincode";
import {
  FranchiseError, addDistrict, addPincode, createFranchise, publishTerms, recordAgreement, recordDeposit, releaseArea, setKycVerified, setStatus,
  settleDeposit, updateFranchise, type FranchiseInputT, type FranchiseStatus,
} from "@/server/franchise/service";
import { disableLogin, issueLoginLink, linkCustomer, unlinkCustomer } from "@/server/franchise/portal";
import { siteBase } from "@/server/franchise/referral";
import {
  adjustPayout, approvePayout, cancelPayout, generatePayouts, markPayoutPaid, saveCommissionSettings, savePayoutConfig, voidCommission,
} from "@/server/franchise/commission";

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

// ---------------- phase 2: login and customers ----------------
/** The set-password link is shown once to the admin (short-lived cookie read by the detail page), never put in a URL. */
const LOGIN_FLASH_COOKIE = "vs_fr_link"; // same name in the franchise detail page

export async function createFranchiseLogin(fd: FormData) {
  const staff = await requireStaff("customers.write");
  const id = str(fd, "franchiseId");
  let msg: string;
  try {
    const { token } = await issueLoginLink(staff.userId, id);
    (await cookies()).set(LOGIN_FLASH_COOKIE, `${id}|${await siteBase()}/franchise/setup-password/?token=${token}`, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/admin/franchises/", maxAge: 300 });
    msg = q("ok", "Set-password link ready. Share it with the franchise owner privately (valid 72 hours, works once).");
  } catch (e) {
    if (!(e instanceof FranchiseError)) throw e;
    msg = q("err", e.message);
  }
  redirect(`${detail(id)}?${msg}`);
}

export async function disableFranchiseLogin(fd: FormData) {
  await run("customers.write", detail(str(fd, "franchiseId")), "Login turned off", (actor) => disableLogin(actor, str(fd, "franchiseId")));
}

export async function linkFranchiseCustomer(fd: FormData) {
  await run("customers.write", detail(str(fd, "franchiseId")), "Customer linked", (actor) => linkCustomer(actor, str(fd, "franchiseId"), str(fd, "identifier")));
}

export async function unlinkFranchiseCustomer(fd: FormData) {
  await run("customers.write", detail(str(fd, "franchiseId")), "Customer removed from this franchise", (actor) => unlinkCustomer(actor, str(fd, "franchiseId"), str(fd, "orgId")));
}

// ---------------- phase 3: commission and payouts ----------------
const PAYOUTS = "/admin/franchises/?tab=payouts";

export async function saveFranchiseCommission(fd: FormData) {
  const id = str(fd, "franchiseId");
  await run("pricing.write", detail(id), "Commission settings saved", (actor) => saveCommissionSettings(actor, id, {
    basePct: str(fd, "basePct"), minPct: str(fd, "minPct"), maxPct: str(fd, "maxPct"), defaultPct: str(fd, "defaultPct"),
    accountName: str(fd, "accountName"), accountLast4: str(fd, "accountLast4"), ifsc: str(fd, "ifsc"),
  }));
}

export async function voidFranchiseCommission(fd: FormData) {
  await run("finance.adjust", detail(str(fd, "franchiseId")), "Commission line removed", (actor) => voidCommission(actor, str(fd, "commissionId"), str(fd, "reason")));
}

export async function saveFranchisePayoutSettings(fd: FormData) {
  await run("finance.adjust", PAYOUTS, "Payout settings saved", (actor) => savePayoutConfig(actor, Number(str(fd, "tdsPct"))));
}

export async function generateFranchisePayouts(fd: FormData) {
  const period = str(fd, "period");
  let made = 0;
  await run("finance.adjust", `${PAYOUTS}&period=${encodeURIComponent(period)}`, "Statements prepared", async (actor) => { made = await generatePayouts(actor, period); if (!made) throw new FranchiseError("No unpaid commission for this month (or statements already exist)"); });
}

export async function adjustFranchisePayout(fd: FormData) {
  await run("finance.adjust", PAYOUTS, "Adjustment saved", (actor) => adjustPayout(actor, str(fd, "payoutId"), Number(str(fd, "rupees") || "0"), str(fd, "note")));
}

export async function approveFranchisePayout(fd: FormData) {
  await run("finance.adjust", PAYOUTS, "Statement approved", (actor) => approvePayout(actor, str(fd, "payoutId")));
}

export async function payFranchisePayout(fd: FormData) {
  await run("finance.adjust", PAYOUTS, "Marked paid", (actor) => markPayoutPaid(actor, str(fd, "payoutId"), str(fd, "utr"), str(fd, "paidOn")));
}

export async function cancelFranchisePayout(fd: FormData) {
  await run("finance.adjust", PAYOUTS, "Statement cancelled; its commission goes into the next statement", (actor) => cancelPayout(actor, str(fd, "payoutId"), str(fd, "reason")));
}
