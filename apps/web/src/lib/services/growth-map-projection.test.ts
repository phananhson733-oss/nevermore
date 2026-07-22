import { canonicalize, contentHash, sha256Hex, type CanonicalValue } from "@sf/db";
import { describe, expect, it } from "vitest";
import {
  customerFacingGrowthMapFindingTitle,
  growthMapIsoInstant,
  growthMapProjectionCopy,
  projectGrowthMapUrlCoverage,
  projectGrowthMapMetricObservations,
  validateGrowthMapFrozenRun,
  verifiedGrowthMapPageTitle,
} from "./growth-map-projection";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  site: "10000000-0000-4000-8000-000000000003",
  run: "10000000-0000-4000-8000-000000000004",
  icp: "10000000-0000-4000-8000-000000000005",
  crawl: "10000000-0000-4000-8000-000000000006",
  gsc: "10000000-0000-4000-8000-000000000007",
  page: "10000000-0000-4000-8000-000000000008",
  observation: "10000000-0000-4000-8000-000000000009",
} as const;

const capturedAt = "2026-07-21T08:00:00.000Z";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.crawl,
    workspace_id: ids.workspace,
    project_id: ids.project,
    site_id: ids.site,
    collection_run_id: "10000000-0000-4000-8000-000000000010",
    source_connection_id: "10000000-0000-4000-8000-000000000011",
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "0.3.0",
    method_version: "crawl.site_graph.v2",
    captured_at: capturedAt,
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "Bounded public crawl.",
    raw_object_key: null,
    row_count: 1,
    checksum: "a".repeat(64),
    created_at: capturedAt,
    ...overrides,
  };
}

function runAndSnapshots() {
  const crawl = snapshot();
  const gsc = snapshot({
    id: ids.gsc,
    provider: "gsc",
    dataset_key: "gsc.page_query_daily.v1",
    method_version: "gsc.page_query_daily.v1",
    checksum: "b".repeat(64),
  });
  const snapshots = [crawl, gsc];
  const manifest = {
    projectId: ids.project,
    siteId: ids.site,
    icp: { id: ids.icp, version: 2, contentHash: "c".repeat(64) },
    snapshots: snapshots.map((row) => ({
      snapshotId: row.id,
      provider: row.provider,
      datasetKey: row.dataset_key,
      schemaVersion: row.schema_version,
      methodVersion: row.method_version,
      checksum: row.checksum,
      capturedAt: row.captured_at,
      sourceWindow: row.source_window,
      availability: row.availability,
    })),
    ruleSetVersion: "rules.v1",
    promptSetVersion: "prompts.v1",
    deliveryLocale: "zh-CN",
  };
  return {
    snapshots,
    run: {
      id: ids.run,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      icp_profile_id: ids.icp,
      icp_profile_version: 2,
      rule_set_version: "rules.v1",
      prompt_set_version: "prompts.v1",
      output_locale: "zh-CN",
      input_manifest: manifest,
      input_hash: contentHash(manifest as CanonicalValue),
      coverage: {},
      created_at: capturedAt,
      run_status: "completed",
      run_completed_at: capturedAt,
    },
  };
}

