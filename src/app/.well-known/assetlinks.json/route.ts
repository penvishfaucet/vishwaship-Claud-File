/**
 * Android App Links / Trusted Web Activity verification: lets the Vishwaship app show this website full screen
 * (no URL bar) and open vishwaship.in links. ANDROID_CERT_SHA256 = comma-separated SHA-256 certificate
 * fingerprints to trust; when unset, the fingerprint of the key that signs the APK on /download-app/ is used.
 * When the app is on Google Play, add the Play App Signing fingerprint (Play Console → App integrity) as well.
 * Fingerprints are public values (anyone can read them from the APK), not secrets.
 */
const DEFAULT_PRINTS = [
  // Vishwaship upload key (CN=Vishwaship), signs the directly downloaded APK.
  "A2:26:26:A4:35:7C:58:61:D2:FA:D0:9F:C4:77:19:AA:7C:EA:2F:29:E1:EE:2F:8B:4D:D1:C1:D0:21:39:31:F8",
];
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function GET() {
  const fromEnv = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => FINGERPRINT.test(s));
  const prints = [...new Set([...fromEnv, ...DEFAULT_PRINTS])];
  const pkg = process.env.ANDROID_PACKAGE ?? "in.vishwaship.app";
  const body = [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } }];
  return Response.json(body, { headers: { "cache-control": "public, max-age=300" } });
}
