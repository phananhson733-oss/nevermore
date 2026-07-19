import { describe, expect, it } from "vitest";
import { contentHash } from "@sf/db";

import { artifactContentHash } from "./run-artifact.ts";

describe("worker artifact content hash", () => {
  it("matches the canonical hash used by the web editor for markdown", () => {
    expect(artifactContentHash("same body")).toBe(
      contentHash({ text: "same body" }),
    );
  });

  it("is stable across JSON key order", () => {
    expect(artifactContentHash({ b: 2, a: 1 })).toBe(
      artifactContentHash({ a: 1, b: 2 }),
    );
  });
});
