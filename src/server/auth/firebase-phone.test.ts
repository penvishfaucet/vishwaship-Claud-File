import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as rsaSign } from "node:crypto";

vi.mock("server-only", () => ({}));
vi.mock("@/server/integrations/services", () => ({ activeService: async () => null }));
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
let fetched = 0;
vi.mock("@/server/security/safe-fetch", () => ({
  safeFetch: async (url: string, init: { allowedHosts?: string[] }) => {
    fetched++;
    if (!init.allowedHosts?.includes(new URL(url).hostname)) throw new Error("host not allowed");
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "cache-control": "public, max-age=3600" } });
  },
}));
const { verifyFirebasePhoneToken, PhoneTokenError, _resetKeyCache } = await import("./firebase-phone");

const P = "vishwaship-app";
const now = Date.UTC(2026, 10, 23, 10, 0, 0);
const sec = Math.floor(now / 1000);
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims: Record<string, unknown> = {}, opts: { kid?: string; key?: typeof privateKey; alg?: string } = {}) {
  const h = enc({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
  const c = enc({ aud: P, iss: `https://securetoken.google.com/${P}`, sub: "fb_uid_1", iat: sec - 5, auth_time: sec - 5, exp: sec + 3600, phone_number: "+919876543210", firebase: { sign_in_provider: "phone" }, ...claims });
  return `${h}.${c}.${rsaSign("RSA-SHA256", Buffer.from(`${h}.${c}`), opts.key ?? privateKey).toString("base64url")}`;
}
const bad = (t: string) => expect(verifyFirebasePhoneToken(t, P, now)).rejects.toBeInstanceOf(PhoneTokenError);

describe("Firebase phone token check", () => {
  beforeEach(() => { _resetKeyCache(); fetched = 0; });

  it("accepts a fresh, correctly signed phone token and returns the 10-digit mobile", async () => {
    expect(await verifyFirebasePhoneToken(token(), P, now)).toEqual({ mobile: "9876543210", uid: "fb_uid_1" });
    await verifyFirebasePhoneToken(token(), P, now);
    expect(fetched).toBe(1); // Google keys are cached
  });

  it("refuses forged, foreign, expired, stale, non-phone and non-Indian tokens", async () => {
    await bad(token({}, { key: other.privateKey }));                       // signed by someone else
    await bad(token({}, { kid: "nope" }));                                  // unknown key
    await bad(token({}, { alg: "none" }));                                  // algorithm swap
    await bad(token({ aud: "another-project" }));
    await bad(token({ iss: "https://securetoken.google.com/another-project" }));
    await bad(token({ exp: sec - 1 }));
    await bad(token({ auth_time: sec - 601, iat: sec - 601 }));             // OTP checked over 10 minutes ago
    await bad(token({ firebase: { sign_in_provider: "password" } }));
    await bad(token({ phone_number: "+14155550100" }));
    await bad(token({ phone_number: undefined }));
    await bad(token({ sub: "" }));
    await bad("not.a.token");
    // a tampered payload with the original signature
    const [h, , s] = token().split(".");
    await bad(`${h}.${enc({ aud: P, iss: `https://securetoken.google.com/${P}`, sub: "x", iat: sec, auth_time: sec, exp: sec + 60, phone_number: "+919999999999", firebase: { sign_in_provider: "phone" } })}.${s}`);
  });
});
