import { describe, expect, it } from "vitest";
import { CreateAnalysisRefreshRunRequest } from "./analysis-refresh.ts";

describe("CreateAnalysisRefreshRunRequest", () => {
  it("accepts the empty server-owned command object", () => {
    expect(CreateAnalysisRefreshRunRequest.parse({})).toEqual({});
  });

  it("rejects every client-supplied planning field", () => {
    for (const request of [
      { providers: ["crawl"] },
      { siteId: "00000000-0000-4000-8000-000000000001" },
      { steps: [] },
      { force: true },
    ]) {
      expect(CreateAnalysisRefreshRunRequest.safeParse(request).success).toBe(
        false,
      );
    }
  });
});
