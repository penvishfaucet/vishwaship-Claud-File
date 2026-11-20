import { mobileJson, withCustomer } from "@/server/mobile/http";
import { meView } from "@/server/mobile/views";

export async function GET() {
  return withCustomer(async (s) => mobileJson(await meView(s.userId, s.orgId)));
}