describe("Growth Map frozen read boundary", () => {
  it("accepts an exact completed manifest and identifies its one Crawl snapshot", () => {
    const fixture = runAndSnapshots();
    const frozen = validateGrowthMapFrozenRun(
      fixture.run,
      fixture.snapshots,
      { workspaceId: ids.workspace, projectId: ids.project },
    );

    expect(frozen.crawlSnapshotId).toBe(ids.crawl);
    expect(frozen.snapshotIds).toEqual([ids.crawl, ids.gsc]);
  });

  it("accepts PostgreSQL timestamptz text while preserving the exact frozen tuple", () => {
    const fixture = runAndSnapshots();
    const databaseInstant = "2026-07-21 08:00:00+00";
    const snapshots = fixture.snapshots.map((row) => ({
      ...row,
      captured_at: databaseInstant,
    }));
    const manifest = {
      ...fixture.run.input_manifest,
      snapshots: snapshots.map((row) => ({
        snapshotId: row.id,
        provider: row.provider,
        datasetKey: row.dataset_key,
        schemaVersion: row.schema_version,
        methodVersion: row.method_version,
        checksum: row.checksum,
        capturedAt: row.captured_at,
        sourceWindow: row.source_window,
        availability: row.availability,
      })),
    };
    const run = {
      ...fixture.run,
      run_completed_at: databaseInstant,
      input_manifest: manifest,
      input_hash: contentHash(manifest as CanonicalValue),
    };

    expect(
      validateGrowthMapFrozenRun(run, snapshots, {
        workspaceId: ids.workspace,
        projectId: ids.project,
      }).crawlSnapshotId,
    ).toBe(ids.crawl);
  });

  it("accepts equivalent offset renderings while still rejecting instant drift", () => {
    const fixture = runAndSnapshots();
    const databaseInstant = "2026-07-21 16:00:00.000000+08";
    const snapshots = fixture.snapshots.map((row) => ({
      ...row,
      captured_at: databaseInstant,
    }));
    const manifest = {
      ...fixture.run.input_manifest,
      snapshots: fixture.snapshots.map((row) => ({
        snapshotId: row.id,
        provider: row.provider,
        datasetKey: row.dataset_key,
        schemaVersion: row.schema_version,
        methodVersion: row.method_version,
        checksum: row.checksum,
        capturedAt: capturedAt,
        sourceWindow: row.source_window,
        availability: row.availability,
      })),
    };
    const run = {
      ...fixture.run,
      run_completed_at: databaseInstant,
      input_manifest: manifest,
      input_hash: contentHash(manifest as CanonicalValue),
    };

    expect(
      validateGrowthMapFrozenRun(run, snapshots, {
        workspaceId: ids.workspace,
        projectId: ids.project,
      }).crawlSnapshotId,
    ).toBe(ids.crawl);
    expect(growthMapIsoInstant(databaseInstant)).toBe(capturedAt);

    const drifted = snapshots.map((row, index) =>
      index === 0
        ? { ...row, captured_at: "2026-07-21 16:00:00.000001+08" }
        : row,
    );
    expect(() =>
      validateGrowthMapFrozenRun(run, drifted, {
        workspaceId: ids.workspace,
        projectId: ids.project,
      }),
    ).toThrow(/frozen Growth Map/i);
  });

  it("fails closed for partial tuple drift, unknown root keys, a non-readable status, or a corrupt hash", () => {
    const fixture = runAndSnapshots();
    const invalidAvailabilitySnapshots = fixture.snapshots.map((row) =>
      String(row.id) === ids.gsc
        ? { ...row, availability: "fabricated" }
        : row,
    );
    const invalidAvailabilityManifest = {
      ...fixture.run.input_manifest,
      snapshots: invalidAvailabilitySnapshots.map((row) => ({
        snapshotId: row.id,
        provider: row.provider,
        datasetKey: row.dataset_key,
        schemaVersion: row.schema_version,
        methodVersion: row.method_version,
        checksum: row.checksum,
        capturedAt: row.captured_at,
        sourceWindow: row.source_window,
        availability: row.availability,
      })),
    };
    const invalid = [
      {
        run: fixture.run,
        snapshots: fixture.snapshots.map((row) =>
          String(row.id) === ids.gsc
            ? { ...row, checksum: "d".repeat(64) }
            : row,
        ),
      },
      {
        run: {
          ...fixture.run,
          input_manifest: { ...fixture.run.input_manifest, surprise: true },
        },
        snapshots: fixture.snapshots,
      },
      {
        run: { ...fixture.run, run_status: "running" },
        snapshots: fixture.snapshots,
      },
      {
        run: { ...fixture.run, input_hash: "0".repeat(64) },
        snapshots: fixture.snapshots,
      },
      {
        run: {
          ...fixture.run,
          input_manifest: invalidAvailabilityManifest,
          input_hash: contentHash(
            invalidAvailabilityManifest as CanonicalValue,
          ),
        },
        snapshots: invalidAvailabilitySnapshots,
      },
    ];

    for (const candidate of invalid) {
      expect(() =>
        validateGrowthMapFrozenRun(candidate.run, candidate.snapshots, {
          workspaceId: ids.workspace,
          projectId: ids.project,
        }),
      ).toThrow(/frozen Growth Map/i);
    }
  });
});

