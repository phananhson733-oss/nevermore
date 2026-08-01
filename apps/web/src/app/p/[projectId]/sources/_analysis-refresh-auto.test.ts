import { describe, expect, it } from "vitest";
import {
  automaticAnalysisRefreshUrl,
  hasAutomaticAnalysisRefreshIntent,
  withoutAutomaticAnalysisRefreshIntent,
} from "./_analysis-refresh-auto.ts";

describe("automatic Analysis Refresh intent", () => {
  it("adds a one-time intent to the post-confirmation sources destination", () => {
    expect(
      automaticAnalysisRefreshUrl("10000000-0000-4000-8000-000000000001"),
    ).toBe(
      "/p/10000000-0000-4000-8000-000000000001/sources?autoRefresh=1",
    );
  });

  it("accepts only the exact automatic refresh intent", () => {
    expect(hasAutomaticAnalysisRefreshIntent("?autoRefresh=1")).toBe(true);
    expect(hasAutomaticAnalysisRefreshIntent("?autoRefresh=true")).toBe(false);
    expect(hasAutomaticAnalysisRefreshIntent("?autoRefresh=0")).toBe(false);
    expect(hasAutomaticAnalysisRefreshIntent("")).toBe(false);
  });

  it("consumes only its own query parameter and preserves other URL state", () => {
    expect(
      withoutAutomaticAnalysisRefreshIntent(
        "https://app.gengrowth.ai/p/project/sources?provider=ga4&autoRefresh=1#history",
      ),
    ).toBe("/p/project/sources?provider=ga4#history");
  });
});
