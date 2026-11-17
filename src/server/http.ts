import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";

export type ApiErrorCode =
  | "validation_error" | "unauthorized" | "forbidden" | "not_found" | "rate_limited"
  | "conflict" | "insufficient_balance" | "quote_expired" | "provider_error" | "internal_error";

export function apiError(status: number, code: ApiErrorCode, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export async function parseJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<{ ok: true; data: z.output<S> } | { ok: false; res: NextResponse }> {
  let body: unknown;
  try { body = await req.json(); } catch { return { ok: false, res: apiError(400, "validation_error", "Body must be JSON") }; }
  try { return { ok: true, data: schema.parse(body) }; }
  catch (e) {
    const issues = e instanceof ZodError ? e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) : [];
    const first = issues[0] ? `${issues[0].message}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ""}` : "Invalid request";
    return { ok: false, res: apiError(422, "validation_error", first, { issues }) };
  }
}
