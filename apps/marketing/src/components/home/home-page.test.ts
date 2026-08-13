// @input  -- homepage assembly source
// @output -- homepage Agent-first ordering and embedded-audit removal regression
// @pos    -- guards the marketing homepage information architecture

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOME_PAGE_SOURCE = fileURLToPath(
  new URL("./home-page.tsx", import.meta.url),
);

describe("homepage assembly", () => {
  it("puts the two-Agent preview immediately after the hero", () => {
    const source = readFileSync(HOME_PAGE_SOURCE, "utf8");
    const assembly = source.slice(source.indexOf("return ("));
    expect(assembly.indexOf("<HeroSection />")).toBeGreaterThanOrEqual(0);
    expect(assembly.indexOf("<CapabilitiesPreview />")).toBeGreaterThan(
      assembly.indexOf("<HeroSection />"),
    );
    expect(assembly.indexOf("<CapabilitiesPreview />")).toBeLessThan(
      assembly.indexOf("<PainPointsSection />"),
    );
  });

  it("does not embed the legacy free audit runner", () => {
    const source = readFileSync(HOME_PAGE_SOURCE, "utf8");
    expect(source).not.toContain("FreeAuditSection");
  });
});
