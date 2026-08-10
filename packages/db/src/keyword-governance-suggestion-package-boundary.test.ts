import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ConditionalExport = {
  readonly types?: unknown;
  readonly browser?: unknown;
  readonly default?: unknown;
};

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  readonly exports?: Readonly<Record<string, string | ConditionalExport>>;
};

describe("Keyword governance suggestion package boundaries", () => {
  it.each([
    [
      "./keyword-governance-suggestion-scheduler",
      "./src/keyword-governance-suggestion-scheduler.ts",
    ],
    [
      "./keyword-governance-suggestion-freezer",
      "./src/keyword-governance-suggestion-freezer.ts",
    ],
  ])("publishes %s as an explicitly server-only typed subpath", (subpath, target) => {
    expect(packageJson.exports?.[subpath]).toEqual({
      types: target,
      browser: null,
      default: target,
    });
  });
});
