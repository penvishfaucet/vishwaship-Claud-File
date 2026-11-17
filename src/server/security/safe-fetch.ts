import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, FormData as UFormData, fetch as undiciFetch } from "undici";

/**
 * Outbound HTTP for provider connectors and customer webhooks.
 * - https only (http allowed only for explicit dev hosts)
 * - optional host allowlist per provider account
 * - resolves DNS once, rejects loopback/private/link-local/CGNAT/metadata/multicast addresses,
 *   then pins the connection to the vetted IP (defeats DNS rebinding)
 * - redirects are not followed
 * - hard timeout
 */
export class BlockedUrlError extends Error {}

function ipv4Blocked(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function ipv6Blocked(ip: string) {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("::ffff:")) return ipv4Blocked(s.slice(7));
  return s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb") || s.startsWith("ff");
}
export function isBlockedIp(ip: string) {
  return isIP(ip) === 4 ? ipv4Blocked(ip) : isIP(ip) === 6 ? ipv6Blocked(ip) : true;
}

export async function vetUrl(raw: string, allowedHosts: string[] = []): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BlockedUrlError("Invalid URL"); }
  if (url.protocol !== "https:") throw new BlockedUrlError("Only https URLs are allowed");
  if (url.username || url.password) throw new BlockedUrlError("Credentials in URL are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (allowedHosts.length && !allowedHosts.some((h) => host === h || host.endsWith("." + h))) {
    throw new BlockedUrlError(`Host ${host} is not in this account's allowed hosts`);
  }
  if (/^(localhost|metadata\.google\.internal)$/i.test(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new BlockedUrlError("Internal hostnames are not allowed");
  }
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) as 4 | 6 }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new BlockedUrlError("Destination resolves to a blocked address");
  return { url, address: addrs[0].address, family: addrs[0].family as 4 | 6 };
}

export async function safeFetch(raw: string, init: RequestInit & { timeoutMs?: number; allowedHosts?: string[] } = {}) {
  const { url, address, family } = await vetUrl(raw, init.allowedHosts);
  const dispatcher = new Agent({
    connect: {
      // pin the connection to the vetted address (no DNS rebinding); Node may ask for all addresses
      lookup: ((_h: string, o: { all?: boolean } | undefined, cb: (err: Error | null, addr: unknown, fam?: number) => void) =>
        (o && o.all ? cb(null, [{ address, family }]) : cb(null, address, family))) as never,
    },
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);
  // Use undici's own fetch with its own Agent: Node's built-in fetch bundles a different undici version and
  // rejects a dispatcher from the npm package ("invalid onError method").
  let body = init.body as unknown;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const fd = new UFormData();
    for (const [k, v] of body.entries()) fd.append(k, v as string);
    body = fd;
  }
  try {
    const { timeoutMs: _t, allowedHosts: _a, ...rest } = init; void _t; void _a;
    return (await undiciFetch(url, { ...(rest as object), body: body as never, redirect: "manual", signal: ctrl.signal, dispatcher })) as unknown as Response;
  } finally {
    clearTimeout(t);
  }
}
