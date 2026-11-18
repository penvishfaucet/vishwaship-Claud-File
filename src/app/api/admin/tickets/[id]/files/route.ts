import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { serveAttachment } from "@/server/support/http";

/** Ticket attachment for support staff with tickets.read. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("tickets.read");
  if (!s) return apiError(403, "forbidden", "Not allowed");
  const { id } = await params;
  return serveAttachment(id, new URL(req.url));
}
