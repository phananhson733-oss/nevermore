import { describe, expect, it } from "vitest";
import type { ArtifactDto } from "@/lib/services/artifact-mappers";
import type {
  ActionDto,
  FindingDto,
} from "@/lib/services/diagnostic-mappers";
import type { DataSnapshotDto } from "@/lib/services/source-mappers";
import { buildOverviewHighlights } from "@/lib/services/workspace-view";

const NOW = "2026-07-18T12:00:00.000Z";

function action(
  id: string,
  findingId: string,
  priorityBand: string,
  status = "planned",
): ActionDto {
  return {
    id,
    findingId,
    templateId: "fix_http_status.v1",
    title: `Action ${id}`,
    description: "Canonical action copy.",
    contentLocale: "en",
    priorityBand,
    roadmapLane: "now",
    status,
    effort: "small",
    risk: "low",
    expectedOutcome: "Canonical outcome.",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function snapshot(
  id: string,
  capturedAt: string,
  availability = "available",
  sourceWindow: DataSnapshotDto["sourceWindow"] = { start: null, end: null },
  limitation = "Static HTML only.",
): DataSnapshotDto {
  return {
    id,
    siteId: "site-1",
    provider: "crawl",
    datasetKey: "crawl_pages",
    schemaVersion: "1.0.0",
    methodVersion: "crawl-v1",
    capturedAt,
    sourceWindow,
    availability,
    limitation,
    rowCount: 12,
    checksum: `sha256:${id}`,
  };
}

function finding(id: string, evidenceId: string): FindingDto {
  return {
    id,
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
    domain: "technical_seo",
    titleKey: "finding.tech.http_status",
    titleArgs: {},
    summary: "A product page returned a server error.",
    summaryLocale: "en",
    severity: "high",
    confidence: "high",
    reviewState: "confirmed",
    reviewRevision: 1,
    active: true,
    regressed: false,
    subjectRefs: [],
    evidence: [
      {
        id: evidenceId,
        sourceProvider: "crawl",
        origin: "crawl_pages",
        method: "HTTP response inspection",
        grade: "A",
        availability: "available",
        support: "supports",
        claim: "The URL returned HTTP 500.",
        subjectRefs: [],
        observedAt: NOW,
        limitation: "One captured response.",
        snapshotId: "snapshot-new",
        collectionRunId: "collection-run-new",
        analysisInvocationId: null,
      },
    ],
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    resolvedAt: null,
  };
}

function artifact(
  id: string,
  actionId: string,
  status = "draft",
): ArtifactDto {
  return {
    id,
    actionId,
    artifactType: "technical_ticket",
    status,
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 1,
    validationState: "valid",
    current: null,
    activeRun: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("buildOverviewHighlights", () => {
  it("projects a ready snapshot → highest-priority action → evidence → delivery chain", () => {
    const medium = action("medium", "finding-medium", "medium");
    const critical = action("critical", "finding-critical", "critical", "in_progress");
    const result = buildOverviewHighlights({
      // Repository order is update recency, not priority. The read model must
      // select from the canonical persisted bands without re-deriving a score.
      actions: [medium, critical],
      snapshots: [
        snapshot("snapshot-old", "2026-07-17T12:00:00.000Z"),
        snapshot("snapshot-new", NOW),
      ],
      findings: [
        finding("finding-medium", "evidence-medium"),
        finding("finding-critical", "evidence-critical"),
      ],
      artifacts: [
        artifact("artifact-medium", medium.id, "ready"),
        artifact("artifact-critical", critical.id, "draft"),
      ],
    });

    expect(result.topActions.map((item) => item.id)).toEqual([
      "critical",
      "medium",
    ]);
    expect(result.latestSnapshot?.id).toBe("snapshot-new");
    expect(result.topActionEvidence.map((item) => item.id)).toEqual([
      "evidence-critical",
    ]);
    expect(result.deliveryFocus).toEqual({
      artifactId: "artifact-critical",
      actionId: "critical",
      artifactType: "technical_ticket",
      status: "draft",
      updatedAt: NOW,
    });
  });

  it("uses the lowest snapshot id when captured timestamps are equal", () => {
    const higherId = snapshot("snapshot-z", NOW);
    const lowerId = snapshot("snapshot-a", NOW);
    const highlights = (snapshots: readonly DataSnapshotDto[]) =>
      buildOverviewHighlights({
        actions: [],
        snapshots,
        findings: [],
        artifacts: [],
      });

    expect(highlights([higherId, lowerId]).latestSnapshot).toBe(lowerId);
    expect(highlights([lowerId, higherId]).latestSnapshot).toBe(lowerId);
  });

  it("keeps a genuinely empty project unavailable instead of inventing values", () => {
    expect(
      buildOverviewHighlights({
        actions: [],
        snapshots: [],
        findings: [],
        artifacts: [],
      }),
    ).toEqual({
      topActions: [],
      latestSnapshot: null,
      topActionEvidence: [],
      deliveryFocus: null,
    });
  });

  it("returns at most three customer work cards from the exact frozen audit Finding set", () => {
    const staleCritical = action(
      "stale-critical",
      "finding-stale",
      "critical",
    );
    const currentHigh = action("current-high", "finding-high", "high");
    const currentMedium = action("current-medium", "finding-medium", "medium");
    const currentLow = action("current-low", "finding-low", "low");
    const fourthCurrentLow = action(
      "current-low-fourth",
      "finding-low-fourth",
      "low",
    );
    const dismissedCurrentCritical = action(
      "current-dismissed-critical",
      "finding-dismissed",
      "critical",
      "dismissed",
    );
    const completedCurrentCritical = action(
      "current-done-critical",
      "finding-done",
      "critical",
      "done",
    );

    const result = buildOverviewHighlights({
      actions: [
        staleCritical,
        currentLow,
        currentMedium,
        fourthCurrentLow,
        currentHigh,
        dismissedCurrentCritical,
        completedCurrentCritical,
      ],
      snapshots: [],
      findings: [],
      artifacts: [],
      currentRunFindingIds: new Set([
        "finding-high",
        "finding-medium",
        "finding-low",
        "finding-low-fourth",
        "finding-dismissed",
        "finding-done",
      ]),
    });

    expect(result.topActions.map((item) => item.id)).toEqual([
      "current-high",
      "current-medium",
      "current-low",
    ]);
  });

  it("keeps partial source data while leaving missing evidence and delivery unavailable", () => {
    const blocked = action("blocked", "missing-finding", "high", "blocked");
    const partial = snapshot("snapshot-partial", NOW, "partial");
    const result = buildOverviewHighlights({
      actions: [blocked],
      snapshots: [partial],
      findings: [],
      artifacts: [],
    });

    expect(result.latestSnapshot).toBe(partial);
    expect(result.topActions).toEqual([blocked]);
    expect(result.topActionEvidence).toEqual([]);
    expect(result.deliveryFocus).toBeNull();
  });

  it("preserves the latest snapshot's canonical analysis window and limitation for the evidence footer", () => {
    const sourceWindow = {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-17T23:59:59.000Z",
    };
    const canonical = snapshot(
      "snapshot-windowed",
      NOW,
      "partial",
      sourceWindow,
      "Search Console coverage is unavailable.",
    );

    const result = buildOverviewHighlights({
      actions: [],
      snapshots: [canonical],
      findings: [],
      artifacts: [],
    });

    expect(result.latestSnapshot).toBe(canonical);
    expect(result.latestSnapshot?.sourceWindow).toEqual(sourceWindow);
    expect(result.latestSnapshot?.limitation).toBe(
      "Search Console coverage is unavailable.",
    );
  });
});
