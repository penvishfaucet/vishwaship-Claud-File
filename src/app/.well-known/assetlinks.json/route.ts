/**
 * Android App Links verification. ANDROID_CERT_SHA256 = comma-separated SHA-256 fingerprints of the Play App
 * Signing key (Play Console → App integrity) and, for staging builds, the upload/debug key. Empty = no links verified.
 */
export function GET() {
  const prints = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  const pkg = process.env.ANDROID_PACKAGE ?? "in.vishwaship.app";
  const body = prints.length ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } }] : [];
  return Response.json(body, { headers: { "cache-control": "public, max-age=3600" } });
}