describe("Growth Map content-addressed page title", () => {
  it("reads title only after verifying the canonical extract hash and exact fetch URL", () => {
    const extract = {
      schemaVersion: "crawl.page-extract.v1",
      subjectUrl: "https://example.com/pricing",
      depth: 0,
      projection: {
        fetchUrl: "https://example.com/pricing/",
        title: "  Pricing for B2B teams  ",
      },
    };
    const canonicalExtract = canonicalize(extract as CanonicalValue);

    expect(
      verifiedGrowthMapPageTitle({
        normalizedUrl: "https://example.com/pricing/",
        contentHash: sha256Hex(canonicalExtract),
        canonicalExtract,
        extract,
      }),
    ).toBe("Pricing for B2B teams");
  });

  it("rejects hash, canonical serialization, and exact fetch lineage drift", () => {
    const extract = {
      schemaVersion: "crawl.page-extract.v1",
      subjectUrl: "https://example.com/pricing",
      depth: 0,
      projection: {
        fetchUrl: "https://example.com/pricing/",
        title: "Pricing",
      },
    };
    const canonicalExtract = canonicalize(extract as CanonicalValue);
    const base = {
      normalizedUrl: "https://example.com/pricing/",
      contentHash: sha256Hex(canonicalExtract),
      canonicalExtract,
      extract,
    };

    for (const input of [
      { ...base, contentHash: "0".repeat(64) },
      { ...base, canonicalExtract: `${canonicalExtract} ` },
      { ...base, normalizedUrl: "https://example.com/other/" },
    ]) {
      expect(() => verifiedGrowthMapPageTitle(input)).toThrow(
        /content-addressed PageSnapshot/i,
      );
    }
  });
});

