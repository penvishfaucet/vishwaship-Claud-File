import { mobileJson, withCustomer } from "@/server/mobile/http";
import { ordersView } from "@/server/mobile/views";

/** Orders list with the website's tabs and filters (?tab=&from=&to=&q=&awb=&ref=&payment=&type=&courier=&page=&size=). */
export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  delete sp.customer; delete sp.exception; // admin-only filters
  return withCustomer(async (s) => mobileJson(await ordersView(s.orgId, sp)));
}
