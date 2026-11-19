import "server-only";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * Email provider (server-side only). Production: Resend (https://resend.com) with RESEND_API_KEY.
 * Without a key, development keeps an outbox (nothing leaves the machine) and production reports a clear failure.
 */
export type OutgoingEmail = { from: string; replyTo?: string | null; to: string; subject: string; html: string; text: string };
export type DeliveryResult = { ok: true; providerId: string } | { ok: false; error: string; retryable: boolean };

export const devOutbox: Array<OutgoingEmail & { at: string }> = [];
/** Development only: an address with "+fail" fails on its first send (to check Email Logs + Retry); the retry goes through. */
const devFailed = new Set<string>();

export async function deliver(m: OutgoingEmail): Promise<DeliveryResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    if (process.env.NODE_ENV === "production") return { ok: false, error: "Email provider not configured — set RESEND_API_KEY on the server", retryable: true };
    const k = `${m.to}|${m.subject}`;
    if (/\+fail@/i.test(m.to) && !devFailed.has(k)) { devFailed.add(k); return { ok: false, error: "Development: simulated provider failure for a +fail address", retryable: true }; }
    devOutbox.unshift({ ...m, at: new Date().toISOString() }); devOutbox.splice(50);
    // local `next dev` only: show the email in the terminal so sign-up can be tried without a provider
    if (process.env.NODE_ENV === "development") console.info(`[dev-outbox] to=${m.to} from=${m.from}\nSubject: ${m.subject}\n${m.text}\n[/dev-outbox]`);
    return { ok: true, providerId: `dev-outbox-${Date.now()}` };
  }
  try {
    const r = await safeFetch("https://api.resend.com/emails", {
      method: "POST", allowedHosts: ["api.resend.com"], timeoutMs: 15_000,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (r.ok && j.id) return { ok: true, providerId: j.id };
    return { ok: false, error: `Provider rejected the email (HTTP ${r.status})${j.message ? `: ${j.message}` : ""}`.slice(0, 300), retryable: r.status >= 500 || r.status === 429 };
  } catch (e) {
    return { ok: false, error: `Email provider unreachable: ${(e as Error).message}`.slice(0, 300), retryable: true };
  }
}

/** Provider verification of a sender's domain: verified | pending | failed (Resend GET /domains). */
export async function senderVerification(email: string): Promise<{ status: "verified" | "pending" | "failed"; detail: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!key) {
    // local development has no provider: simulate verification so the admin flow can be exercised; production never does this
    if (process.env.NODE_ENV !== "production") return /\.(test|in)$/.test(domain) ? { status: "verified", detail: `Development: simulated verification of ${domain} (no provider configured)` } : { status: "pending", detail: `Development: ${domain} not verified (only .test / .in domains are simulated)` };
    return { status: "pending", detail: "Email provider not configured on the server (RESEND_API_KEY) — verification cannot be checked yet" };
  }
  try {
    const r = await safeFetch("https://api.resend.com/domains", { allowedHosts: ["api.resend.com"], timeoutMs: 15_000, headers: { authorization: `Bearer ${key}` } });
    const j = (await r.json().catch(() => ({}))) as { data?: Array<{ name: string; status: string }> };
    if (!r.ok) return { status: "pending", detail: `Could not read domains from the provider (HTTP ${r.status})` };
    const d = j.data?.find((x) => x.name.toLowerCase() === domain);
    if (!d) return { status: "pending", detail: `Domain ${domain} is not added at the email provider yet — add it and its DNS records` };
    if (d.status === "verified") return { status: "verified", detail: `Domain ${domain} verified at the provider` };
    return { status: d.status === "failed" ? "failed" : "pending", detail: `Domain ${domain}: ${d.status}` };
  } catch (e) {
    return { status: "pending", detail: `Provider unreachable: ${(e as Error).message}` };
  }
}
