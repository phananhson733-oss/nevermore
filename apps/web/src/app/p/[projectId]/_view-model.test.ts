import { describe, expect, it } from "vitest";
import {
  evidenceForFinding,
  reportFooterLimitations,
  sourceLimitationForDisplay,
  uniqueStrings,
} from "./_view-model.ts";

describe("project screen view models", () => {
  it("uses the captured snapshot limitation after a crawl snapshot exists", () => {
    expect(
      sourceLimitationForDisplay({
        limitation:
          "Static HTML crawl of public pages; no snapshot has been collected yet.",
        latestSnapshot: {
          limitation: "Static HTML only; JavaScript-rendered content may be absent.",
        },
      }),
    ).toBe("Static HTML only; JavaScript-rendered content may be absent.");
  });

  it("falls back to the connection limitation before any snapshot exists", () => {
    expect(
      sourceLimitationForDisplay({
        limitation: "No snapshot has been collected yet.",
        latestSnapshot: null,
      }),
    ).toBe("No snapshot has been collected yet.");
  });

  it("deduplicates evidence by id inside one finding while preserving order", () => {
    const first = { id: "ev-1", claim: "First canonical claim" };
    const duplicate = { id: "ev-1", claim: "Duplicate projection row" };
    const second = { id: "ev-2", claim: "Second canonical claim" };

    expect(evidenceForFinding([first, duplicate, second])).toEqual([
      first,
      second,
    ]);
  });

  it("does not remove equal evidence ids across separate findings", () => {
    const shared = { id: "ev-shared", claim: "Supports both findings" };

    expect(evidenceForFinding([shared])).toEqual([shared]);
    expect(evidenceForFinding([shared])).toEqual([shared]);
  });

  it("does not repeat coverage limitations in the report footer", () => {
    const coverage = ["GSC unavailable", "GA4 unavailable"];

    expect(reportFooterLimitations(coverage, [...coverage])).toEqual([]);
  });

  it("deduplicates exact strings inside one semantic section", () => {
    expect(uniqueStrings(["GSC unavailable", "GSC unavailable", "GA4 unavailable"])).toEqual([
      "GSC unavailable",
      "GA4 unavailable",
    ]);
  });

  it("keeps distinct methodology limitations and removes only exact repeats", () => {
    expect(
      reportFooterLimitations(
        ["GSC unavailable"],
        [
          "GSC unavailable",
          "The analysis excludes authenticated pages.",
          "The analysis excludes authenticated pages.",
        ],
      ),
    ).toEqual(["The analysis excludes authenticated pages."]);
  });
});
