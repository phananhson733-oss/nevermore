import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./_overview.tsx", import.meta.url),
  "utf8",
);

describe("Overview content-decay alert surface", () => {
  it("reuses the existing priority queue and deep-links the exact Growth Map URL", () => {
    expect(SOURCE).toContain("function ContentDecayAlertRow");
    expect(SOURCE).toContain('data-content-decay-alert=""');
    expect(SOURCE).toContain(
      "overviewGrowthMapHref(projectId, alert.sitePageId)",
    );
    expect(SOURCE).toContain("<ContentDecayAlertRow");
    expect(SOURCE).not.toContain("/health");
  });

  it("keeps the warning customer-readable without pretending an Action was created", () => {
    expect(SOURCE).toContain('t("priority.decay.reviewSuggested")');
    expect(SOURCE).toContain('t("priority.decay.openLabel"');
    expect(SOURCE).toContain("alert.rankTrend");
    expect(SOURCE).toContain("alert.trafficTrend");
    expect(SOURCE).not.toContain("createDecayAction");
  });
});
