import { NextResponse } from "next/server";
import { z } from "zod";
import { apiStaff } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { SERVICES, type ServiceDef, saveService, setServiceOn, testService } from "@/server/integrations/services";

const adapter = z.enum(SERVICES.map((s) => s.adapter) as [ServiceDef["adapter"], ...ServiceDef["adapter"][]]);
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save"), adapter, values: z.record(z.string(), z.string().max(4000)) }),
  z.object({ op: z.literal("test"), adapter }),
  z.object({ op: z.literal("on"), adapter, on: z.boolean() }),
]);

/** Admin → API Keys & Services. Needs integrations.write; keys are encrypted and every change is audited. */
export async function POST(req: Request) {
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const s = await apiStaff("integrations.write");
  if (!s) return apiError(403, "forbidden", "You don't have permission to change API keys");
  const b = p.data;
  const r = b.op === "save" ? await saveService(b.adapter, b.values, s.userId) : b.op === "test" ? await testService(b.adapter, s.userId) : await setServiceOn(b.adapter, b.on, s.userId);
  return r.ok ? NextResponse.json({ ok: true, message: r.message }) : apiError(422, "validation_error", r.message);
}
