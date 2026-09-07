// @input  -- synthetic evaluated checks and audit records across every contract state
// @output -- regression guard for issue lanes, fail-closed states, and affected targets
// @pos    -- pure unit guard for the issue-first projection

import { describe, expect, it } from "vitest";
import type { SeoAuditRecord } from "@sf/public-tools";
import type { AgentAuditEvaluatedCheck } from "@sf/public-tools/agent-audit";

import {
  AGENT_ISSUE_URL_DISPLAY_LIMIT,
  buildAgentIssueModel,
} from "./agent-issue-model";

function record({
  id,
  affected,
  state = "observed",
  siteLevel = false,
}: {
  readonly id: string;
  readonly affected: number;
  readonly state?: SeoAuditRecord["state"];
  readonly siteLevel?: boolean;
}): SeoAuditRecord {
  return {
    id,
    category: "metadata",
    state,
    unit: siteLevel ? "site" : "pages",
    population: "every_collected_page",
    targetTested: null,
    tested: 12,
    affected,
    observations: Array.from({ length: affected }, (_, index) => ({
      url: siteLevel ? null : `https://example.com/${id}-${index}`,
      values: [],
    })),
    limitation: null,
  } as unknown as SeoAuditRecord;
}

function evaluatedCheck({
  id,
  result,
  truth = "observed",
  engine = "ready",
  primaryAgent = "seo",
  evidenceRecordIds = [],
  scope = "page",
}: {
  readonly id: string;
  readonly result: string;
  readonly truth?: string;
  readonly engine?: string;
  readonly primaryAgent?: "seo" | "tech";
  readonly evidenceRecordIds?: readonly string[];
  readonly scope?: "site" | "page";
}): AgentAuditEvaluatedCheck {
  return {
    check: {
      id,
      scope,
      groupId: id.split(".")[0] ?? id,
      title: { en: `${id} title`, zh: `${id} 标题` },
      impact: { en: `${id} impact`, zh: `${id} 影响` },
      howToFix: { en: `${id} fix`, zh: `${id} 修复` },
      threshold: { en: "expected", zh: "预期" },
      thresholdAuthority: "official",
      dataSource: { en: "public HTML", zh: "公开 HTML" },
      scoreWeight: 1,
      scored: true,
      blocking: result === "blocker",
      blockerEvidenceRecordIds: [],
      failureResult: "warning",
      primaryAgent,
      inventoryReady: true,
      engine,
      evidenceRecordIds,
      issueRules: [],
      boundary: { en: "static HTML only", zh: "仅静态 HTML" },
    },
    result,
    engine,
    truth,
    measurement: { en: "Observed", zh: "已观测" },
    evidenceRecordIds,
    scoreValue: null,
    scoreContribution: null,
  } as unknown as AgentAuditEvaluatedCheck;
}

