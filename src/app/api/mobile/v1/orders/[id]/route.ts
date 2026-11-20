import { apiError } from "@/server/http";
import { mobileJson, withCustomer } from "@/server/mobile/http";
import { orderDetail } from "@/server/mobile/views";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withCustomer(async (s) => {
    const d = await orderDetail(s.orgId, id);
    return d ? mobileJson(d) : apiError(404, "not_found", "Order not found");
  });
}
