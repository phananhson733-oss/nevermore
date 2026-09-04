// @input  -- per-page evaluations covering every branch of the precedence table
// @output -- proof the merged row states the worst outcome and its real reach
// @pos    -- unit guard for multi-page aggregation

import { describe, expect, it } from "vitest";
import type {
  AgentAuditEvaluatedCheck,
  AgentAuditEvaluation,
} from "@sf/public-tools/agent-audit";

import { aggregateKeyPageEvaluations } from "./agent-key-page-aggregate.ts";
import type { AgentKeyPage } from "./agent-key-pages.ts";

function page(url: string): AgentKeyPage {
  return {
    url,
    title: null,
    metaDescription: null,
    depth: 1,
    inboundLinks: 1,
    reason: "navigation",
    basis: "structure",
    matchedFeature: null,
  };
}

function check(
  id: string,
  result: string,
  truth = "observed",
): AgentAuditEvaluatedCheck {
  return {
    check: { id, scope: "page" },
    result,
    engine: "ready",
    truth,
    measurement: { en: `${id} on a page`, zh: "测量" },
    evidenceRecordIds: [],
    scoreValue: null,
    scoreContribution: null,
  } as unknown as AgentAuditEvaluatedCheck;
}

function evaluation(checks: readonly AgentAuditEvaluatedCheck[]) {
  return { checks } as unknown as AgentAuditEvaluation;
}

const SITE = evaluation([check("D1", "warning")]);

function aggregate(
  perPage: readonly (readonly [string, AgentAuditEvaluatedCheck])[],
) {
  return aggregateKeyPageEvaluations({
    site: SITE,
    pages: perPage.map(([url, entry]) => ({
      page: page(url),
      evaluation: evaluation([entry]),
    })),
  });
}

function resultOf(
  result: ReturnType<typeof aggregateKeyPageEvaluations>,
  id: string,
) {
  return result.checks.find((entry) => entry.check.id === id);
}

describe("aggregateKeyPageEvaluations", () => {
  it("passes site-wide checks through untouched", () => {
    const result = aggregate([["https://a/", check("2.1", "pass")]]);

    expect(resultOf(result, "D1")?.result).toBe("warning");
    // A site-wide check has no per-page reach to state.
    expect(result.reach.has("D1")).toBe(false);
  });

  it("says the worst outcome any key page reached", () => {
    const result = aggregate([
      ["https://a/", check("2.1", "pass")],
      ["https://b/", check("2.1", "blocker")],
      ["https://c/", check("2.1", "tip")],
    ]);

    expect(resultOf(result, "2.1")?.result).toBe("blocker");
  });

  it("prefers a warning over a tip, and a tip over a pass", () => {
    expect(
      resultOf(
        aggregate([
          ["https://a/", check("2.1", "pass")],
          ["https://b/", check("2.1", "tip")],
          ["https://c/", check("2.1", "warning")],
        ]),
        "2.1",
      )?.result,
    ).toBe("warning");

    expect(
      resultOf(
        aggregate([
          ["https://a/", check("2.1", "pass")],
          ["https://b/", check("2.1", "tip")],
        ]),
        "2.1",
      )?.result,
    ).toBe("tip");
  });

  it("still passes when the only other pages could not be judged", () => {
    // The common shape once a non-target key page loses its borrowed
    // membership: one real pass, the rest excluded.
    const result = aggregate([
      ["https://a/", check("2.1", "pass")],
      ["https://b/", check("2.1", "excluded")],
    ]);

    expect(resultOf(result, "2.1")?.result).toBe("pass");
    expect(result.reach.get("2.1")?.keyPageEvaluatedCount).toBe(1);
    expect(result.reach.get("2.1")?.keyPageTotal).toBe(2);
  });

  it("stays excluded when no page could be judged", () => {
    const result = aggregate([
      ["https://a/", check("2.1", "excluded", "source-gated")],
      ["https://b/", check("2.1", "excluded", "unavailable")],
    ]);

    expect(resultOf(result, "2.1")?.result).toBe("excluded");
    expect(resultOf(result, "2.1")?.truth).toBe("source-gated");
    expect(result.reach.get("2.1")?.keyPageEvaluatedCount).toBe(0);
  });

  it("keeps an unrankable result so the issue model can quarantine it", () => {
    // Merging it into a known state would let a build that cannot read the
    // state publish a verdict anyway.
    const result = aggregate([
      ["https://a/", check("2.1", "pass")],
      ["https://b/", check("2.1", "supernova")],
    ]);

    expect(resultOf(result, "2.1")?.result).toBe("supernova");
  });

  it("keeps an unrankable truth rather than inventing one", () => {
    const result = aggregate([
      ["https://a/", check("2.1", "warning", "observed")],
      ["https://b/", check("2.1", "warning", "quantum")],
    ]);

    expect(resultOf(result, "2.1")?.truth).toBe("quantum");
  });

  it("takes the strongest truth any page claimed", () => {
    expect(
      resultOf(
        aggregate([
          ["https://a/", check("2.1", "warning", "partial")],
          ["https://b/", check("2.1", "warning", "observed")],
        ]),
        "2.1",
      )?.truth,
    ).toBe("observed");
  });

  it("reads a not-observed and unavailable tie as unavailable", () => {
    // Fail-closed: with nothing claiming more, "could not see" beats "looked
    // and found nothing".
    expect(
      resultOf(
        aggregate([
          ["https://a/", check("2.1", "excluded", "unavailable")],
          ["https://b/", check("2.1", "excluded", "not-observed")],
        ]),
        "2.1",
      )?.truth,
    ).toBe("not-observed");
  });

  it("counts every hit page without truncating, in selection order", () => {
    const result = aggregate([
      ["https://a/", check("2.1", "warning")],
      ["https://b/", check("2.1", "pass")],
      ["https://c/", check("2.1", "blocker")],
    ]);

    expect(result.reach.get("2.1")?.keyPageHitCount).toBe(2);
    expect(result.reach.get("2.1")?.hitUrls).toEqual([
      "https://a/",
      "https://c/",
    ]);
  });

  it("keeps each page's own measurement for the detail view", () => {
    const result = aggregate([
      ["https://a/", check("2.1", "warning")],
      ["https://b/", check("2.1", "pass")],
    ]);

    expect(result.reach.get("2.1")?.outcomes.map((entry) => entry.result)).toEqual([
      "warning",
      "pass",
    ]);
  });

  it("publishes no page reach when no key page was selected", () => {
    const result = aggregateKeyPageEvaluations({ site: SITE, pages: [] });

    expect(result.checks.map((entry) => entry.check.id)).toEqual(["D1"]);
    expect(result.reach.size).toBe(0);
  });
});
