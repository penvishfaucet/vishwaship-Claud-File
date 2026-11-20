import { mobileJson, withCustomer } from "@/server/mobile/http";
import { homeView } from "@/server/mobile/views";

/** Dashboard: the Orders tab counts for the range (the same numbers as the web tiles) and the latest shipments. */
export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  return withCustomer(async (s) => mobileJson(await homeView(s.orgId, sp)));
}
