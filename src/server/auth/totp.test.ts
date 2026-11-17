import { describe, expect, it } from "vitest";
import { base32Encode, totp, verifyTotp } from "./totp";

describe("totp", () => {
  // RFC 6238 test vector: secret "12345678901234567890", T=59s -> 94287082 (8 digits) -> last 6 = 287082
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 6238 SHA-1 vector", () => {
    expect(totp(secret, 59_000)).toBe("287082");
  });
  it("accepts ±1 step and rejects others", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 120_000), now)).toBe(false);
  });
});