describe("buildAgentIssueModel", () => {
  it("keeps an ungraded noindex page visible beside another page's blocker", () => {
    const restricted = "https://example.com/account";
    const indexed = "https://example.com/pricing";
    const check = evaluatedCheck({ id: "1.3", result: "blocker", evidenceRecordIds: ["noindex_directive"] });
    const model = buildAgentIssueModel({ agent: "seo", checks: [check], targetUrl: indexed, inspectedTargetUrl: indexed,
      records: [{ ...record({ id: "noindex_directive", affected: 2 }), observations: [
        { url: restricted, values: [{ label: "sitemap_member", value: false }] },
        { url: indexed, values: [{ label: "sitemap_member", value: true }] },
      ] }],
      keyPageReach: new Map([["1.3", { keyPageTotal: 2, keyPageEvaluatedCount: 2, keyPageHitCount: 1, hitUrls: [indexed],
        outcomes: [restricted, indexed].map((url, index) => ({ page: { url, reason: "manual" as const, title: null, metaDescription: null,
          depth: 1, inboundLinks: 1, basis: "structure" as const, matchedFeature: null }, result: index === 0 ? "observed-only" as const : "blocker" as const, measurement: null })),
      }]]),
    });
    expect(model.counts.blocker).toBe(1);
    expect(model.observedOnly).toHaveLength(1);
    expect(model.observedOnly[0]?.affected.urls).toEqual([restricted]);
    expect(model.observedOnly[0]?.evidenceRecords[0]?.observations[0]?.url).toBe(restricted);
    expect(model.observedOnly[0]?.severity).toBeNull();
  });
  it.each([
    ["B4", null, 0, "crawlHistory"],
    ["B5", null, 0, "crawlHistory"],
    ["4.1", null, 0, "competitorContent"],
    ["9.1", null, 0, "serpNotEnabled"],
    ["8.1", "the_field_data_provider_did_not_answer_this_run", 0, "sourceFailed"],
    ["8.2", "unknown_future_limitation", 0, "insufficient"],
    ["5.4", "first_image_in_document_order_with_a_declared_size_no_viewport_is_available", 0, "staticImageEligibility"],
    ["6.1", "crawl_incomplete_inlinks_unreliable", 0, "crawlIncomplete"],
    ["8.1", "the_performance_request_timed_out_this_run", 0, "sourceTimeout"],
    ["8.5", "the_lab_test_did_not_return_page_transfer_bytes_this_run", 0, "labMissing"],
    ["8.2", "crux_reported_no_field_data_for_this_metric_on_this_url", 0, "fieldSampleMissing"],
    ["8.3", "no_field_data_source_was_configured_for_this_run", 0, "sourceNotConfigured"],
  ] as const)("explains why %s was not judged without inventing a failure", (id, limitation, tested, reason) => {
    const evidence = limitation === null ? [] : [{
      ...record({ id: "r", affected: 0, state: tested > 0 ? "not_observed" : "unverified" }),
      limitation, tested,
    }];
    const model = buildAgentIssueModel({ agent: "seo", records: evidence,
      checks: [evaluatedCheck({ id, result: "excluded", truth: "unavailable", engine: "needs-supplement",
        evidenceRecordIds: evidence.map((entry) => entry.id) })] });
    expect(model.excluded[0]?.exclusionReason).toBe(reason);
    expect(model.counts.blocker).toBe(0);
    expect(model.counts.passed).toBe(0);
  });

  it("maps the contract result states onto the three displayed severities", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "1.1", result: "blocker", evidenceRecordIds: ["r1"] }),
        evaluatedCheck({ id: "1.2", result: "warning", evidenceRecordIds: ["r2"] }),
        evaluatedCheck({ id: "1.3", result: "tip", evidenceRecordIds: ["r3"] }),
      ],
      records: [
        record({ id: "r1", affected: 1 }),
        record({ id: "r2", affected: 1 }),
        record({ id: "r3", affected: 1 }),
      ],
    });

    expect(model.actionable.map((issue) => issue.severity)).toEqual([
      "blocker",
      "warning",
      "suggestion",
    ]);
    expect(model.counts.blocker).toBe(1);
    expect(model.counts.warning).toBe(1);
    expect(model.counts.suggestion).toBe(1);
  });

  it("routes a source-gated exclusion to an investigation row instead of a failure", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "9.1",
          result: "excluded",
          truth: "source-gated",
          engine: "access-required",
        }),
      ],
      records: [],
    });

    const issue = model.actionable[0];
    expect(issue?.lane).toBe("investigation");
    expect(issue?.copyMode).toBe("investigation");
    // A gated check has no severity: calling it a failure invents a verdict the
    // run never reached.
    expect(issue?.severity).toBeNull();
    expect(model.counts.investigation).toBe(1);
    expect(model.counts.blocker + model.counts.warning + model.counts.suggestion).toBe(0);
  });

  it("never reports an unavailable affected count as zero", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "9.1",
          result: "excluded",
          truth: "source-gated",
          engine: "access-required",
        }),
      ],
      records: [],
    });

    expect(model.actionable[0]?.affected.mode).toBe("unavailable");
    expect(model.actionable[0]?.affected.totalCount).toBeNull();
    expect(model.actionable[0]?.affected.urls).toEqual([]);
  });

  it("keeps a non-gated exclusion out of the actionable lane", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "2.1",
          result: "excluded",
          truth: "unavailable",
          engine: "not-integrated",
        }),
      ],
      records: [],
    });

    expect(model.actionable).toHaveLength(0);
    expect(model.excluded.map((issue) => issue.check.check.id)).toEqual(["2.1"]);
  });

  it("collects passing checks into their own quiet lane", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [evaluatedCheck({ id: "3.1", result: "pass" })],
      records: [],
    });

    expect(model.passed.map((issue) => issue.check.check.id)).toEqual(["3.1"]);
    expect(model.actionable).toHaveLength(0);
    expect(model.counts.passed).toBe(1);
  });

  it("fails closed on an unrecognised result state", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "4.1",
          result: "catastrophe",
          evidenceRecordIds: ["r1"],
        }),
      ],
      records: [record({ id: "r1", affected: 3 })],
    });

    expect(model.actionable).toHaveLength(0);
    expect(model.excluded[0]?.recognized).toBe(false);
    expect(model.excluded[0]?.severity).toBeNull();
  });

  it("fails closed on a truth state this build cannot render, including illustrative", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "4.4",
          result: "warning",
          truth: "illustrative",
          evidenceRecordIds: ["r1"],
        }),
        evaluatedCheck({
          id: "6.5",
          result: "warning",
          truth: "documented",
          evidenceRecordIds: ["r1"],
        }),
      ],
      records: [record({ id: "r1", affected: 2 })],
    });

    // illustrative belongs to the solution draft preview, never to a row's
    // observed-truth badge.
    expect(model.actionable).toHaveLength(0);
    expect(model.excluded.every((issue) => issue.recognized === false)).toBe(true);
  });

  it("describes a site-level observation as site scope without inventing a URL", () => {
    const model = buildAgentIssueModel({
      agent: "tech",
      checks: [
        evaluatedCheck({
          id: "A1",
          result: "blocker",
          scope: "site",
          primaryAgent: "tech",
          evidenceRecordIds: ["r-site"],
        }),
      ],
      records: [record({ id: "r-site", affected: 1, siteLevel: true })],
    });

    const issue = model.actionable[0];
    expect(issue?.affected.mode).toBe("site-scope");
    expect(issue?.affected.urls).toEqual([]);
  });

  it("caps the displayed URLs and reports the remainder as an overflow count", () => {
    const affected = AGENT_ISSUE_URL_DISPLAY_LIMIT + 4;
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "1.1", result: "warning", evidenceRecordIds: ["r1"] }),
      ],
      records: [record({ id: "r1", affected })],
    });

    const issue = model.actionable[0];
    expect(issue?.affected.mode).toBe("urls");
    expect(issue?.affected.urls).toHaveLength(AGENT_ISSUE_URL_DISPLAY_LIMIT);
    expect(issue?.affected.totalCount).toBe(affected);
    expect(issue?.affected.overflowCount).toBe(4);
  });

  it("reports a clean run explicitly instead of as an empty list", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "3.1", result: "pass" }),
        evaluatedCheck({ id: "3.3", result: "pass" }),
      ],
      records: [],
    });

    expect(model.actionable).toHaveLength(0);
    expect(model.isClean).toBe(true);
  });

  it("does not call a run clean while an investigation row is open", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "3.1", result: "pass" }),
        evaluatedCheck({
          id: "9.1",
          result: "excluded",
          truth: "source-gated",
          engine: "access-required",
        }),
      ],
      records: [],
    });

    expect(model.isClean).toBe(false);
  });

  it("refuses to call a run clean while a check sits quarantined", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "3.1", result: "pass" }),
        evaluatedCheck({
          id: "4.1",
          result: "catastrophe",
          evidenceRecordIds: ["r1"],
        }),
      ],
      records: [record({ id: "r1", affected: 3 })],
    });

    // A state this build cannot read is not a pass. Reporting clean here would
    // put a green verdict over evidence nobody has looked at.
    expect(model.isClean).toBe(false);
    expect(model.counts.quarantined).toBe(1);
  });

  it("never publishes a failure verdict that observed nothing", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "5.1",
          result: "warning",
          truth: "source-gated",
          engine: "access-required",
          evidenceRecordIds: ["r1"],
        }),
        evaluatedCheck({
          id: "5.2",
          result: "blocker",
          truth: "unavailable",
          engine: "not-integrated",
        }),
      ],
      records: [record({ id: "r1", affected: 2 })],
    });

    // Each axis is individually legal; the combination is not. Publishing it
    // would turn "no data" into a finding with a repair order attached.
    expect(model.actionable).toHaveLength(0);
    expect(model.counts.quarantined).toBe(2);
    expect(model.isClean).toBe(false);
  });

  it("reports the record's affected total, not the number of observations", () => {
    const sparse = {
      ...record({ id: "r1", affected: 4 }),
      affected: 25,
    } as unknown as SeoAuditRecord;

    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "1.1", result: "warning", evidenceRecordIds: ["r1"] }),
      ],
      records: [sparse],
    });

    const affected = model.actionable[0]?.affected;
    expect(affected?.totalCount).toBe(25);
    expect(affected?.enumerated).toBe(false);
    expect(affected?.urls).toHaveLength(4);
    expect(affected?.overflowCount).toBe(21);
  });

  it("separates missing evidence from a measured population of zero", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "1.1", result: "warning", evidenceRecordIds: [] }),
      ],
      records: [],
    });

    const affected = model.actionable[0]?.affected;
    expect(affected?.mode).toBe("not-captured");
    expect(affected?.totalCount).toBeNull();
  });


  it("treats a record that published no observation as missing evidence, not zero", () => {
    // Distinct from "no records at all": this path reaches the guard that had
    // no test, and a mutation returning {mode:"urls", totalCount:0} stayed green.
    const silent = {
      ...record({ id: "r1", affected: 0 }),
      observations: [],
    } as unknown as SeoAuditRecord;

    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "1.1", result: "warning", evidenceRecordIds: ["r1"] }),
      ],
      records: [silent],
    });

    const affected = model.actionable[0]?.affected;
    expect(affected?.mode).toBe("not-captured");
    expect(affected?.totalCount).toBeNull();
  });

  it("keeps the record's affected count for a site-level observation", () => {
    const wide = {
      ...record({ id: "rs", affected: 1, siteLevel: true }),
      affected: 25,
    } as unknown as SeoAuditRecord;

    const model = buildAgentIssueModel({
      agent: "tech",
      checks: [
        evaluatedCheck({
          id: "A1",
          result: "blocker",
          scope: "site",
          primaryAgent: "tech",
          evidenceRecordIds: ["rs"],
        }),
      ],
      records: [wide],
    });

    const affected = model.actionable[0]?.affected;
    expect(affected?.mode).toBe("site-scope");
    expect(affected?.totalCount).toBe(25);
    expect(affected?.enumerated).toBe(false);
  });

  it("does not call a run clean when nothing was evaluated at all", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "2.1",
          result: "excluded",
          truth: "unavailable",
          engine: "not-integrated",
        }),
      ],
      records: [],
    });

    // Nothing actionable and nothing passed: the run concluded nothing, which
    // is not the same as a clean bill of health.
    expect(model.isClean).toBe(false);
    expect(model.evaluatedNothing).toBe(true);
  });

  it("orders blockers before warnings before suggestions", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({ id: "1.3", result: "tip", evidenceRecordIds: ["r3"] }),
        evaluatedCheck({ id: "1.1", result: "blocker", evidenceRecordIds: ["r1"] }),
        evaluatedCheck({ id: "1.2", result: "warning", evidenceRecordIds: ["r2"] }),
      ],
      records: [
        record({ id: "r1", affected: 1 }),
        record({ id: "r2", affected: 1 }),
        record({ id: "r3", affected: 1 }),
      ],
    });

    expect(model.actionable.map((issue) => issue.check.check.id)).toEqual([
      "1.1",
      "1.2",
      "1.3",
    ]);
  });

  it("places investigation rows after every observed issue", () => {
    const model = buildAgentIssueModel({
      agent: "seo",
      checks: [
        evaluatedCheck({
          id: "9.1",
          result: "excluded",
          truth: "source-gated",
          engine: "access-required",
        }),
        evaluatedCheck({ id: "1.3", result: "tip", evidenceRecordIds: ["r3"] }),
      ],
      records: [record({ id: "r3", affected: 1 })],
    });

    expect(model.actionable.map((issue) => issue.lane)).toEqual([
      "actionable",
      "investigation",
    ]);
  });
});
