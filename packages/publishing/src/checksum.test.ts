import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { computeContentChecksum } from "./checksum";

const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

describe("provider content checksum", () => {
  it("hashes the exact UTF-8 provider bytes without JCS object framing", () => {
    const text = "# Customer onboarding\n你好，海外市场\n";
    const bytes = Buffer.from(text, "utf8");
    const artifactJcsIdentity = sha256(
      JSON.stringify({ text }),
    );

    expect(computeContentChecksum(text)).toBe(sha256(bytes));
    expect(computeContentChecksum(bytes)).toBe(sha256(bytes));
    expect(computeContentChecksum(bytes)).not.toBe(artifactJcsIdentity);
  });

  it("keeps byte-level differences observable", () => {
    expect(computeContentChecksum("line one\nline two\n")).not.toBe(
      computeContentChecksum("line one\r\nline two\r\n"),
    );
  });
});
