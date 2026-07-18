import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_CIPHER_VERSION, decryptCredential, encryptCredential } from "./crypto.ts";

const key = randomBytes(32);

describe("credential crypto (AES-256-GCM, spec §14.3)", () => {
  it("round-trips a string credential", () => {
    const blob = encryptCredential("super-secret-oauth-token", key);
    expect(decryptCredential(blob, key).toString("utf8")).toBe("super-secret-oauth-token");
  });

  it("round-trips a binary Buffer credential", () => {
    const secret = randomBytes(64);
    const blob = encryptCredential(secret, key);
    expect(decryptCredential(blob, key).equals(secret)).toBe(true);
  });

  it("stamps the current version byte and a fresh IV per call", () => {
    const a = encryptCredential("same-plaintext", key);
    const b = encryptCredential("same-plaintext", key);
    expect(a.readUInt8(0)).toBe(CREDENTIAL_CIPHER_VERSION);
    expect(b.readUInt8(0)).toBe(CREDENTIAL_CIPHER_VERSION);
    // Random IV per call => same plaintext encrypts to different blobs.
    expect(a.equals(b)).toBe(false);
  });

  it("detects tampering (a single flipped byte fails auth)", () => {
    const blob = encryptCredential("payload-to-protect", key);
    const tampered = Buffer.from(blob);
    const last = tampered.length - 1;
    tampered[last] = tampered[last]! ^ 0x01;
    expect(() => decryptCredential(tampered, key)).toThrow();
  });

  it("rejects decryption with the wrong key", () => {
    const blob = encryptCredential("payload-to-protect", key);
    expect(() => decryptCredential(blob, randomBytes(32))).toThrow();
  });

  it("rejects an unsupported cipher version", () => {
    const blob = encryptCredential("payload-to-protect", key);
    const bad = Buffer.from(blob);
    bad[0] = 0x02;
    expect(() => decryptCredential(bad, key)).toThrow(/version/);
  });

  it("rejects a truncated blob", () => {
    const blob = encryptCredential("payload-to-protect", key);
    expect(() => decryptCredential(blob.subarray(0, 10), key)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptCredential("payload", randomBytes(16))).toThrow(/32 bytes/);
    const blob = encryptCredential("payload", key);
    expect(() => decryptCredential(blob, randomBytes(31))).toThrow(/32 bytes/);
  });
});
