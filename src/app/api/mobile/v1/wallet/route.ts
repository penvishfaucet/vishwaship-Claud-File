import { mobileJson, withCustomer } from "@/server/mobile/http";
import { codView, walletView } from "@/server/mobile/views";

/** Wallet & Billing: live balance, passbook (same entries as the web), recharges, available recharge methods. ?cod=1 adds COD remittance. */
export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  return withCustomer(async (s) => mobileJson({ ...(await walletView(s.orgId, sp)), ...(sp.cod === "1" ? { cod: await codView(s.orgId) } : {}) }));
}
