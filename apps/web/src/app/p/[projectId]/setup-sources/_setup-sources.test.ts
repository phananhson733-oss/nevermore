import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("optional source setup UI", () => {
  const source = readFileSync(
    new URL("./_setup-sources.tsx", import.meta.url),
    "utf8",
  );

  it("offers both Google providers and an explicit skip path", () => {
    expect(source).toContain('const PROVIDERS = ["gsc", "ga4"]');
    expect(source).toContain('t("actions.skip")');
    expect(source).toContain("productProfilePath(projectId)");
  });

  it("requests the exact onboarding return path and does not ask for GA4 event selection", () => {
    expect(source).toContain("returnPath: setupSourcesPath(projectId)");
    expect(source).not.toContain("keyEventNames");
    expect(source).toContain('phase: "select_property"');
  });

  it("states the read-only privacy boundary", () => {
    expect(source).toContain('t("privacy.readOnly")');
    expect(source).toContain('t("privacy.detail")');
  });
});
