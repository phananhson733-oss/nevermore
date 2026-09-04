// @input  -- ledgers and shortlists covering the inspected and uninspected target
// @output -- proof every key page is judged, each on records that may speak for it
// @pos    -- unit guard for which pages a run judges

import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";

import { evaluateAgentKeyPages } from "./agent-key-page-evaluation.ts";
import type { AgentKeyPage } from "./agent-key-pages.ts";

const TARGET = "https://example.com/";
const OTHER = "https://example.com/pricing";

function keyPage(url: string, basis: AgentKeyPage["basis"]): AgentKeyPage {
  return {
    url,
    title: null,
    metaDescription: null,
    depth: 1,
    inboundLinks: 1,
    reason:
      basis === "homepage"
        ? "home"
        : basis === "target"
          ? "target"
          : "navigation",
    basis,
    matchedFeature: null,
  };
}

function record(overrides: Partial<SeoAuditRecord>): SeoAuditRecord {
  return {
    id: "title_length_outside_range",
    category: "metadata",
    state: "not_observed",
    unit: "pages",
    population: "conditional_subset",
    targetTested: true,
    tested: 4,
    affected: 0,
    observations: [],
    limitation: null,
    ...overrides,
  } as unknown as SeoAuditRecord;
}

function resultFor(
  evaluations: ReturnType<typeof evaluateAgentKeyPages>,
  url: string,
  checkId: string,
) {
  return evaluations
    .find((entry) => entry.page.url === url)
    ?.evaluation.checks.find((entry) => entry.check.id === checkId)?.result;
}

function evidenceOf(
  evaluations: ReturnType<typeof evaluateAgentKeyPages>,
  url: string,
  checkId: string,
) {
  return evaluations
    .find((entry) => entry.page.url === url)
    ?.evaluation.checks.find((entry) => entry.check.id === checkId)
    ?.evidenceRecordIds;
}

describe("evaluateAgentKeyPages", () => {
  it("judges every selected key page", () => {
    const evaluations = evaluateAgentKeyPages({
      records: [record({})],
      availability: "available",
      keyPages: [keyPage(TARGET, "target"), keyPage(OTHER, "structure")],
      targetUrl: TARGET,
      targetInspected: true,
      inspectedTargetUrl: TARGET,
    });

    expect(evaluations.map((entry) => entry.page.url)).toEqual([
      TARGET,
      OTHER,
    ]);
  });

  it("keeps the submitted page's own verdict while fail-closing the rest", () => {
    // Same record, same run: the target may read its membership flag, the
    // other key page may not.
    const evaluations = evaluateAgentKeyPages({
      records: [record({ targetTested: true })],
      availability: "available",
      keyPages: [keyPage(TARGET, "target"), keyPage(OTHER, "structure")],
      targetUrl: TARGET,
      targetInspected: true,
      inspectedTargetUrl: TARGET,
    });

    expect(resultFor(evaluations, TARGET, "2.1")).toBe("pass");
    expect(resultFor(evaluations, OTHER, "2.1")).toBe("excluded");
  });

  it("still judges the submitted page when the crawl never collected it", () => {
    // A target that redirected away or errored is not a candidate, so it has
    // no row on the shortlist. The regions derived and paid for against that
    // URL still have to reach a verdict.
    const evaluations = evaluateAgentKeyPages({
      records: [
        record({
          id: "core_web_vital_lcp",
          population: "target_page",
          state: "observed",
          affected: 1,
          targetTested: null,
          observations: [{ url: TARGET, values: [] }],
        } as Partial<SeoAuditRecord>),
      ],
      availability: "available",
      keyPages: [keyPage(OTHER, "structure")],
      targetUrl: TARGET,
      targetInspected: false,
      inspectedTargetUrl: null,
    });

    expect(evaluations.map((entry) => entry.page.url)).toEqual([
      TARGET,
      OTHER,
    ]);
    expect(evaluations[0]?.page.basis).toBe("target");
    // The paid region reaches the target's row and only the target's row. It
    // is what makes the extra entry worth having: dropped with the page, the
    // run's most expensive evidence would go with it.
    expect(evidenceOf(evaluations, TARGET, "8.1")).toEqual([
      "core_web_vital_lcp",
    ]);
    expect(evidenceOf(evaluations, OTHER, "8.1")).toEqual([]);
  });

  it("does not list the target twice when it is already on the shortlist", () => {
    const evaluations = evaluateAgentKeyPages({
      records: [record({})],
      availability: "available",
      keyPages: [keyPage(TARGET, "homepage"), keyPage(OTHER, "structure")],
      targetUrl: TARGET,
      targetInspected: true,
      inspectedTargetUrl: TARGET,
    });

    expect(
      evaluations.filter((entry) => entry.page.url === TARGET),
    ).toHaveLength(1);
    // Its own basis survives: it is the home page that happens to be submitted.
    expect(evaluations[0]?.page.basis).toBe("homepage");
  });

  it("judges only the target when the run published no shortlist", () => {
    const evaluations = evaluateAgentKeyPages({
      records: [record({})],
      availability: "available",
      keyPages: [],
      targetUrl: TARGET,
      targetInspected: true,
      inspectedTargetUrl: TARGET,
    });

    expect(evaluations.map((entry) => entry.page.url)).toEqual([TARGET]);
    expect(resultFor(evaluations, TARGET, "2.1")).toBe("pass");
  });
});
