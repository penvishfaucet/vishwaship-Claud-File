import { mobileJson, withCustomer } from "@/server/mobile/http";
import { kycView } from "@/server/mobile/views";

/** KYC status per document (upload with multipart POST /api/portal/kyc, the same rules as the website). */
export async function GET() {
  return withCustomer(async (s) => mobileJson(await kycView(s.orgId)));
}
