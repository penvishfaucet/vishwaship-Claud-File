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
