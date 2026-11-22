import { NextResponse } from "next/server";
import { handleReceivedWebhook, inboundSecret, verifyWebhookSignature } from "@/server/weight/inbound-mail";

/**
 * Resend "email.received" webhook: courier weight-discrepancy mails forwarded to the Resend receiving address.
 * The signature is checked on the RAW body with the signing secret saved in Admin → API Keys & Services → Resend.
 */
export async function POST(req: Request) {
  const secret = await inboundSecret();
  if (!secret) return NextResponse.json({ error: "Courier mail reading is not set up" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  const ok = verifyWebhookSignature(raw, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, secret);
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  const r = await handleReceivedWebhook(raw);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
