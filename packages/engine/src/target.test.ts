import { describe, expect, it } from "vitest";
import { testObservationLineage } from "./test-observation-lineage.ts";
import {
  findingTarget,
  type ResolvedFindingTargetMember,
} from "./target.ts";

function crawlMember(url: string): ResolvedFindingTargetMember {
  const lineage = testObservationLineage(`crawl:${url}`, {
    sitePageUrl: url,
    pageSnapshot: true,
  });
  if (
    lineage.sitePageId === null ||
    lineage.sitePageUrl === null ||
    lineage.pageSnapshotId === null
  ) {
    throw new Error("test lineage must be resolved");
  }
  return {
    resolutionState: "resolved",
    basisKind: "crawl_exact_fetch",
    observationId: lineage.observationId,
    snapshotId: lineage.snapshotId,
    sitePageId: lineage.sitePageId,
    sitePageUrl: lineage.sitePageUrl,
    pageSnapshotId: lineage.pageSnapshotId,
    memberRef: url,
  };
}

describe("FindingTargetDraft v1 boundary", () => {
  it("orders aggregate members deterministically by exact member identity", () => {
    const target = findingTarget(
      { relation: "affected_by_page_set", targetKind: "page_set" },
      "priority_commercial",
      [
        crawlMember("https://example.com/z/"),
        crawlMember("https://example.com/a/"),
      ],
      "observation_members",
    );

    expect(target.members.map((member) => member.memberRef)).toEqual([
      "https://example.com/a/",
      "https://example.com/z/",
    ]);
  });

  it("rejects direct targets without their one explicit resolved or unresolved member", () => {
    expect(() =>
      findingTarget(
        { relation: "direct_url", targetKind: "url" },
        "https://example.com/a/",
        [],
        "observation_members",
      ),
    ).toThrow(/exactly one member/i);
  });

  it("rejects out-of-vocabulary HTTP refs and unbounded aggregate refs", () => {
    expect(() =>
      findingTarget(
        {
          relation: "affected_by_http_status",
          targetKind: "http_status",
        },
        "http_status:503",
        [crawlMember("https://example.com/down")],
        "observation_members",
      ),
    ).toThrow(/three-digit status/i);

    expect(() =>
      findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "x".repeat(501),
        [],
        "target_definition",
      ),
    ).toThrow(/exceeds 500/i);
  });

  it("rejects an exact crawl member whose memberRef differs from its SitePage URL", () => {
    const member = crawlMember("https://example.com/exact/");
    expect(() =>
      findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "exact_pages",
        [{ ...member, memberRef: "https://example.com/canonical" }],
        "observation_members",
      ),
    ).toThrow(/must match its SitePage URL and frozen PageSnapshot/i);
  });

  it("rejects a crawl member without a frozen PageSnapshot and a divergent direct URL ref", () => {
    const member = crawlMember("https://example.com/exact/");
    expect(() =>
      findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "exact_pages",
        [{ ...member, pageSnapshotId: null }],
        "observation_members",
      ),
    ).toThrow(/frozen PageSnapshot/i);

    expect(() =>
      findingTarget(
        { relation: "direct_url", targetKind: "url" },
        "https://example.com/canonical",
        [
          {
            ...member,
            basisKind: "observation_site_page",
            memberRef: "https://example.com/canonical",
          },
        ],
        "observation_members",
      ),
    ).toThrow(/must match its explicit member/i);
  });

  it("rejects unresolved aggregate membership because only direct URL may remain unresolved", () => {
    const lineage = testObservationLineage("gsc:https://example.com/ambiguous");
    expect(() =>
      findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "priority_commercial",
        [
          {
            resolutionState: "unresolved",
            basisKind: "unresolved_observation",
            observationId: lineage.observationId,
            snapshotId: lineage.snapshotId,
            memberRef: "https://example.com/ambiguous",
            limitation: "The analytics observation has ambiguous SitePage lineage.",
          },
        ],
        "observation_members",
      ),
    ).toThrow(/only direct URL/i);
  });

  it("rejects zero-member exact Crawl aggregate roots", () => {
    expect(() =>
      findingTarget(
        {
          relation: "affected_by_http_status",
          targetKind: "http_status",
        },
        "503",
        [],
        "observation_members",
      ),
    ).toThrow(/non-empty exact Crawl membership/i);

    expect(() =>
      findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "low_internal_inlinks",
        [],
        "observation_members",
      ),
    ).toThrow(/non-empty exact Crawl membership/i);
  });

  it("rejects resolved analytics members in exact Crawl aggregates", () => {
    const member = crawlMember("https://example.com/analytics/");
    expect(() =>
      findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "priority_commercial",
        [
          {
            ...member,
            basisKind: "observation_site_page",
            pageSnapshotId: null,
          },
        ],
        "observation_members",
      ),
    ).toThrow(/requires exact Crawl members/i);
  });

  it("accepts only the current empty definition targets in definition mode", () => {
    expect(
      findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "offer:team-collaboration",
        [],
        "target_definition",
      ),
    ).toMatchObject({ targetRef: "offer:team-collaboration", members: [] });

    expect(
      findingTarget(
        {
          relation: "affected_by_keyword_cluster",
          targetKind: "keyword_cluster",
        },
        "project-management",
        [],
        "target_definition",
      ),
    ).toMatchObject({ targetRef: "project-management", members: [] });

    expect(
      findingTarget(
        { relation: "affected_by_user_agent", targetKind: "user_agent" },
        "OAI-SearchBot",
        [],
        "target_definition",
      ),
    ).toMatchObject({ targetRef: "OAI-SearchBot", members: [] });
  });

  it("rejects exact page-set roots disguised as empty definitions", () => {
    expect(() =>
      findingTarget(
        { relation: "affected_by_page_set", targetKind: "page_set" },
        "low_internal_inlinks",
        [],
        "target_definition",
      ),
    ).toThrow(/content coverage definition/i);
  });
});
