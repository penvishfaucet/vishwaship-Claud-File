/**
 * The site's public address for redirects. Behind the host's proxy a request's own URL is the internal listener
 * (https://0.0.0.0:3000), so a redirect built from req.url sends visitors nowhere. APP_URL wins; production falls back
 * to the live domain; only local development uses the address the request came in on.
 */
export function publicOrigin(req: Request): string {
  const env = process.env.APP_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") return "https://vishwaship.in";
  return new URL(req.url).origin;
}

/** Our own domains. The site answers on all of them; APP_URL names the main one. */
const OWN_HOSTS = new Set(["vishwaship.com", "www.vishwaship.com", "vishwaship.in", "www.vishwaship.in"]);

/**
 * Sign-in flows that keep a cookie between "start" and the provider's callback (Google) must start on the same
 * domain the callback returns to, which is APP_URL. When the visitor opened the site on another of our domains
 * (e.g. vishwaship.in while APP_URL is https://vishwaship.com), this returns the same path on the main domain to
 * redirect to first; otherwise null. Hosts that are not ours (the proxy's internal address) never trigger it.
 */
export function mainDomainUrl(req: Request): URL | null {
  const env = process.env.APP_URL?.trim();
  if (!env) return null;
  let main: URL;
  try { main = new URL(env); } catch { return null; }
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (!OWN_HOSTS.has(host) || host === main.hostname.toLowerCase()) return null;
  const u = new URL(req.url);
  return new URL(u.pathname + u.search, main.origin);
}
