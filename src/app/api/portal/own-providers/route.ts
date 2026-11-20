import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { saveOwn, setOwn, testOwn } from "@/server/own-providers";

const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save"), adapter: z.enum(["wati", "aisensy", "bolna"]), values: z.record(z.string().max(4000)) }),
  z.object({ op: z.literal("test"), kind: z.enum(["whatsapp", "calling"]) }),
  z.object({ op: z.literal("set"), kind: z.enum(["whatsapp", "calling"]), on: z.union([z.boolean(), z.literal("remove")]) }),
]);

/** The client's own WhatsApp / AI calling accounts: save keys, test, switch on/off. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const r = p.data.op === "save" ? await saveOwn(s.orgId, s.userId, p.data.adapter, p.data.values)
    : p.data.op === "test" ? await testOwn(s.orgId, s.userId, p.data.kind)
    : await setOwn(s.orgId, s.userId, p.data.kind, p.data.on);
  return r.ok ? NextResponse.json(r) : apiError(422, "validation_error", r.message);
}
