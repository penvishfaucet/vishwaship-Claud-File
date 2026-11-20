import "server-only";
import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";

/** Every /api/mobile/v1 response: never cached by intermediaries, never indexed. */
export function mobileJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

type Customer = NonNullable<Awaited<ReturnType<typeof apiCustomer>>>;
/** Run a handler for the signed-in customer (bearer token or cookie); tenant is always the session's org. */
export async function withCustomer(fn: (s: Customer) => Promise<Response>) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Your session has ended. Please sign in again.");
  return fn(s);
}