describe("Growth Map scalar metric projection", () => {
  it("projects only registered numeric JSON pointers and preserves a real zero", () => {
    const metrics = projectGrowthMapMetricObservations(
      [
        {
          id: ids.observation,
          workspace_id: ids.workspace,
          project_id: ids.project,
          snapshot_id: ids.gsc,
          site_page_id: ids.page,
          provider: "gsc",
          metric_key: "gsc.page.v1",
          subject_type: "url",
          subject_ref: "https://example.com/pricing",
          observed_at: capturedAt,
          availability: "available",
          value_numeric: null,
          value_text: null,
          value_json: {
            current28d: { clicks: 0, impressions: 1200, position: 4.2 },
            previous28d: { clicks: 20, impressions: 1300, position: 4.1 },
            topQueries: [],
            crafted: { clicks: 999999 },
          },
          unit: null,
          origin: "first_party",
          method: "observed",
          grade: "A",
          support: "supports",
          limitation: "Search Console top-row limitation.",
        },
      ],
      new Map([[ids.gsc, snapshot({ id: ids.gsc, provider: "gsc" })]]),
      new Date("2026-07-22T08:00:00.000Z"),
    );

    expect(metrics.map((metric) => [metric.valueSource, metric.value])).toEqual([
      [{ kind: "value_json", pointer: "/current28d/clicks" }, 0],
      [{ kind: "value_json", pointer: "/current28d/impressions" }, 1200],
      [{ kind: "value_json", pointer: "/current28d/position" }, 4.2],
      [{ kind: "value_json", pointer: "/previous28d/clicks" }, 20],
      [{ kind: "value_json", pointer: "/previous28d/impressions" }, 1300],
      [{ kind: "value_json", pointer: "/previous28d/position" }, 4.1],
    ]);
    expect(metrics.every((metric) => metric.freshness === "current")).toBe(true);
  });

  it("omits unavailable/null fields instead of manufacturing zero and marks stale values honestly", () => {
    const observation = {
      id: ids.observation,
      workspace_id: ids.workspace,
      project_id: ids.project,
      snapshot_id: ids.gsc,
      site_page_id: ids.page,
      provider: "ga4",
      metric_key: "ga4.landing.v1",
      subject_type: "url",
      subject_ref: "https://example.com/pricing",
      observed_at: "2026-07-01T08:00:00.000Z",
      availability: "available",
      value_numeric: null,
      value_text: null,
      value_json: {
        sessions: 9,
        engagedSessions: null,
        engagementRate: null,
        keyEvents: null,
        keyEventUnavailableReason: "GA4_KEY_EVENT_UNMAPPED",
      },
      unit: null,
      origin: "first_party",
      method: "observed",
      grade: "A",
      support: "supports",
      limitation: "GA4_KEY_EVENT_UNMAPPED",
    };
    const metrics = projectGrowthMapMetricObservations(
      [observation],
      new Map([
        [
          ids.gsc,
          snapshot({
            id: ids.gsc,
            provider: "ga4",
            captured_at: "2026-07-01T08:00:00.000Z",
          }),
        ],
      ]),
      new Date("2026-07-22T08:00:00.000Z"),
    );

    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      valueSource: { kind: "value_json", pointer: "/sessions" },
      value: 9,
      freshness: "stale",
    });
    // Provider limitation remains an immutable source record. Freshness is a
    // separate typed field so localized workbench copy is never concatenated
    // into (or mistaken for) the provider's original wording.
    expect(metrics[0]?.limitation).toBe("GA4_KEY_EVENT_UNMAPPED");
    expect(JSON.stringify(metrics)).not.toContain('"value":0');
  });

  it("normalizes immutable database timestamps to contract ISO instants", () => {
    const observedAt = "2026-07-22 08:00:00+00";
    const metrics = projectGrowthMapMetricObservations(
      [
        {
          id: ids.observation,
          workspace_id: ids.workspace,
          project_id: ids.project,
          snapshot_id: ids.gsc,
          site_page_id: ids.page,
          provider: "gsc",
          metric_key: "gsc.page.v1",
          subject_type: "url",
          subject_ref: "https://example.com/pricing",
          observed_at: observedAt,
          availability: "available",
          value_numeric: null,
          value_text: null,
          value_json: {
            current28d: { clicks: 1, impressions: null, position: null },
            previous28d: { clicks: null, impressions: null, position: null },
          },
          unit: null,
          limitation: "Provider fact.",
        },
      ],
      new Map([
        [
          ids.gsc,
          snapshot({ id: ids.gsc, provider: "gsc", captured_at: observedAt }),
        ],
      ]),
      new Date("2026-07-22T09:00:00.000Z"),
    );

    expect(metrics[0]?.observedAt).toBe("2026-07-22T08:00:00.000Z");
  });

  it("accepts an Observation and snapshot rendered in different zones only for the same instant", () => {
    const metrics = projectGrowthMapMetricObservations(
      [
        {
          id: ids.observation,
          workspace_id: ids.workspace,
          project_id: ids.project,
          snapshot_id: ids.gsc,
          site_page_id: ids.page,
          provider: "gsc",
          metric_key: "gsc.page.v1",
          subject_type: "url",
          subject_ref: "https://example.com/pricing",
          observed_at: "2026-07-22 16:00:00.000001+08",
          availability: "available",
          value_numeric: null,
          value_text: null,
          value_json: { current28d: { clicks: 1 }, previous28d: {} },
          unit: null,
          limitation: "Provider fact.",
        },
      ],
      new Map([
        [
          ids.gsc,
          snapshot({
            id: ids.gsc,
            provider: "gsc",
            captured_at: "2026-07-22T08:00:00.000001Z",
          }),
        ],
      ]),
      new Date("2026-07-22T09:00:00.000Z"),
    );

    expect(metrics[0]?.observedAt).toBe("2026-07-22T08:00:00.000001Z");
  });

  it("keeps an unreported registered scalar absent instead of treating it as zero or corruption", () => {
    const metrics = projectGrowthMapMetricObservations(
      [
        {
          id: ids.observation,
          workspace_id: ids.workspace,
          project_id: ids.project,
          snapshot_id: ids.gsc,
          site_page_id: ids.page,
          provider: "gsc",
          metric_key: "gsc.page.v1",
          subject_type: "url",
          subject_ref: "https://example.com/pricing",
          observed_at: capturedAt,
          availability: "available",
          value_numeric: null,
          value_text: null,
          value_json: {
            current28d: { clicks: 3 },
            previous28d: {},
          },
          unit: null,
          limitation: "Only clicks were returned by the provider.",
        },
      ],
      new Map([[ids.gsc, snapshot({ id: ids.gsc, provider: "gsc" })]]),
      new Date("2026-07-22T08:00:00.000Z"),
    );

    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      valueSource: { kind: "value_json", pointer: "/current28d/clicks" },
      value: 3,
    });
    expect(JSON.stringify(metrics)).not.toContain('"value":0');
  });
});

