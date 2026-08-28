import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const config = readFileSync(
  fileURLToPath(new URL("../playwright.config.ts", import.meta.url)),
  "utf8",
);

describe("Marketing Playwright discovery", () => {
  it("runs browser specs without importing Vitest-only fixture tests", () => {
    expect(config).toContain('testMatch: "**/*.spec.ts"');
    expect(config).toContain('testIgnore: "**/*.test.ts"');
    expect(config).not.toContain("agent-envelope.test.ts");
  });
});
