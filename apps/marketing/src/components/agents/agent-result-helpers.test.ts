// @input  -- synthetic audit records and coverage counters
// @output -- regression coverage for reach ordering and evaluated/unverified math
// @pos    -- pure unit guard for Agent result semantics

import { describe, expect, it } from "vitest";
import type { SeoAuditCoverage, SeoAuditRecord } from "@sf/public-tools";

import {
  notCollectedUrlCount,
  summarizeAgentRecords,
  topObservedOpportunities,
} from "./agent-result-helpers";

function record(
  id: string,
  affected: number,
  state: SeoAuditRecord["state"] = "observed",
  unit: SeoAuditRecord["unit"] = "pages",
): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state,
    unit,
    tested: 12,
    affected,
    observations: [],
    limitation: null,
  };
}

describe("Agent opportunity selection", () => {
  it("keeps only observed issue conditions and takes the top three by reach", () => {
    const selected = topObservedOpportunities([
      record("small", 1),
      record("resource", 99, "observed", "site_resource"),
      record("not-observed", 80, "not_observed"),
      record("unverified", 50, "unverified"),
      record("large", 9),
      record("zero", 0),
      record("medium", 4),
      record("fourth", 2),
    ]);

    expect(selected.map((entry) => entry.id)).toEqual([
      "large",
      "medium",
      "fourth",
    ]);
  });

  it("uses source order as the deterministic tie-breaker", () => {
    expect(
      topObservedOpportunities([
        record("first", 3),
        record("second", 3),
      ]).map((entry) => entry.id),
    ).toEqual(["first", "second"]);
  });
});

describe("Agent evidence summaries", () => {
  it("keeps evaluated and unverified checks separate", () => {
    expect(
      summarizeAgentRecords([
        record("observed", 2),
        record("clear", 0, "not_observed"),
        record("unknown", 0, "unverified"),
      ]),
    ).toEqual({
      total: 3,
      evaluated: 2,
      unverified: 1,
      observed: 1,
      notObserved: 1,
    });
  });

  it("adds only explicit not-collected URL counters", () => {
    const coverage: SeoAuditCoverage = {
      availability: "partial",
      pagesInspected: 4,
      linksObserved: 12,
      sitemapUrlsObserved: 9,
      urlsSkipped: 2,
      urlsBlocked: 3,
      urlsDisallowed: 5,
      urlsErrored: 7,
      stopReason: "budget",
    };
    expect(notCollectedUrlCount(coverage)).toBe(17);
  });

  it("keeps not-collected URL reach unavailable when coverage is unavailable", () => {
    const coverage: SeoAuditCoverage = {
      availability: "unavailable",
      pagesInspected: 0,
      linksObserved: 0,
      sitemapUrlsObserved: 0,
      urlsSkipped: 0,
      urlsBlocked: 0,
      urlsDisallowed: 0,
      urlsErrored: 0,
      stopReason: "crawl_failed",
    };

    expect(notCollectedUrlCount(coverage)).toBeNull();
  });
});