describe("Growth Map customer-safe URL coverage", () => {
  it("lets URL-level missing data override a source set that is merely stale", () => {
    const coverage = projectGrowthMapUrlCoverage(
      {
        availability: "stale",
        limitations: ["The frozen Crawl snapshot is stale."],
      },
      {
        hasPageSnapshot: false,
        analyticsAvailability: {},
      },
    );

    expect(coverage.availability).toBe("partial");
    expect(coverage.limitations).toEqual([
      "The frozen Crawl snapshot is stale.",
      "No frozen Crawl PageSnapshot is available for this URL.",
      "No frozen GSC URL Observation is available for this page.",
      "No frozen GA4 URL Observation is available for this page.",
    ]);
  });

  it("keeps stale when the URL has every required source and staleness is the only limitation", () => {
    expect(
      projectGrowthMapUrlCoverage(
        {
          availability: "stale",
          limitations: ["The frozen GSC snapshot is stale."],
        },
        {
          hasPageSnapshot: true,
          analyticsAvailability: { gsc: "available", ga4: "available" },
        },
      ),
    ).toEqual({
      availability: "stale",
      limitations: ["The frozen GSC snapshot is stale."],
    });
  });

  it("uses Chinese workbench decision copy for a zh-CN diagnostic", () => {
    const copy = growthMapProjectionCopy("zh-CN");
    expect(copy.partialRun).toBe("最新一次已完成的诊断仅覆盖了部分数据。");
    expect(copy.missingSnapshot("gsc")).toBe(
      "本次诊断未冻结 GSC 数据快照。",
    );
    expect(copy.priorityUnavailable).toBe(
      "当前诊断没有指向该 URL 的 Finding。",
    );
    expect(copy.deltaUnavailable).toBe(
      "该 URL 尚无两个不可变复查锚点，无法计算变化。",
    );

    const coverage = projectGrowthMapUrlCoverage(
      {
        availability: "stale",
        limitations: ["Provider fact remains verbatim."],
      },
      { hasPageSnapshot: false, analyticsAvailability: {} },
      "zh-CN",
    );
    expect(coverage.availability).toBe("partial");
    expect(coverage.limitations).toEqual([
      "Provider fact remains verbatim.",
      "该 URL 没有可用的冻结 Crawl PageSnapshot。",
      "该页面没有可用的冻结 GSC URL Observation。",
      "该页面没有可用的冻结 GA4 URL Observation。",
    ]);
  });
});

describe("Growth Map customer-facing Finding title", () => {
  it("uses only the bounded customer-facing summary", () => {
    expect(
      customerFacingGrowthMapFindingTitle(
        "  Missing canonical on pricing  ",
        "en",
        "en",
      ),
    ).toBe("Missing canonical on pricing");
  });

  it("fails closed when summary cannot be exposed instead of falling back to an internal i18n key", () => {
    expect(() => customerFacingGrowthMapFindingTitle(" ", "en", "en")).toThrow(
      /customer-facing Finding summary/i,
    );
    expect(() =>
      customerFacingGrowthMapFindingTitle("x".repeat(501), "en", "en"),
    ).toThrow(/customer-facing Finding summary/i);
  });

  it("rejects legacy English summary provenance for a zh-CN diagnostic", () => {
    expect(() =>
      customerFacingGrowthMapFindingTitle(
        "Legacy English summary",
        "en",
        "zh-CN",
      ),
    ).toThrow(/customer-facing Finding summary/i);
    expect(
      customerFacingGrowthMapFindingTitle(
        "中文客户摘要",
        "zh-CN",
        "zh-CN",
      ),
    ).toBe("中文客户摘要");
  });

  it("rejects a zh-CN summary for an English diagnostic instead of rendering mixed customer copy", () => {
    expect(() =>
      customerFacingGrowthMapFindingTitle("中文客户摘要", "zh-CN", "en"),
    ).toThrow(/customer-facing Finding summary/i);
    expect(
      customerFacingGrowthMapFindingTitle(
        "Canonical issue on pricing",
        "EN",
        "en",
      ),
    ).toBe("Canonical issue on pricing");
  });
});
