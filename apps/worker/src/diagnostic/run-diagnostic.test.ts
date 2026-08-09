import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  AuditRunsRepository,
  CompetitorsRepository,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
  FindingTargetsRepository,
  IcpProfilesRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  MAX_SITE_PAGE_ID_LOOKUP,
  normalizedUrlHash,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  SitePagesRepository,
  SitesRepository,
  TelemetryRepository,
  toRunAttempt,
  type AsyncRunRow,
  type CanonicalValue,
  type DataSnapshotRow,
  type DiagnosticRunRow,
  type IcpProfileRow,
  type ObservationRow,
  type SiteRow,
} from "@sf/db";
import {
  buildContextProjectionV1,
  DiagnosticContext,
  GOVERNANCE_PROJECTION_VERSION,
  GOVERNED_LEGACY_RULE_SET_VERSION,
  LEGACY_RULE_SET_VERSION,
  LINKGRAPH_LEGACY_RULE_SET_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
  type FindingTargetDraft,
} from "@sf/engine";
import type { Logger } from "@sf/observability";
import {
  CRAWL_METHOD_VERSION,
  DATAFORSEO_DATASET_KEY,
  DATAFORSEO_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
  DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
  METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2,
  METRIC_DATAFORSEO_COMPETITOR_AI_CITATION,
  METRIC_DATAFORSEO_SERP_COMPETITOR,
  METRIC_CSV_KEYWORD_GAP,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import {
  dataForSeoTargetForOrigin,
  findingTargetInsertsForFinding,
  lineageForEvidenceProvider,
  runDiagnostic,
  warnOnSlowRules,
} from "./run-diagnostic.ts";

const ICP_CONTENT_HASH = "c".repeat(64);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diagnostic slow-rule warnings (spec §8.3)", () => {
  it("warns above 250ms without imposing a per-rule timeout", () => {
    const warn = vi.fn();
    const logger: Logger = {
      context: { service: "worker", environment: "test" },
      child: () => logger,
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    };

    warnOnSlowRules(logger, "run-fixture", [
      { ruleId: "TECH-HTTP-001", durationMs: 250 },
      { ruleId: "TECH-CANONICAL-002", durationMs: 251 },
    ]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("diagnostic_rule_slow", {
      runId: "run-fixture",
      ruleId: "TECH-CANONICAL-002",
      durationMs: 251,
    });
  });
});

describe("diagnostic Finding target translation", () => {
  const siteId = "00000000-0000-4000-8000-000000000040";
  const findingId = "00000000-0000-4000-8000-000000000041";
  const diagnosticRunId = "00000000-0000-4000-8000-000000000042";

  it("persists an asset target with no members as one definition-only root", () => {
    const target = {
      version: 1,
      relation: "affected_by_keyword_cluster",
      targetKind: "keyword_cluster",
      targetRef: "project management",
      members: [],
    } satisfies FindingTargetDraft;

    expect(
      findingTargetInsertsForFinding(
        siteId,
        findingId,
        diagnosticRunId,
        target,
      ),
    ).toEqual([
      {
        siteId,
        findingId,
        diagnosticRunId,
        relation: "affected_by_keyword_cluster",
        targetKind: "keyword_cluster",
        targetRef: "project management",
        resolutionState: "definition_only",
        basisKind: "target_definition",
        sitePageId: null,
        pageSnapshotId: null,
        sourceObservationId: null,
        memberRef: null,
        limitation: null,
      },
    ]);
  });

  it("maps resolved aggregate members without inferring from Finding subject refs", () => {
    const target = {
      version: 1,
      relation: "affected_by_page_set",
      targetKind: "page_set",
      targetRef: "commercial_pages",
      members: [
        {
          resolutionState: "resolved",
          basisKind: "crawl_exact_fetch",
          observationId: "00000000-0000-4000-8000-000000000043",
          snapshotId: "00000000-0000-4000-8000-000000000044",
          sitePageId: "00000000-0000-4000-8000-000000000045",
          sitePageUrl: `${SITE_ORIGIN}/exact/`,
          pageSnapshotId: "00000000-0000-4000-8000-000000000046",
          memberRef: `${SITE_ORIGIN}/exact/`,
        },
      ],
    } satisfies FindingTargetDraft;

    expect(
      findingTargetInsertsForFinding(
        siteId,
        findingId,
        diagnosticRunId,
        target,
      ),
    ).toEqual([
      {
        siteId,
        findingId,
        diagnosticRunId,
        relation: "affected_by_page_set",
        targetKind: "page_set",
        targetRef: "commercial_pages",
        resolutionState: "resolved",
        basisKind: "crawl_exact_fetch",
        sitePageId: "00000000-0000-4000-8000-000000000045",
        pageSnapshotId: "00000000-0000-4000-8000-000000000046",
        sourceObservationId: "00000000-0000-4000-8000-000000000043",
        memberRef: `${SITE_ORIGIN}/exact/`,
        limitation: null,
      },
    ]);
  });

  it("preserves an unresolved GSC direct target and its explicit limitation", () => {
    const target = {
      version: 1,
      relation: "direct_url",
      targetKind: "url",
      targetRef: `${SITE_ORIGIN}/canonical`,
      members: [
        {
          resolutionState: "unresolved",
          basisKind: "unresolved_observation",
          observationId: "00000000-0000-4000-8000-000000000047",
          snapshotId: "00000000-0000-4000-8000-000000000048",
          memberRef: `${SITE_ORIGIN}/canonical`,
          limitation: "Frozen GSC lineage is ambiguous.",
        },
      ],
    } satisfies FindingTargetDraft;

    expect(
      findingTargetInsertsForFinding(
        siteId,
        findingId,
        diagnosticRunId,
        target,
      ),
    ).toEqual([
      {
        siteId,
        findingId,
        diagnosticRunId,
        relation: "direct_url",
        targetKind: "url",
        targetRef: `${SITE_ORIGIN}/canonical`,
        resolutionState: "unresolved",
        basisKind: "unresolved_observation",
        sitePageId: null,
        pageSnapshotId: null,
        sourceObservationId: "00000000-0000-4000-8000-000000000047",
        memberRef: `${SITE_ORIGIN}/canonical`,
        limitation: "Frozen GSC lineage is ambiguous.",
      },
    ]);
  });

  it("emits one exact ledger row per URL in a multi-page technical target", () => {
    const target = {
      version: 1,
      relation: "affected_by_http_status",
      targetKind: "http_status",
      targetRef: "404",
      members: [
        {
          resolutionState: "resolved",
          basisKind: "crawl_exact_fetch",
          observationId: "00000000-0000-4000-8000-000000000050",
          snapshotId: FROZEN_SNAPSHOT_ID,
          sitePageId: "00000000-0000-4000-8000-000000000051",
          sitePageUrl: `${SITE_ORIGIN}/one`,
          pageSnapshotId: "00000000-0000-4000-8000-000000000052",
          memberRef: `${SITE_ORIGIN}/one`,
        },
        {
          resolutionState: "resolved",
          basisKind: "crawl_exact_fetch",
          observationId: "00000000-0000-4000-8000-000000000053",
          snapshotId: FROZEN_SNAPSHOT_ID,
          sitePageId: "00000000-0000-4000-8000-000000000054",
          sitePageUrl: `${SITE_ORIGIN}/two`,
          pageSnapshotId: "00000000-0000-4000-8000-000000000055",
          memberRef: `${SITE_ORIGIN}/two`,
        },
      ],
    } satisfies FindingTargetDraft;

    const rows = findingTargetInsertsForFinding(
      siteId,
      findingId,
      diagnosticRunId,
      target,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.memberRef)).toEqual([
      `${SITE_ORIGIN}/one`,
      `${SITE_ORIGIN}/two`,
    ]);
    expect(rows.every((row) => row.limitation === null)).toBe(true);
  });
});

const FROZEN_AT = "2026-07-19T00:00:00.000Z";
const FROZEN_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000010";
const FROZEN_COLLECTION_RUN_ID = "00000000-0000-4000-8000-000000000011";
const SITE_ORIGIN = "https://example.com";
const CRAWL_SITE_PAGE_ID = "00000000-0000-4000-8000-000000000021";
const CRAWL_PAGE_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000022";
const ANALYTICS_SITE_PAGE_ID = "00000000-0000-4000-8000-000000000023";

const SOURCE_FIXTURE_CONFIG = {
  crawl: {
    snapshotId: FROZEN_SNAPSHOT_ID,
    collectionRunId: FROZEN_COLLECTION_RUN_ID,
    datasetKey: "crawl.site_graph.v1",
    methodVersion: CRAWL_METHOD_VERSION,
  },
  gsc: {
    snapshotId: "00000000-0000-4000-8000-000000000012",
    collectionRunId: "00000000-0000-4000-8000-000000000013",
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.page_query_daily.v1",
  },
  ga4: {
    snapshotId: "00000000-0000-4000-8000-000000000014",
    collectionRunId: "00000000-0000-4000-8000-000000000015",
    datasetKey: "ga4.organic_landing_daily.v1",
    methodVersion: "ga4.organic_landing_daily.v1",
  },
  csv: {
    snapshotId: "00000000-0000-4000-8000-000000000016",
    collectionRunId: "00000000-0000-4000-8000-000000000017",
    datasetKey: "csv.keyword_gap.v1",
    methodVersion: "csv.keyword_gap.v1",
  },
  dataforseo: {
    snapshotId: "00000000-0000-4000-8000-000000000018",
    collectionRunId: "00000000-0000-4000-8000-000000000019",
    datasetKey: DATAFORSEO_DATASET_KEY,
    methodVersion: DATAFORSEO_METHOD_VERSION,
  },
} as const;

type SourceProvider = keyof typeof SOURCE_FIXTURE_CONFIG;

const SOURCE_PROVIDERS = [
  "crawl",
  "gsc",
  "ga4",
  "csv",
  "dataforseo",
] as const satisfies readonly SourceProvider[];

const OBSERVATION_FIXTURES = [
  { provider: "crawl", metricKey: "crawl.page.v1", subjectType: "url" },
  { provider: "crawl", metricKey: "crawl.robots.v1", subjectType: "site" },
  { provider: "crawl", metricKey: "crawl.sitemap.v1", subjectType: "site" },
  { provider: "gsc", metricKey: "gsc.page.v1", subjectType: "url" },
  { provider: "ga4", metricKey: "ga4.landing.v1", subjectType: "url" },
  {
    provider: "csv",
    metricKey: "csv.keyword_gap.v1",
    subjectType: "keyword_cluster",
  },
  {
    provider: "dataforseo",
    metricKey: METRIC_CSV_KEYWORD_GAP,
    subjectType: "keyword_cluster",
  },
] as const;

type ObservationFixture = (typeof OBSERVATION_FIXTURES)[number];

function validProjectionFor(
  fixture: ObservationFixture,
): Record<string, unknown> {
  switch (fixture.metricKey) {
    case "crawl.page.v1":
      return {
        fetchUrl: `${SITE_ORIGIN}/fixture`,
        status: 200,
        finalStatus: 200,
        redirectChain: [],
        canonicalTarget: null,
        robotsIndexable: true,
        robotsDirectives: [],
        title: null,
        metaDescription: null,
        h1: [],
        headings: [],
        wordCount: 0,
        internalOutlinks: [],
        jsonLd: { types: [], errorCount: 0 },
        sitemapMember: false,
        bodyExcerpt: null,
        paragraphs: [],
        responseMs: 1,
        contentType: "text/html",
      };
    case "crawl.robots.v1":
      return {
        fetched: true,
        groups: [{ userAgent: "*", disallow: [], allow: [] }],
        sitemaps: [],
      };
    case "crawl.sitemap.v1":
      return { fetched: true, urlCount: 0, subjectUrls: [] };
    case "gsc.page.v1":
      return {
        current28d: { clicks: 1, impressions: 10, position: 2 },
        previous28d: { clicks: 0, impressions: 0, position: null },
        topQueries: [
          { query: "widget pricing", clicks: 1, impressions: 10, position: 2 },
        ],
      };
    case "ga4.landing.v1":
      return {
        sessions: 10,
        engagedSessions: 5,
        engagementRate: 0.5,
        keyEvents: 1,
        keyEventUnavailableReason: null,
      };
    case "csv.keyword_gap.v1":
      return {
        keyword: "widget pricing",
        clusterKey: "widget pricing",
        searchVolume: 100,
        keywordDifficulty: fixture.provider === "dataforseo" ? 37 : null,
        providerSearchIntent:
          fixture.provider === "dataforseo" ? "commercial" : null,
        currentUrl: `${SITE_ORIGIN}/fixture`,
        currentRank: 4,
        competitorDomain: null,
        competitorRank: null,
        marketCode: "US",
        languageCode: "en",
      };
  }
}

function validSiteRow(): SiteRow {
  return {
    id: "site-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    origin: SITE_ORIGIN,
    host: "example.com",
    market_codes: ["US"],
    language_codes: ["en"],
    is_primary: true,
    created_at: FROZEN_AT,
    updated_at: FROZEN_AT,
  };
}

function diagnosticFixture(inputManifest: Record<string, unknown>): {
  readonly scope: { readonly workspaceId: string; readonly projectId: string };
  readonly run: AsyncRunRow;
  readonly diagnostic: DiagnosticRunRow;
} {
  const scope = { workspaceId: "workspace-1", projectId: "project-1" };
  const requestedRuleSetVersion =
    typeof inputManifest["ruleSetVersion"] === "string"
      ? inputManifest["ruleSetVersion"]
      : RULE_SET_VERSION;
  const run = {
    id: "run-1",
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "diagnostic",
    status: "running",
    active_key: "diagnostic",
    contract_version: "2026-07-21",
    request_payload: {},
    progress: {},
    last_error_code: null,
    last_error_summary: null,
    result_type: null,
    result_id: null,
    attempt_count: 1,
    initiated_by: "actor-1",
    queued_at: FROZEN_AT,
    started_at: "2026-07-19T00:00:01.000Z",
    completed_at: null,
  } satisfies AsyncRunRow;
  const frozenManifest = {
    projectId: scope.projectId,
    siteId: "site-1",
    icp: { id: "icp-1", version: 1, contentHash: ICP_CONTENT_HASH },
    snapshots: [],
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en",
    ...(requestedRuleSetVersion === GOVERNED_LEGACY_RULE_SET_VERSION ||
    requestedRuleSetVersion === LINKGRAPH_LEGACY_RULE_SET_VERSION ||
    requestedRuleSetVersion === RULE_SET_VERSION
      ? {
          governance: {
            projectionVersion: GOVERNANCE_PROJECTION_VERSION,
            keywordClusters: [],
            competitors: [],
          },
        }
      : {}),
    ...(requestedRuleSetVersion === RULE_SET_VERSION
      ? { contextProjection: currentContextProjection() }
      : {}),
    ...inputManifest,
  };
  const ruleSetVersion = String(frozenManifest.ruleSetVersion);
  const promptSetVersion = String(frozenManifest.promptSetVersion);
  return {
    scope,
    run,
    diagnostic: {
      id: run.id,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: "site-1",
      icp_profile_id: "icp-1",
      icp_profile_version: 1,
      rule_set_version: ruleSetVersion,
      prompt_set_version: promptSetVersion,
      output_locale: "en",
      input_manifest: frozenManifest,
      input_hash: contentHash(frozenManifest as unknown as CanonicalValue),
      coverage: {},
      created_at: FROZEN_AT,
    } satisfies DiagnosticRunRow,
  };
}

function manifestEntry(
  overrides: Partial<{
    snapshotId: string;
    provider: string;
    availability: string;
    capturedAt: string;
    datasetKey: string;
    schemaVersion: string;
    methodVersion: string;
    checksum: string;
    sourceWindow: Record<string, unknown>;
  }> = {},
): Record<string, unknown> {
  return {
    snapshotId: FROZEN_SNAPSHOT_ID,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    checksum: "checksum",
    availability: "available",
    capturedAt: FROZEN_AT,
    sourceWindow: { start: null, end: null },
    ...overrides,
  };
}

function snapshotRow(
  overrides: Partial<DataSnapshotRow> = {},
): DataSnapshotRow {
  return {
    id: FROZEN_SNAPSHOT_ID,
    workspace_id: "workspace-1",
    project_id: "project-1",
    site_id: "site-1",
    collection_run_id: FROZEN_COLLECTION_RUN_ID,
    source_connection_id: null,
    provider: "crawl",
    dataset_key: "crawl.site_graph.v1",
    schema_version: "0.2.0",
    method_version: CRAWL_METHOD_VERSION,
    captured_at: FROZEN_AT,
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "unit fixture",
    raw_object_key: null,
    row_count: 1,
    checksum: "checksum",
    summary: {},
    created_at: FROZEN_AT,
    ...overrides,
  };
}

function frozenSource(
  provider: SourceProvider,
  overrides: {
    readonly datasetKey?: string;
    readonly schemaVersion?: string;
    readonly methodVersion?: string;
    readonly availability?: string;
  } = {},
): {
  readonly manifest: Record<string, unknown>;
  readonly snapshot: DataSnapshotRow;
} {
  const config = SOURCE_FIXTURE_CONFIG[provider];
  const datasetKey = overrides.datasetKey ?? config.datasetKey;
  const methodVersion = overrides.methodVersion ?? config.methodVersion;
  const schemaVersion =
    overrides.schemaVersion ??
    (provider === "dataforseo" ? methodVersion : "0.2.0");
  return {
    manifest: manifestEntry({
      snapshotId: config.snapshotId,
      provider,
      datasetKey,
      schemaVersion,
      methodVersion,
      ...(overrides.availability
        ? { availability: overrides.availability }
        : {}),
    }),
    snapshot: snapshotRow({
      id: config.snapshotId,
      collection_run_id: config.collectionRunId,
      provider,
      dataset_key: datasetKey,
      schema_version: schemaVersion,
      method_version: methodVersion,
      ...(overrides.availability
        ? { availability: overrides.availability }
        : {}),
    }),
  };
}

function observationRow(
  provider: SourceProvider,
  overrides: Partial<ObservationRow> = {},
): ObservationRow {
  const config = SOURCE_FIXTURE_CONFIG[provider];
  const axes =
    provider === "crawl"
      ? { origin: "direct_public", grade: "B" }
      : provider === "dataforseo"
        ? { origin: "vendor_observation", grade: "B" }
        : provider === "csv"
          ? { origin: "user_provided", grade: "C" }
          : { origin: "first_party", grade: "A" };
  return {
    id: "00000000-0000-4000-8000-000000000020",
    workspace_id: "workspace-1",
    project_id: "project-1",
    snapshot_id: config.snapshotId,
    site_page_id: null,
    provider,
    metric_key: OBSERVATION_FIXTURES.find(
      (fixture) => fixture.provider === provider,
    )!.metricKey,
    subject_type: OBSERVATION_FIXTURES.find(
      (fixture) => fixture.provider === provider,
    )!.subjectType,
    subject_ref: "https://example.com/fixture",
    observed_at: FROZEN_AT,
    availability: "unavailable",
    value_numeric: null,
    value_text: null,
    value_json: null,
    unit: null,
    origin: axes.origin,
    method: "observed",
    grade: axes.grade,
    support: "supports",
    limitation: "unit fixture",
    ...overrides,
  };
}

function availableObservationRow(
  fixture: ObservationFixture,
  overrides: Partial<ObservationRow> = {},
): ObservationRow {
  const subjectRef =
    fixture.subjectType === "site"
      ? SITE_ORIGIN
      : fixture.subjectType === "keyword_cluster"
        ? "widget pricing"
        : `${SITE_ORIGIN}/fixture`;
  return observationRow(fixture.provider, {
    metric_key: fixture.metricKey,
    subject_type: fixture.subjectType,
    subject_ref: subjectRef,
    site_page_id:
      fixture.metricKey === "crawl.page.v1" ? CRAWL_SITE_PAGE_ID : null,
    availability: "available",
    value_json: validProjectionFor(fixture),
    ...overrides,
  });
}

type FrozenPageIdentity = Awaited<
  ReturnType<
    PageSnapshotsRepository["listByDataSnapshotWithSitePageIdentity"]
  >
>[number];

function frozenPageIdentity(
  overrides: Partial<FrozenPageIdentity> = {},
): FrozenPageIdentity {
  const normalizedUrl = overrides.normalized_url ?? `${SITE_ORIGIN}/fixture`;
  const projection = {
    ...validProjectionFor(OBSERVATION_FIXTURES[0]),
    fetchUrl: normalizedUrl,
  };
  return {
    page_snapshot_id: CRAWL_PAGE_SNAPSHOT_ID,
    workspace_id: "workspace-1",
    project_id: "project-1",
    site_page_id: CRAWL_SITE_PAGE_ID,
    data_snapshot_id: FROZEN_SNAPSHOT_ID,
    content_hash: contentHash({ page: normalizedUrl }),
    canonical_extract: "{}",
    extract: {
      schemaVersion: "crawl.page-extract.v1",
      subjectUrl: `${SITE_ORIGIN}/fixture`,
      depth: 2,
      projection,
    },
    captured_at: FROZEN_AT,
    created_at: FROZEN_AT,
    normalized_url: normalizedUrl,
    normalized_url_hash: normalizedUrlHash(normalizedUrl),
    site_id: "site-1",
    ...overrides,
  };
}

type SitePageIdentity = Awaited<
  ReturnType<SitePagesRepository["findByIds"]>
>[number];

function sitePageIdentity(
  overrides: Partial<SitePageIdentity> = {},
): SitePageIdentity {
  const normalizedUrl = `${SITE_ORIGIN}/fixture/`;
  return {
    id: ANALYTICS_SITE_PAGE_ID,
    workspace_id: "workspace-1",
    project_id: "project-1",
    site_id: "site-1",
    normalized_url: normalizedUrl,
    normalized_url_hash: normalizedUrlHash(normalizedUrl),
    template_key: null,
    created_at: FROZEN_AT,
    updated_at: FROZEN_AT,
    ...overrides,
  };
}

async function runObservationValidationFixture(
  provider: SourceProvider,
  observation: ObservationRow,
  lineage: {
    readonly frozenPages?: readonly FrozenPageIdentity[];
    readonly sitePages?: readonly SitePageIdentity[];
    readonly governance?: unknown;
    readonly contextProjection?: unknown;
    readonly ruleSetVersion?: string;
    readonly source?: {
      readonly datasetKey: string;
      readonly schemaVersion?: string;
      readonly methodVersion: string;
    };
    readonly observations?: readonly ObservationRow[];
    readonly collectionOperation?: string;
  } = {},
): Promise<{
  readonly contextBuild: ReturnType<typeof vi.spyOn>;
  readonly terminal: ReturnType<typeof vi.spyOn>;
  readonly transaction: ReturnType<typeof vi.fn>;
  readonly errorLog: ReturnType<typeof vi.fn>;
  readonly frozenPages: ReturnType<typeof vi.spyOn>;
  readonly sitePages: ReturnType<typeof vi.spyOn>;
}> {
  const crawl = frozenSource("crawl");
  const source =
    provider === "crawl"
      ? crawl
      : frozenSource(provider, lineage.source);
  const manifests =
    provider === "crawl"
      ? [source.manifest]
      : [crawl.manifest, source.manifest];
  const snapshots =
    provider === "crawl"
      ? [source.snapshot]
      : [crawl.snapshot, source.snapshot];
  const fixture = diagnosticFixture({
    snapshots: manifests,
    ...(lineage.ruleSetVersion === undefined
      ? {}
      : { ruleSetVersion: lineage.ruleSetVersion }),
    ...(lineage.governance === undefined
      ? {}
      : { governance: lineage.governance }),
    ...(lineage.contextProjection === undefined
      ? {}
      : { contextProjection: lineage.contextProjection }),
  });
  const transaction = vi.fn();
  const ctx = unitContext(transaction);
  const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
  if (provider === "dataforseo") {
    vi.spyOn(
      CollectionRunsRepository.prototype,
      "findById",
    ).mockResolvedValue({
      id: source.snapshot.collection_run_id,
      workspace_id: "workspace-1",
      project_id: "project-1",
      site_id: "site-1",
      source_connection_id: null,
      import_preview_id: null,
      crawl_seed_site_page_id: null,
      crawl_seed_url: null,
      provider: "dataforseo",
      operation:
        lineage.collectionOperation ??
        (source.snapshot.dataset_key ===
          DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY ||
        source.snapshot.dataset_key ===
          DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY ||
        source.snapshot.dataset_key ===
          DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY
          ? "search_landscape"
          : "keyword_gap_import"),
      method_version: source.snapshot.method_version,
      parameters_hash: "a".repeat(64),
      row_count: 2,
      stop_reason: null,
      created_at: FROZEN_AT,
    });
  }
  vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue(
    snapshots,
  );
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
    validIcpRow(),
  );
  vi.spyOn(
    ProviderDiscrepanciesRepository.prototype,
    "listUnresolvedBySnapshotIds",
  ).mockResolvedValue([]);
  vi.spyOn(
    ObservationsRepository.prototype,
    "listBySnapshotIds",
  ).mockResolvedValue(
    lineage.observations === undefined
      ? [observation]
      : [...lineage.observations],
  );
  const value =
    typeof observation.value_json === "object" &&
    observation.value_json !== null &&
    !Array.isArray(observation.value_json)
      ? (observation.value_json as Record<string, unknown>)
      : null;
  const fetchUrl = value?.["fetchUrl"];
  const frozenPages =
    lineage.frozenPages ??
    (observation.provider === "crawl" &&
    observation.metric_key === "crawl.page.v1" &&
    observation.site_page_id !== null
      ? [
          frozenPageIdentity({
            site_page_id: observation.site_page_id,
            normalized_url:
              typeof fetchUrl === "string"
                ? fetchUrl
                : `${SITE_ORIGIN}/fixture`,
            normalized_url_hash: normalizedUrlHash(
              typeof fetchUrl === "string"
                ? fetchUrl
                : `${SITE_ORIGIN}/fixture`,
            ),
          }),
        ]
      : []);
  const frozenPagesRead = vi.spyOn(
    PageSnapshotsRepository.prototype,
    "listByDataSnapshotWithSitePageIdentity",
  ).mockResolvedValue([...frozenPages]);
  const sitePagesRead = vi
    .spyOn(SitePagesRepository.prototype, "findByIds")
    .mockImplementation(async (_scope, ids) =>
      lineage.sitePages !== undefined
        ? lineage.sitePages.filter((page) => ids.includes(page.id))
        : observation.site_page_id !== null &&
            ids.includes(observation.site_page_id) &&
            !frozenPages.some(
              (page) => page.site_page_id === observation.site_page_id,
            )
          ? [sitePageIdentity({ id: observation.site_page_id })]
          : [],
    );
  const contextBuild = vi.spyOn(DiagnosticContext, "build");

  await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

  return {
    contextBuild,
    terminal,
    transaction,
    errorLog: ctx.logger.error as ReturnType<typeof vi.fn>,
    frozenPages: frozenPagesRead,
    sitePages: sitePagesRead,
  };
}

function validIcpRow(): IcpProfileRow {
  return {
    id: "icp-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    version: 1,
    status: "complete",
    profile: {
      productName: "Acme",
      oneLineDescription: "Widgets.",
      siteLanguageCodes: ["en"],
      defaultDeliveryLocale: "en",
      marketCodes: ["US"],
    },
    content_hash: ICP_CONTENT_HASH,
    created_by: "actor-1",
    created_at: FROZEN_AT,
  };
}

function currentContextProjection(
  siteLanguageCodes: readonly string[] = ["en"],
) {
  return buildContextProjectionV1({
    profile: validIcpRow().profile,
    profileContentHash: ICP_CONTENT_HASH,
    siteLanguageCodes,
  });
}

function unitContext(transaction = vi.fn()): WorkerContext {
  const logger: Logger = {
    context: { service: "worker", environment: "test" },
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    db: { transaction } as unknown as WorkerContext["db"],
    logger,
    findingSummariesEnabled: false,
  } as WorkerContext;
}

function mockClaimedDiagnostic(
  run: AsyncRunRow,
  diagnostic: DiagnosticRunRow,
) {
  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
  vi.spyOn(
    DiagnosticRunsRepository.prototype,
    "findById",
  ).mockResolvedValue(diagnostic);
  vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue(
    validSiteRow(),
  );
  vi.spyOn(
    CollectionRunsRepository.prototype,
    "findById",
  ).mockImplementation(async (id) =>
    id === SOURCE_FIXTURE_CONFIG.dataforseo.collectionRunId
      ? {
          id,
          workspace_id: "workspace-1",
          project_id: "project-1",
          site_id: "site-1",
          source_connection_id: null,
          import_preview_id: null,
          crawl_seed_site_page_id: null,
          crawl_seed_url: null,
          provider: "dataforseo",
          operation: "keyword_gap_import",
          method_version: DATAFORSEO_METHOD_VERSION,
          parameters_hash: "a".repeat(64),
          row_count: 1,
          stop_reason: null,
          created_at: FROZEN_AT,
        }
      : null,
  );
  return vi
    .spyOn(AsyncRunsRepository.prototype, "setTerminal")
    .mockResolvedValue(true);
}

function governedContentGapProjection(
  review:
    | { readonly status: "approved"; readonly mappingReviewState: "confirmed" }
    | { readonly status: "candidate"; readonly mappingReviewState: "unreviewed" },
) {
  const observationId = (index: number) =>
    `71000000-0000-4000-8000-${(index + 1)
      .toString(16)
      .padStart(12, "0")}`;
  return {
    projectionVersion: GOVERNANCE_PROJECTION_VERSION,
    keywordClusters: [
      {
        clusterKey: "project management",
        keywords: Array.from({ length: 10 }, (_, index) => ({
          keywordEntityId: `72000000-0000-4000-8000-${(index + 1)
            .toString(16)
            .padStart(12, "0")}`,
          displayKeyword: `project management workflow ${index}`,
          normalizedKeyword: `project management workflow ${index}`,
          marketCode: "US",
          languageTag: "en",
          revision: 1,
          status: review.status,
          queryKind: "search_query",
          intent: "commercial",
          buyerStage: "consideration",
          clusterKey: "project management",
          mappingDecision: "new_asset",
          mappedSitePageId: null,
          mappingReviewState: review.mappingReviewState,
          lastSeenAt: FROZEN_AT,
          occurrenceRefs: [
            {
              occurrenceId: `73000000-0000-4000-8000-${(index + 1)
                .toString(16)
                .padStart(12, "0")}`,
              snapshotId: SOURCE_FIXTURE_CONFIG.dataforseo.snapshotId,
              observationId: observationId(index),
            },
          ],
          metricRefs: [],
        })),
      },
    ],
    competitors: [
      {
        competitorEntityId: "74000000-0000-4000-8000-000000000001",
        domain: "approved-competitor.example",
        reviewStatus: "approved",
        revision: 3,
        relationship: "direct",
        analysisScopes: ["keyword_gap", "serp_visibility"],
        originRefs: [
          {
            occurrenceId: "75000000-0000-4000-8000-000000000001",
            originKind: "manual",
            snapshotId: null,
            observationId: null,
          },
        ],
      },
    ],
  };
}

async function runGovernedContentGapFixture(
  review:
    | { readonly status: "approved"; readonly mappingReviewState: "confirmed" }
    | { readonly status: "candidate"; readonly mappingReviewState: "unreviewed" },
  ruleSetVersion: string = RULE_SET_VERSION,
) {
  const crawl = frozenSource("crawl");
  const dataforseo = frozenSource("dataforseo");
  const governance = governedContentGapProjection(review);
  const fixture = diagnosticFixture({
    snapshots: [crawl.manifest, dataforseo.manifest],
    ruleSetVersion,
    ...(ruleSetVersion === LEGACY_RULE_SET_VERSION ? {} : { governance }),
  });
  const transaction = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) => callback({}),
  );
  const ctx = unitContext(transaction);
  mockClaimedDiagnostic(fixture.run, fixture.diagnostic);

  vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
    crawl.snapshot,
    dataforseo.snapshot,
  ]);
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
    validIcpRow(),
  );
  vi.spyOn(
    ProviderDiscrepanciesRepository.prototype,
    "listUnresolvedBySnapshotIds",
  ).mockResolvedValue([]);

  const crawlObservation = availableObservationRow(
    OBSERVATION_FIXTURES[0],
    {
      id: "76000000-0000-4000-8000-000000000001",
      value_json: {
        ...validProjectionFor(OBSERVATION_FIXTURES[0]),
        title: "Pricing",
        metaDescription: "Transparent plans for the Acme workspace.",
        h1: ["Pricing"],
        headings: ["Plans"],
        wordCount: 1_200,
        sitemapMember: true,
        bodyExcerpt: "Compare Acme plans and choose the right workspace.",
        paragraphs: [
          "Compare Acme plans and choose the right workspace for your team.",
        ],
      },
    },
  );
  const dataforseoObservations = Array.from(
    { length: 10 },
    (_, index) =>
      observationRow("dataforseo", {
        id: `71000000-0000-4000-8000-${(index + 1)
          .toString(16)
          .padStart(12, "0")}`,
        subject_type: "keyword_cluster",
        subject_ref: "project management",
        availability: "available",
        value_json: {
          keyword: `project management workflow ${index}`,
          clusterKey: "project management",
          searchVolume: 100,
          keywordDifficulty: 37,
          providerSearchIntent: "commercial",
          currentUrl: `${SITE_ORIGIN}/rank-${index}`,
          currentRank: index + 1,
          competitorDomain: null,
          competitorRank: null,
          marketCode: "US",
          languageCode: "en",
        },
      }),
  );
  vi.spyOn(
    ObservationsRepository.prototype,
    "listBySnapshotIds",
  ).mockResolvedValue([crawlObservation, ...dataforseoObservations]);
  vi.spyOn(
    PageSnapshotsRepository.prototype,
    "listByDataSnapshotWithSitePageIdentity",
  ).mockResolvedValue([
    frozenPageIdentity({
      extract: {
        schemaVersion: "crawl.page-extract.v1",
        subjectUrl: crawlObservation.subject_ref,
        depth: 2,
        projection: crawlObservation.value_json,
      },
    }),
  ]);
  vi.spyOn(SitePagesRepository.prototype, "findByIds").mockResolvedValue([]);

  vi.spyOn(
    AsyncRunsRepository.prototype,
    "lockAttemptForUpdate",
  ).mockResolvedValue(fixture.run);
  vi.spyOn(
    ProjectsRepository.prototype,
    "findByIdForUpdate",
  ).mockResolvedValue({ archived_at: null } as never);
  vi.spyOn(
    ProjectsRepository.prototype,
    "setStage",
  ).mockResolvedValue(true);
  const ruleResultInsert = vi
    .spyOn(DiagnosticRunsRepository.prototype, "insertRuleResults")
    .mockResolvedValue(undefined);
  vi.spyOn(
    DiagnosticRunsRepository.prototype,
    "setCoverage",
  ).mockResolvedValue(undefined);
  vi.spyOn(FindingsRepository.prototype, "findByKey").mockResolvedValue(null);
  let insertedFindingCount = 0;
  const findingInsert = vi
    .spyOn(FindingsRepository.prototype, "insert")
    .mockImplementation(async () => {
      insertedFindingCount += 1;
      return {
        id: `77000000-0000-4000-8000-${insertedFindingCount
          .toString(16)
          .padStart(12, "0")}`,
      } as never;
    });
  const targetInsert = vi
    .spyOn(FindingTargetsRepository.prototype, "insertMany")
    .mockResolvedValue(1);
  let insertedEvidenceCount = 0;
  const evidenceInsert = vi
    .spyOn(EvidenceRepository.prototype, "insertMany")
    .mockImplementation(async (_values, rows) =>
      rows.map(() => {
        insertedEvidenceCount += 1;
        return `78000000-0000-4000-8000-${insertedEvidenceCount
          .toString(16)
          .padStart(12, "0")}`;
      }),
    );
  vi.spyOn(
    EvidenceRepository.prototype,
    "linkObservations",
  ).mockResolvedValue(undefined);
  vi.spyOn(
    AuditRunsRepository.prototype,
    "findByDiagnosticRunId",
  ).mockResolvedValue(null);
  vi.spyOn(TelemetryRepository.prototype, "emit").mockResolvedValue(undefined);

  const liveGovernanceReads = [
    vi.spyOn(KeywordsRepository.prototype, "listByProject"),
    vi.spyOn(KeywordsRepository.prototype, "listDiagnosticEligible"),
    vi.spyOn(KeywordOccurrencesRepository.prototype, "listForEntity"),
    vi.spyOn(KeywordOccurrencesRepository.prototype, "listForEntityIds"),
    vi.spyOn(CompetitorsRepository.prototype, "listByProject"),
    vi.spyOn(CompetitorsRepository.prototype, "listDiagnosticEligible"),
    vi.spyOn(CompetitorsRepository.prototype, "listOrigins"),
    vi.spyOn(
      CompetitorsRepository.prototype,
      "listOriginsForCompetitorIds",
    ),
  ];

  await runDiagnostic(ctx, {
    runId: fixture.run.id,
    ...fixture.scope,
  });

  return {
    findingInsert,
    targetInsert,
    evidenceInsert,
    ruleResultInsert,
    liveGovernanceReads,
  };
}

describe("diagnostic frozen snapshot validation", () => {
  it("requires an unambiguous frozen lineage mapping for every source-backed evidence provider", () => {
    const providers = ["crawl", "gsc", "ga4", "csv", "dataforseo"] as const;
    const lineageByProvider = new Map(
      providers.map((provider, index) => [
        provider,
        {
          snapshotId: `00000000-0000-4000-8000-0000000000${20 + index}`,
          collectionRunId: `00000000-0000-4000-8000-0000000000${30 + index}`,
        },
      ]),
    );

    for (const provider of providers) {
      expect(lineageForEvidenceProvider(provider, lineageByProvider)).toEqual(
        lineageByProvider.get(provider),
      );
    }
    expect(lineageForEvidenceProvider("system", lineageByProvider)).toBeNull();
    expect(lineageForEvidenceProvider("llm", lineageByProvider)).toBeNull();
    expect(() =>
      lineageForEvidenceProvider("ga4", new Map()),
    ).toThrowError(/lineage/i);
  });

  it("passes the frozen governance projection to Context without live library reads", async () => {
    const governance = {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [
        {
          competitorEntityId: "70000000-0000-4000-8000-000000000001",
          domain: "competitor.example",
          reviewStatus: "approved",
          revision: 2,
          relationship: "direct",
          analysisScopes: ["keyword_gap", "serp_visibility"],
          originRefs: [
            {
              occurrenceId: "70000000-0000-4000-8000-000000000002",
              originKind: "manual",
              snapshotId: null,
              observationId: null,
            },
          ],
        },
      ],
    };
    const keywordRead = vi
      .spyOn(KeywordsRepository.prototype, "listByProject")
      .mockRejectedValue(new Error("worker must not read the live library"));
    const occurrenceRead = vi
      .spyOn(KeywordOccurrencesRepository.prototype, "listForEntity")
      .mockRejectedValue(new Error("worker must not read the live library"));
    const competitorRead = vi
      .spyOn(CompetitorsRepository.prototype, "listByProject")
      .mockRejectedValue(new Error("worker must not read the live library"));
    const originRead = vi
      .spyOn(CompetitorsRepository.prototype, "listOrigins")
      .mockRejectedValue(new Error("worker must not read the live library"));

    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(OBSERVATION_FIXTURES[0]),
      { governance },
    );

    expect(result.contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({ governance }),
    );
    expect(keywordRead).not.toHaveBeenCalled();
    expect(occurrenceRead).not.toHaveBeenCalled();
    expect(competitorRead).not.toHaveBeenCalled();
    expect(originRead).not.toHaveBeenCalled();
    expect(result.transaction).toHaveBeenCalledOnce();
    expect(result.terminal).not.toHaveBeenCalled();
  });

  it.each([
    ["0.2.2", GOVERNED_LEGACY_RULE_SET_VERSION],
    ["0.2.3", LINKGRAPH_LEGACY_RULE_SET_VERSION],
  ] as const)(
    "replays the governed %s manifest without synthesizing a context projection",
    async (_generation, ruleSetVersion) => {
      const result = await runObservationValidationFixture(
        "crawl",
        availableObservationRow(OBSERVATION_FIXTURES[0]),
        { ruleSetVersion },
      );

      const contextInput = result.contextBuild.mock.calls[0]?.[0];
      expect(contextInput).not.toHaveProperty("contextProjection");
      expect(contextInput).toHaveProperty("governance");
      expect(result.transaction).toHaveBeenCalledOnce();
      expect(result.terminal).not.toHaveBeenCalled();
    },
  );

  it("persists CONTENT-GAP-011@2 from frozen approved governance with keyword-cluster target and competitor context", async () => {
    const result = await runGovernedContentGapFixture({
      status: "approved",
      mappingReviewState: "confirmed",
    });
    const contentGapWrites = result.findingInsert.mock.calls.filter(
      ([values]) => values.ruleId === "CONTENT-GAP-011",
    );

    expect(contentGapWrites).toHaveLength(1);
    expect(contentGapWrites[0]?.[0]).toMatchObject({
      ruleId: "CONTENT-GAP-011",
      ruleVersion: 2,
      subjectRefs: ["keyword_cluster:project management"],
      titleArgs: {
        clusterKey: "project management",
        keywordCount: 10,
        totalVolume: 1_000,
      },
    });
    expect(
      result.targetInsert.mock.calls.flatMap(([, rows]) => rows),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: "affected_by_keyword_cluster",
          targetKind: "keyword_cluster",
          targetRef: "project management",
        }),
      ]),
    );
    const evidenceRows = result.evidenceInsert.mock.calls.flatMap(
      ([, rows]) => rows,
    );
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceProvider: "system",
          support: "supports",
          claim: expect.stringContaining(
            "10 approved, confirmed facts",
          ),
        }),
        expect.objectContaining({
          sourceProvider: "system",
          support: "context",
          claim: expect.stringContaining(
            "74000000-0000-4000-8000-000000000001",
          ),
        }),
      ]),
    );
    expect(
      result.ruleResultInsert.mock.calls
        .flatMap(([, rows]) => rows)
        .find((row) => row.ruleId === "CONTENT-GAP-011"),
    ).toMatchObject({
      ruleVersion: 2,
      status: "candidate",
    });
    for (const read of result.liveGovernanceReads) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it.each([
    {
      status: "candidate",
      mappingReviewState: "unreviewed",
    },
  ] as const)(
    "does not persist CONTENT-GAP-011 when frozen keyword governance is $status/$mappingReviewState",
    async (review) => {
      const result = await runGovernedContentGapFixture(review);

      expect(
        result.findingInsert.mock.calls.some(
          ([values]) => values.ruleId === "CONTENT-GAP-011",
        ),
      ).toBe(false);
      for (const read of result.liveGovernanceReads) {
        expect(read).not.toHaveBeenCalled();
      }
    },
  );

  it("replays a genuine 0.2.1 manifest without governance as CONTENT-GAP-011@1", async () => {
    const result = await runGovernedContentGapFixture(
      {
        status: "approved",
        mappingReviewState: "confirmed",
      },
      LEGACY_RULE_SET_VERSION,
    );

    expect(
      result.findingInsert.mock.calls
        .map(([values]) => values)
        .find((values) => values.ruleId === "CONTENT-GAP-011"),
    ).toMatchObject({
      ruleId: "CONTENT-GAP-011",
      ruleVersion: 1,
      subjectRefs: ["keyword_cluster:project management"],
    });
    expect(
      result.ruleResultInsert.mock.calls
        .flatMap(([, rows]) => rows)
        .find((row) => row.ruleId === "CONTENT-GAP-011"),
    ).toMatchObject({
      ruleVersion: 1,
      status: "candidate",
    });
  });

  it("rejects a current 0.2.4 manifest that omits mandatory governance", async () => {
    const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
    const { governance: _governance, ...manifestWithoutGovernance } =
      fixture.diagnostic.input_manifest;
    const diagnostic = {
      ...fixture.diagnostic,
      input_manifest: manifestWithoutGovernance,
      input_hash: contentHash(
        manifestWithoutGovernance as unknown as CanonicalValue,
      ),
    } satisfies DiagnosticRunRow;
    const transaction = vi.fn();
    const ctx = unitContext(transaction);
    const terminal = mockClaimedDiagnostic(fixture.run, diagnostic);
    const snapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    );
    const contextBuild = vi.spyOn(DiagnosticContext, "build");

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(snapshots).not.toHaveBeenCalled();
    expect(contextBuild).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("rejects a current 0.2.4 manifest that omits its mandatory context projection", async () => {
    const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
    const { contextProjection: _contextProjection, ...manifestWithoutContext } =
      fixture.diagnostic.input_manifest;
    const diagnostic = {
      ...fixture.diagnostic,
      input_manifest: manifestWithoutContext,
      input_hash: contentHash(
        manifestWithoutContext as unknown as CanonicalValue,
      ),
    } satisfies DiagnosticRunRow;
    const transaction = vi.fn();
    const ctx = unitContext(transaction);
    const terminal = mockClaimedDiagnostic(fixture.run, diagnostic);
    const snapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    );
    const contextBuild = vi.spyOn(DiagnosticContext, "build");

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(snapshots).not.toHaveBeenCalled();
    expect(contextBuild).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it.each([
    {
      corruption: "extra root field",
      contextProjection: {
        ...currentContextProjection(),
        unexpected: true,
      },
    },
    {
      corruption: "schema version drift",
      contextProjection: {
        ...currentContextProjection(),
        schemaVersion: "context-projection.v999",
      },
    },
    {
      corruption: "compiler version drift",
      contextProjection: {
        ...currentContextProjection(),
        compilerVersion: "context-projection.compiler.999",
      },
    },
  ])(
    "rejects current context projection $corruption before loading snapshots",
    async ({ contextProjection }) => {
      const fixture = diagnosticFixture({
        snapshots: [manifestEntry()],
        contextProjection,
      });
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(
        fixture.run,
        fixture.diagnostic,
      );
      const snapshots = vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      );
      const contextBuild = vi.spyOn(DiagnosticContext, "build");

      await runDiagnostic(ctx, {
        runId: fixture.run.id,
        ...fixture.scope,
      });

      expect(snapshots).not.toHaveBeenCalled();
      expect(contextBuild).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          status: "failed",
          lastErrorCode: "UNAVAILABLE",
        }),
      );
    },
  );

  it("rejects a 0.2.3 manifest that carries a context projection it never authorized", async () => {
    const fixture = diagnosticFixture({
      snapshots: [manifestEntry()],
      ruleSetVersion: LINKGRAPH_LEGACY_RULE_SET_VERSION,
      contextProjection: currentContextProjection(),
    });
    const ctx = unitContext();
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    const snapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    );

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(snapshots).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("rejects a changed current context projection when the frozen input hash was not updated", async () => {
    const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
    const diagnostic = {
      ...fixture.diagnostic,
      input_manifest: {
        ...fixture.diagnostic.input_manifest,
        contextProjection: currentContextProjection([]),
      },
    } satisfies DiagnosticRunRow;
    const ctx = unitContext();
    const terminal = mockClaimedDiagnostic(fixture.run, diagnostic);
    const snapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    );

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(snapshots).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("rejects a self-consistent context whose profile-derived facts no longer match the frozen ICP source", async () => {
    const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
    const ctx = unitContext();
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      snapshotRow(),
    ]);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
      ...validIcpRow(),
      profile: {
        ...validIcpRow().profile,
        productName: "Mutated after the run was frozen",
      },
    });
    const observations = vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    );
    const contextBuild = vi.spyOn(DiagnosticContext, "build");

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(observations).not.toHaveBeenCalled();
    expect(contextBuild).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  });

  it("rejects a current context whose frozen profile generation no longer matches its ICP source", async () => {
    const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
    const ctx = unitContext();
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      snapshotRow(),
    ]);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
      ...validIcpRow(),
      profile: {
        profileSchemaVersion: "product-profile.0.3.0",
        productName: "Acme",
        oneLiner: "Widgets.",
        productType: "software",
        businessModels: [],
        targetMarkets: [],
        targetAudiences: [],
      },
    });
    const observations = vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    );
    const contextBuild = vi.spyOn(DiagnosticContext, "build");

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(observations).not.toHaveBeenCalled();
    expect(contextBuild).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  });

  it("replays the frozen empty Site-language state without mutable Site or delivery-locale fallback", async () => {
    const contextProjection = currentContextProjection([]);
    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(OBSERVATION_FIXTURES[0]),
      { contextProjection },
    );

    expect(result.contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        contextProjection,
        deliveryLocale: "en",
        icp: expect.objectContaining({
          siteLanguageCodes: [],
          defaultDeliveryLocale: "",
        }),
      }),
    );
    const context = result.contextBuild.mock.results[0]?.value;
    expect(context).toBeInstanceOf(DiagnosticContext);
    expect(context?.isEnglish()).toBe(false);
    expect(result.transaction).toHaveBeenCalledOnce();
    expect(result.terminal).not.toHaveBeenCalled();
  });

  it("rejects a 0.2.1 manifest that carries governance it never authorized", async () => {
    const fixture = diagnosticFixture({
      snapshots: [manifestEntry()],
      ruleSetVersion: LEGACY_RULE_SET_VERSION,
      governance: {
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors: [],
      },
    });
    const ctx = unitContext();
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    const snapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    );

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(snapshots).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("rejects a malformed frozen governance block before loading snapshots or building Context", async () => {
    const fixture = diagnosticFixture({
      snapshots: [manifestEntry()],
      governance: {
        projectionVersion: GOVERNANCE_PROJECTION_VERSION,
        keywordClusters: [],
        competitors: [],
        unexpected: true,
      },
    });
    const ctx = unitContext();
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    const snapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    );
    const contextBuild = vi.spyOn(DiagnosticContext, "build");

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(snapshots).not.toHaveBeenCalled();
    expect(contextBuild).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  });

  it("passes exact immutable Crawl observation, SitePage, and PageSnapshot identities into Context", async () => {
    const exactFetchUrl = `${SITE_ORIGIN}/fixture/`;
    const observation = availableObservationRow(OBSERVATION_FIXTURES[0], {
      subject_ref: `${SITE_ORIGIN}/fixture`,
      value_json: {
        ...validProjectionFor(OBSERVATION_FIXTURES[0]),
        fetchUrl: exactFetchUrl,
      },
    });

    const result = await runObservationValidationFixture(
      "crawl",
      observation,
    );

    expect(result.frozenPages).toHaveBeenCalledOnce();
    expect(result.frozenPages).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", projectId: "project-1" },
      FROZEN_SNAPSHOT_ID,
    );
    expect(result.sitePages).not.toHaveBeenCalled();
    expect(result.contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [
          expect.objectContaining({
            observationId: observation.id,
            snapshotId: FROZEN_SNAPSHOT_ID,
            sitePageId: CRAWL_SITE_PAGE_ID,
            sitePageUrl: exactFetchUrl,
            pageSnapshotId: CRAWL_PAGE_SNAPSHOT_ID,
            subjectRef: `${SITE_ORIGIN}/fixture`,
            crawlDepth: 2,
          }),
        ],
      }),
    );
  });

  it("accepts one immutable instant rendered with different explicit time zones", async () => {
    const offsetInstant = "2026-07-19 08:00:00.000000+08";
    const observation = availableObservationRow(OBSERVATION_FIXTURES[0], {
      observed_at: offsetInstant,
    });
    const result = await runObservationValidationFixture(
      "crawl",
      observation,
      {
        frozenPages: [frozenPageIdentity({ captured_at: offsetInstant })],
      },
    );

    expect(result.contextBuild).toHaveBeenCalledOnce();
    expect(result.contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [
          expect.objectContaining({
            observationId: observation.id,
            observedAt: offsetInstant,
          }),
        ],
      }),
    );
  });

  it("preserves a canonical GSC subject separately from its exact slash SitePage identity", async () => {
    const observation = availableObservationRow(OBSERVATION_FIXTURES[3], {
      site_page_id: ANALYTICS_SITE_PAGE_ID,
      subject_ref: `${SITE_ORIGIN}/fixture`,
    });

    const result = await runObservationValidationFixture("gsc", observation);

    expect(result.frozenPages).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", projectId: "project-1" },
      FROZEN_SNAPSHOT_ID,
    );
    expect(result.sitePages).toHaveBeenCalledWith(
      { workspaceId: "workspace-1", projectId: "project-1" },
      [ANALYTICS_SITE_PAGE_ID],
    );
    expect(result.contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [
          expect.objectContaining({
            observationId: observation.id,
            snapshotId: SOURCE_FIXTURE_CONFIG.gsc.snapshotId,
            subjectRef: `${SITE_ORIGIN}/fixture`,
            sitePageId: ANALYTICS_SITE_PAGE_ID,
            sitePageUrl: `${SITE_ORIGIN}/fixture/`,
            pageSnapshotId: null,
          }),
        ],
      }),
    );
  });

  it("reuses the real frozen Crawl PageSnapshot when analytics references the same SitePage", async () => {
    const exactUrl = `${SITE_ORIGIN}/fixture/`;
    const observation = availableObservationRow(OBSERVATION_FIXTURES[3], {
      site_page_id: CRAWL_SITE_PAGE_ID,
      subject_ref: `${SITE_ORIGIN}/fixture`,
    });
    const result = await runObservationValidationFixture("gsc", observation, {
      frozenPages: [
        frozenPageIdentity({
          normalized_url: exactUrl,
          normalized_url_hash: normalizedUrlHash(exactUrl),
        }),
      ],
    });

    expect(result.sitePages).not.toHaveBeenCalled();
    expect(result.contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [
          expect.objectContaining({
            observationId: observation.id,
            snapshotId: SOURCE_FIXTURE_CONFIG.gsc.snapshotId,
            sitePageId: CRAWL_SITE_PAGE_ID,
            sitePageUrl: exactUrl,
            pageSnapshotId: CRAWL_PAGE_SNAPSHOT_ID,
          }),
        ],
      }),
    );
  });

  it("keeps a GSC URL with deliberately null SitePage lineage explicitly unresolved", async () => {
    const observation = availableObservationRow(OBSERVATION_FIXTURES[3], {
      site_page_id: null,
    });

    const result = await runObservationValidationFixture("gsc", observation);

    expect(result.sitePages).not.toHaveBeenCalled();
    expect(result.contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [
          expect.objectContaining({
            observationId: observation.id,
            snapshotId: SOURCE_FIXTURE_CONFIG.gsc.snapshotId,
            sitePageId: null,
            sitePageUrl: null,
            pageSnapshotId: null,
          }),
        ],
      }),
    );
  });

  it("loads observation-only SitePage identities in bounded deterministic chunks", async () => {
    const crawl = frozenSource("crawl");
    const gsc = frozenSource("gsc");
    const fixture = diagnosticFixture({
      snapshots: [crawl.manifest, gsc.manifest],
    });
    const observations = Array.from(
      { length: MAX_SITE_PAGE_ID_LOOKUP + 1 },
      (_, index) => {
        const suffix = (index + 100).toString().padStart(12, "0");
        return availableObservationRow(OBSERVATION_FIXTURES[3], {
          id: `00000000-0000-4000-8000-${suffix}`,
          site_page_id: `10000000-0000-4000-8000-${suffix}`,
          subject_ref: `${SITE_ORIGIN}/fixture-${index}`,
        });
      },
    );
    const pageById = new Map(
      observations.map((observation, index) => {
        const normalizedUrl = `${SITE_ORIGIN}/fixture-${index}`;
        return [
          observation.site_page_id!,
          sitePageIdentity({
            id: observation.site_page_id!,
            normalized_url: normalizedUrl,
            normalized_url_hash: normalizedUrlHash(normalizedUrl),
          }),
        ];
      }),
    );
    const transaction = vi.fn();
    const ctx = unitContext(transaction);
    mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      crawl.snapshot,
      gsc.snapshot,
    ]);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
      validIcpRow(),
    );
    vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    ).mockResolvedValue(observations);
    vi.spyOn(
      PageSnapshotsRepository.prototype,
      "listByDataSnapshotWithSitePageIdentity",
    ).mockResolvedValue([]);
    const sitePagesRead = vi
      .spyOn(SitePagesRepository.prototype, "findByIds")
      .mockImplementation(async (_scope, ids) =>
        ids.map((id) => pageById.get(id)!),
      );
    vi.spyOn(
      ProviderDiscrepanciesRepository.prototype,
      "listUnresolvedBySnapshotIds",
    ).mockResolvedValue([]);
    const contextBuild = vi.spyOn(DiagnosticContext, "build");

    await runDiagnostic(ctx, {
      runId: fixture.run.id,
      ...fixture.scope,
    });

    expect(sitePagesRead).toHaveBeenCalledTimes(2);
    expect(sitePagesRead.mock.calls[0]?.[1]).toHaveLength(
      MAX_SITE_PAGE_ID_LOOKUP,
    );
    expect(sitePagesRead.mock.calls[1]?.[1]).toHaveLength(1);
    expect(contextBuild).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("fails closed before Context and transaction when a non-null observation SitePage is missing", async () => {
    const observation = availableObservationRow(OBSERVATION_FIXTURES[3], {
      site_page_id: ANALYTICS_SITE_PAGE_ID,
    });

    const result = await runObservationValidationFixture("gsc", observation, {
      frozenPages: [],
      sitePages: [],
    });

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
    expect(result.terminal).toHaveBeenCalledWith(
      expect.any(Object),
      {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      },
    );
  });

  it.each([
    { provider: "gsc", fixture: OBSERVATION_FIXTURES[3] },
    { provider: "ga4", fixture: OBSERVATION_FIXTURES[4] },
  ] as const)(
    "fails closed when $provider points at a same-Site page outside its canonical exact candidates",
    async ({ provider, fixture }) => {
      const observation = availableObservationRow(fixture, {
        site_page_id: ANALYTICS_SITE_PAGE_ID,
        subject_ref: `${SITE_ORIGIN}/pricing`,
      });
      const wrongUrl = `${SITE_ORIGIN}/about/`;

      const result = await runObservationValidationFixture(
        provider,
        observation,
        {
          frozenPages: [],
          sitePages: [
            sitePageIdentity({
              normalized_url: wrongUrl,
              normalized_url_hash: normalizedUrlHash(wrongUrl),
            }),
          ],
        },
      );

      expect(result.contextBuild).not.toHaveBeenCalled();
      expect(result.transaction).not.toHaveBeenCalled();
    },
  );

  it("fails closed before Context when a Crawl page lacks its exact frozen PageSnapshot", async () => {
    const observation = availableObservationRow(OBSERVATION_FIXTURES[0]);

    const result = await runObservationValidationFixture(
      "crawl",
      observation,
      {
        frozenPages: [],
        sitePages: [sitePageIdentity({ id: CRAWL_SITE_PAGE_ID })],
      },
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when a Crawl page cannot prove its exact fetch projection", async () => {
    const observation = observationRow("crawl", {
      metric_key: "crawl.page.v1",
      subject_type: "url",
      subject_ref: `${SITE_ORIGIN}/fixture`,
      site_page_id: CRAWL_SITE_PAGE_ID,
    });

    const result = await runObservationValidationFixture(
      "crawl",
      observation,
      { frozenPages: [frozenPageIdentity()] },
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      corruption: "foreign workspace",
      page: frozenPageIdentity({ workspace_id: "workspace-2" }),
    },
    {
      corruption: "foreign project",
      page: frozenPageIdentity({ project_id: "project-2" }),
    },
    {
      corruption: "foreign Site",
      page: frozenPageIdentity({ site_id: "site-2" }),
    },
    {
      corruption: "different DataSnapshot",
      page: frozenPageIdentity({
        data_snapshot_id: "00000000-0000-4000-8000-000000000099",
      }),
    },
  ])(
    "rejects a frozen Crawl PageSnapshot with $corruption before Context",
    async ({ page }) => {
      const result = await runObservationValidationFixture(
        "crawl",
        availableObservationRow(OBSERVATION_FIXTURES[0]),
        { frozenPages: [page] },
      );

      expect(result.contextBuild).not.toHaveBeenCalled();
      expect(result.transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects duplicate frozen Crawl SitePage mappings before Context", async () => {
    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(OBSERVATION_FIXTURES[0]),
      {
        frozenPages: [
          frozenPageIdentity(),
          frozenPageIdentity({
            page_snapshot_id: "00000000-0000-4000-8000-000000000098",
          }),
        ],
      },
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
  });

  it("rejects a frozen PageSnapshot mapped to more than one SitePage", async () => {
    const secondUrl = `${SITE_ORIGIN}/other`;
    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(OBSERVATION_FIXTURES[0]),
      {
        frozenPages: [
          frozenPageIdentity(),
          frozenPageIdentity({
            site_page_id: "00000000-0000-4000-8000-000000000097",
            normalized_url: secondUrl,
            normalized_url_hash: normalizedUrlHash(secondUrl),
          }),
        ],
      },
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      corruption: "provider",
      manifest: manifestEntry(),
      actual: snapshotRow({ provider: "ga4" }),
    },
    {
      corruption: "availability",
      manifest: manifestEntry({ availability: "partial" }),
      actual: snapshotRow(),
    },
    {
      corruption: "capturedAt",
      manifest: manifestEntry({ capturedAt: "2026-07-18T00:00:00.000Z" }),
      actual: snapshotRow(),
    },
    {
      corruption: "datasetKey",
      manifest: manifestEntry({ datasetKey: "crawl.other.v1" }),
      actual: snapshotRow(),
    },
    {
      corruption: "schemaVersion",
      manifest: manifestEntry({ schemaVersion: "crawl.schema.v999" }),
      actual: snapshotRow(),
    },
    {
      corruption: "methodVersion",
      manifest: manifestEntry(),
      actual: snapshotRow({ method_version: "crawl.site_graph.v1" }),
    },
    {
      corruption: "checksum",
      manifest: manifestEntry({ checksum: "forged-checksum" }),
      actual: snapshotRow(),
    },
    {
      corruption: "sourceWindow",
      manifest: manifestEntry({
        sourceWindow: { start: FROZEN_AT, end: FROZEN_AT },
      }),
      actual: snapshotRow(),
    },
    {
      corruption: "site identity",
      manifest: manifestEntry(),
      actual: snapshotRow({ site_id: "site-2" }),
    },
  ])(
    "fails before loading observations when manifest $corruption disagrees with the immutable snapshot",
    async ({ manifest, actual }) => {
      const { scope, run, diagnostic } = diagnosticFixture({
        snapshots: [manifest],
      });
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(run, diagnostic);
      const snapshots = vi
        .spyOn(DataSnapshotsRepository.prototype, "findByIds")
        .mockResolvedValue([actual]);
      const icp = vi
        .spyOn(IcpProfilesRepository.prototype, "findById")
        .mockResolvedValue(validIcpRow());
      const observations = vi
        .spyOn(ObservationsRepository.prototype, "listBySnapshotIds")
        .mockResolvedValue([]);

      await runDiagnostic(ctx, { runId: run.id, ...scope });

      expect(snapshots).toHaveBeenCalledWith(scope, [FROZEN_SNAPSHOT_ID]);
      expect(icp).not.toHaveBeenCalled();
      expect(observations).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(run), {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      });
    },
  );

  it("rejects an obsolete crawl snapshot that cannot preserve exact URL variants", async () => {
    const fixture = diagnosticFixture({
      snapshots: [manifestEntry({ methodVersion: "crawl.site_graph.v1" })],
    });
    const ctx = unitContext();
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    const snapshots = vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    );

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(snapshots).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  });

  it.each([
    {
      frozenVersion: "legacy rule set",
      ruleSetVersion: "mvp.rules.0.2.0",
      promptSetVersion: PROMPT_SET_VERSION,
    },
    {
      frozenVersion: "unsupported prompt set",
      ruleSetVersion: RULE_SET_VERSION,
      promptSetVersion: "mvp.prompts.0.1.0",
    },
  ])(
    "terminalizes a frozen $frozenVersion with a stable error before reading snapshots",
    async ({ ruleSetVersion, promptSetVersion }) => {
      const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
      const unsupportedManifest = {
        ...fixture.diagnostic.input_manifest,
        ruleSetVersion,
        promptSetVersion,
      };
      const unsupportedDiagnostic = {
        ...fixture.diagnostic,
        rule_set_version: ruleSetVersion,
        prompt_set_version: promptSetVersion,
        input_manifest: unsupportedManifest,
        input_hash: contentHash(unsupportedManifest),
      } satisfies DiagnosticRunRow;
      const transaction = vi.fn();
      const ctx = unitContext(transaction);
      const terminal = mockClaimedDiagnostic(
        fixture.run,
        unsupportedDiagnostic,
      );
      const snapshots = vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      );

      await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

      expect(snapshots).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
        status: "failed",
        lastErrorCode: "DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED",
        lastErrorSummary:
          "The frozen diagnostic executor version is unsupported.",
      });
    },
  );

  it.each([
    {
      corruption: "input hash",
      mutate: (diagnostic: DiagnosticRunRow): DiagnosticRunRow => ({
        ...diagnostic,
        input_hash: contentHash({ forged: true }),
      }),
    },
    {
      corruption: "manifest project identity",
      mutate: (diagnostic: DiagnosticRunRow): DiagnosticRunRow => ({
        ...diagnostic,
        input_manifest: {
          ...diagnostic.input_manifest,
          projectId: "project-forged",
        },
        input_hash: contentHash({
          ...diagnostic.input_manifest,
          projectId: "project-forged",
        }),
      }),
    },
    {
      corruption: "manifest locale",
      mutate: (diagnostic: DiagnosticRunRow): DiagnosticRunRow => ({
        ...diagnostic,
        input_manifest: {
          ...diagnostic.input_manifest,
          deliveryLocale: "fr",
        },
        input_hash: contentHash({
          ...diagnostic.input_manifest,
          deliveryLocale: "fr",
        }),
      }),
    },
  ])(
    "rejects $corruption before reading any snapshot",
    async ({ mutate }) => {
      const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
      const diagnostic = mutate(fixture.diagnostic);
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(fixture.run, diagnostic);
      const snapshots = vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      );

      await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

      expect(snapshots).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      });
    },
  );

  it.each([
    ["content hash", { content_hash: "forged-icp-hash" }],
    ["version", { version: 2 }],
    ["completion status", { status: "draft" }],
  ] as const)(
    "rejects frozen ICP %s drift before loading observations",
    async (_corruption, icpDrift) => {
      const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
      vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      ).mockResolvedValue([snapshotRow()]);
      vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue({
        ...validIcpRow(),
        ...icpDrift,
      });
      const observations = vi.spyOn(
        ObservationsRepository.prototype,
        "listBySnapshotIds",
      );

      await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

      expect(observations).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      });
    },
  );

  it.each([
    {
      duplication: "provider",
      entries: [
        manifestEntry(),
        manifestEntry({
          snapshotId: "00000000-0000-4000-8000-000000000012",
        }),
      ],
    },
    {
      duplication: "snapshot id",
      entries: [manifestEntry(), manifestEntry({ provider: "ga4" })],
    },
    {
      duplication: "keyword-gap slot",
      entries: [
        manifestEntry({ provider: "csv" }),
        manifestEntry({
          snapshotId: "00000000-0000-4000-8000-000000000012",
          provider: "dataforseo",
        }),
      ],
    },
  ])(
    "rejects duplicate $duplication selections before snapshot lookup",
    async ({ entries }) => {
      const { scope, run, diagnostic } = diagnosticFixture({
        snapshots: entries,
      });
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(run, diagnostic);
      const snapshots = vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      );
      const icp = vi.spyOn(IcpProfilesRepository.prototype, "findById");

      await runDiagnostic(ctx, { runId: run.id, ...scope });

      expect(snapshots).not.toHaveBeenCalled();
      expect(icp).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(run), {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      });
    },
  );

  it("fails closed when an observation provider drifts from its selected snapshot", async () => {
    const { scope, run, diagnostic } = diagnosticFixture({
      snapshots: [manifestEntry()],
    });
    const transaction = vi.fn();
    const ctx = unitContext(transaction);
    const terminal = mockClaimedDiagnostic(run, diagnostic);
    vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    ).mockResolvedValue([snapshotRow()]);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
      validIcpRow(),
    );
    vi.spyOn(
      ProviderDiscrepanciesRepository.prototype,
      "listUnresolvedBySnapshotIds",
    ).mockResolvedValue([]);
    vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    ).mockResolvedValue([
      {
        id: "observation-1",
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        snapshot_id: FROZEN_SNAPSHOT_ID,
        site_page_id: null,
        provider: "ga4",
        metric_key: "ga4.landing.v1",
        subject_type: "url",
        subject_ref: "https://example.com/",
        observed_at: FROZEN_AT,
        availability: "available",
        value_numeric: null,
        value_text: null,
        value_json: {
          sessions: 10,
          engagedSessions: null,
          engagementRate: null,
          keyEvents: 1,
          keyEventUnavailableReason: null,
        },
        unit: null,
        origin: "first_party",
        method: "observed",
        grade: "A",
        support: "supports",
        limitation: "unit fixture",
      } satisfies ObservationRow,
    ]);

    await runDiagnostic(ctx, { runId: run.id, ...scope });

    expect(transaction).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(toRunAttempt(run), {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  });

  it.each(SOURCE_PROVIDERS)(
    "rejects a self-consistent %s snapshot with an unregistered dataset before loading its ICP",
    async (provider) => {
      const crawl = frozenSource("crawl");
      const corrupted = frozenSource(provider, {
        datasetKey: "forged.dataset.v1",
      });
      const manifests =
        provider === "crawl"
          ? [corrupted.manifest]
          : [crawl.manifest, corrupted.manifest];
      const snapshots =
        provider === "crawl"
          ? [corrupted.snapshot]
          : [crawl.snapshot, corrupted.snapshot];
      const fixture = diagnosticFixture({ snapshots: manifests });
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
      vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      ).mockResolvedValue(snapshots);
      const icp = vi.spyOn(IcpProfilesRepository.prototype, "findById");

      await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

      expect(icp).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      });
    },
  );

  it.each(SOURCE_PROVIDERS)(
    "rejects a self-consistent %s snapshot with an unregistered method before loading its ICP",
    async (provider) => {
      const crawl = frozenSource("crawl");
      const corrupted = frozenSource(provider, {
        methodVersion: "forged.method.v1",
      });
      const manifests =
        provider === "crawl"
          ? [corrupted.manifest]
          : [crawl.manifest, corrupted.manifest];
      const snapshots =
        provider === "crawl"
          ? [corrupted.snapshot]
          : [crawl.snapshot, corrupted.snapshot];
      const fixture = diagnosticFixture({ snapshots: manifests });
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
      vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      ).mockResolvedValue(snapshots);
      const icp = vi.spyOn(IcpProfilesRepository.prototype, "findById");

      await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

      expect(icp).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      });
    },
  );

  it.each(SOURCE_PROVIDERS)(
    "rejects a self-consistent %s snapshot with an unregistered schema before loading its ICP",
    async (provider) => {
      const crawl = frozenSource("crawl");
      const corrupted = frozenSource(provider, {
        schemaVersion: "forged.schema.v1",
      });
      const manifests =
        provider === "crawl"
          ? [corrupted.manifest]
          : [crawl.manifest, corrupted.manifest];
      const snapshots =
        provider === "crawl"
          ? [corrupted.snapshot]
          : [crawl.snapshot, corrupted.snapshot];
      const fixture = diagnosticFixture({ snapshots: manifests });
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
      vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      ).mockResolvedValue(snapshots);
      const icp = vi.spyOn(IcpProfilesRepository.prototype, "findById");

      await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

      expect(icp).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      });
    },
  );

  it.each([
    {
      mismatch: "legacy CSV dataset with the DataForSEO method",
      datasetKey: "csv.keyword_gap.v1",
      methodVersion: DATAFORSEO_METHOD_VERSION,
    },
    {
      mismatch: "DataForSEO dataset with the CSV method",
      datasetKey: DATAFORSEO_DATASET_KEY,
      methodVersion: "csv.keyword_gap.v1",
    },
    {
      mismatch: "legacy DataForSEO dataset with the composite method",
      datasetKey: DATAFORSEO_DATASET_KEY,
      methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
    },
    {
      mismatch: "composite DataForSEO dataset with the legacy method",
      datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
      methodVersion: DATAFORSEO_METHOD_VERSION,
    },
  ])(
    "rejects a self-consistent DataForSEO snapshot using $mismatch before loading its ICP",
    async ({ datasetKey, methodVersion }) => {
      const crawl = frozenSource("crawl");
      const dataforseo = frozenSource("dataforseo", {
        datasetKey,
        methodVersion,
      });
      const fixture = diagnosticFixture({
        snapshots: [crawl.manifest, dataforseo.manifest],
      });
      const ctx = unitContext();
      const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
      vi.spyOn(
        DataSnapshotsRepository.prototype,
        "findByIds",
      ).mockResolvedValue([crawl.snapshot, dataforseo.snapshot]);
      const icp = vi.spyOn(IcpProfilesRepository.prototype, "findById");

      await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

      expect(icp).not.toHaveBeenCalled();
      expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      });
    },
  );

  it("rejects the DataForSEO Snapshot dataset key when it is reused as an Observation metric", async () => {
    const result = await runObservationValidationFixture(
      "dataforseo",
      observationRow("dataforseo", {
        metric_key: DATAFORSEO_DATASET_KEY,
        subject_type: "keyword_cluster",
      }),
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
    expect(result.terminal).toHaveBeenCalledWith(
      {
        runId: "run-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        attemptCount: 1,
      },
      {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      },
    );
  });

  it("accepts composite ranked-keyword observations and excludes competitor-domain rows from DiagnosticContext", async () => {
    const ranked = availableObservationRow(OBSERVATION_FIXTURES[6]);
    const competitor = observationRow("dataforseo", {
      id: "00000000-0000-4000-8000-000000000030",
      metric_key: METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
      subject_type: "site",
      subject_ref: "rival.example",
      availability: "available",
      value_json: {
        targetDomain: "example.com",
        competitorDomain: "rival.example",
        intersections: 42,
        averagePosition: 8.5,
        summedPosition: 357,
        organicEstimatedTrafficVolume: 1_250,
        marketCode: "US",
        languageCode: "en",
      },
    });
    const result = await runObservationValidationFixture(
      "dataforseo",
      ranked,
      {
        source: {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        },
        observations: [ranked, competitor],
      },
    );

    expect(result.contextBuild).toHaveBeenCalledOnce();
    expect(result.contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: [
          expect.objectContaining({
            observationId: ranked.id,
            metricKey: METRIC_CSV_KEYWORD_GAP,
            provider: "dataforseo",
          }),
        ],
      }),
    );
    expect(
      result.contextBuild.mock.calls[0]?.[0].observations,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
        }),
      ]),
    );
  });

  it("accepts v2 ranked-keyword observations and excludes paid SERP-competitor rows from DiagnosticContext", async () => {
    const ranked = availableObservationRow(OBSERVATION_FIXTURES[6]);
    const serpCompetitor = observationRow("dataforseo", {
      id: "00000000-0000-4000-8000-000000000033",
      metric_key: METRIC_DATAFORSEO_SERP_COMPETITOR,
      subject_type: "site",
      subject_ref: "rival.example",
      availability: "available",
      value_json: {
        targetDomain: "example.com",
        competitorDomain: "rival.example",
        averagePosition: 4.5,
        medianPosition: 4,
        rating: 92,
        organicEstimatedTrafficVolume: 850,
        keywordsCount: 18,
        visibility: 0.74,
        relevantSerpItems: 6,
        seedCount: 3,
        marketCode: "US",
        languageCode: "en",
      },
    });
    const result = await runObservationValidationFixture(
      "dataforseo",
      ranked,
      {
        source: {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V2_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V2_METHOD_VERSION,
        },
        observations: [ranked, serpCompetitor],
      },
    );

    expect(result.contextBuild).toHaveBeenCalledOnce();
    expect(result.contextBuild.mock.calls[0]?.[0].observations).toEqual([
      expect.objectContaining({
        observationId: ranked.id,
        metricKey: METRIC_CSV_KEYWORD_GAP,
        provider: "dataforseo",
      }),
    ]);
  });

  it("accepts v3 ranked-keyword observations and excludes AI-citation rows from DiagnosticContext", async () => {
    const ranked = availableObservationRow(OBSERVATION_FIXTURES[6]);
    const aiCitation = observationRow("dataforseo", {
      id: "00000000-0000-4000-8000-000000000034",
      metric_key: METRIC_DATAFORSEO_COMPETITOR_AI_CITATION,
      subject_type: "site",
      subject_ref: "rival.example",
      availability: "available",
      value_json: {
        targetDomain: "example.com",
        competitorDomain: "rival.example",
        attemptedQueries: 20,
        observedQueries: 17,
        citedQueries: 8,
        unavailableQueries: 3,
        cohortCoverage: "partial",
        querySetHash: "e".repeat(64),
        platform: "chat_gpt",
        model: "gpt-4.1",
        marketCode: "US",
        languageTag: "en-US",
        queryOutcomes: Array.from({ length: 20 }, (_, index) => ({
          queryEntityId: `00000000-0000-4000-8000-${(1000 + index).toString().padStart(12, "0")}`,
          queryRevision: 1,
          queryHash: `${index.toString(16).padStart(2, "0")}${"f".repeat(62)}`,
          availability: index < 17 ? "available" : "unavailable",
          cited: index < 8,
        })),
      },
    });
    const result = await runObservationValidationFixture(
      "dataforseo",
      ranked,
      {
        source: {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
        },
        observations: [ranked, aiCitation],
      },
    );

    expect(result.contextBuild).toHaveBeenCalledOnce();
    expect(result.contextBuild.mock.calls[0]?.[0].observations).toEqual([
      expect.objectContaining({
        observationId: ranked.id,
        metricKey: METRIC_CSV_KEYWORD_GAP,
        provider: "dataforseo",
      }),
    ]);
  });

  it("accepts v3 ranked-keyword observations without dropping existing diagnostic evidence", async () => {
    const ranked = availableObservationRow(OBSERVATION_FIXTURES[6]);
    const result = await runObservationValidationFixture(
      "dataforseo",
      ranked,
      {
        source: {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
        },
        observations: [ranked],
      },
    );

    expect(result.contextBuild).toHaveBeenCalledOnce();
    expect(result.contextBuild.mock.calls[0]?.[0].observations).toEqual([
      expect.objectContaining({
        observationId: ranked.id,
        metricKey: METRIC_CSV_KEYWORD_GAP,
        provider: "dataforseo",
      }),
    ]);
  });

  it("validates and excludes v3 competitor metrics without dropping ranked evidence", async () => {
    const ranked = availableObservationRow(OBSERVATION_FIXTURES[6]);
    const organic = observationRow("dataforseo", {
      id: "00000000-0000-4000-8000-000000000034",
      metric_key: METRIC_DATAFORSEO_COMPETITOR_DOMAIN_V2,
      subject_type: "site",
      subject_ref: "rival.example",
      availability: "available",
      value_json: {
        targetDomain: "example.com",
        competitorDomain: "rival.example",
        intersections: 4,
        targetOrganicKeywordCount: 20,
        serpOverlap: 0.2,
        averagePosition: 8.5,
        summedPosition: 34,
        organicEstimatedTrafficVolume: 1_250,
        marketCode: "US",
        languageCode: "en",
      },
    });
    const aiCitation = observationRow("dataforseo", {
      id: "00000000-0000-4000-8000-000000000035",
      metric_key: METRIC_DATAFORSEO_COMPETITOR_AI_CITATION,
      subject_type: "site",
      subject_ref: "rival.example",
      availability: "available",
      value_json: {
        targetDomain: "example.com",
        competitorDomain: "rival.example",
        attemptedQueries: 20,
        observedQueries: 8,
        citedQueries: 3,
        unavailableQueries: 12,
        cohortCoverage: "partial",
        querySetHash: "a".repeat(64),
        platform: "chat_gpt",
        model: "gpt-5",
        marketCode: "US",
        languageTag: "en-US",
        queryOutcomes: Array.from({ length: 20 }, (_, index) => ({
          queryEntityId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          queryRevision: index + 1,
          queryHash: String(index + 1).padStart(64, "0"),
          availability: index < 8 ? "available" : "unavailable",
          cited: index < 3,
        })),
      },
    });
    const result = await runObservationValidationFixture(
      "dataforseo",
      ranked,
      {
        source: {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_V3_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_V3_METHOD_VERSION,
        },
        observations: [ranked, organic, aiCitation],
      },
    );

    expect(result.contextBuild).toHaveBeenCalledOnce();
    expect(result.contextBuild.mock.calls[0]?.[0].observations).toEqual([
      expect.objectContaining({ observationId: ranked.id }),
    ]);
  });

  it("fails closed when a composite competitor-domain value does not match its subject identity", async () => {
    const ranked = availableObservationRow(OBSERVATION_FIXTURES[6]);
    const competitor = observationRow("dataforseo", {
      id: "00000000-0000-4000-8000-000000000031",
      metric_key: METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
      subject_type: "site",
      subject_ref: "rival.example",
      availability: "available",
      value_json: {
        targetDomain: "example.com",
        competitorDomain: "different.example",
        intersections: 42,
        averagePosition: 8.5,
        summedPosition: 357,
        organicEstimatedTrafficVolume: 1_250,
        marketCode: "US",
        languageCode: "en",
      },
    });
    const result = await runObservationValidationFixture(
      "dataforseo",
      ranked,
      {
        source: {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        },
        observations: [ranked, competitor],
      },
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
    expect(result.terminal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("fails closed when a composite competitor-domain value targets another Site", async () => {
    const ranked = availableObservationRow(OBSERVATION_FIXTURES[6]);
    const competitor = observationRow("dataforseo", {
      id: "00000000-0000-4000-8000-000000000032",
      metric_key: METRIC_DATAFORSEO_COMPETITOR_DOMAIN,
      subject_type: "site",
      subject_ref: "rival.example",
      availability: "available",
      value_json: {
        targetDomain: "other.example",
        competitorDomain: "rival.example",
        intersections: 42,
        averagePosition: 8.5,
        summedPosition: 357,
        organicEstimatedTrafficVolume: 1_250,
        marketCode: "US",
        languageCode: "en",
      },
    });
    const result = await runObservationValidationFixture(
      "dataforseo",
      ranked,
      {
        source: {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        },
        observations: [ranked, competitor],
      },
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
    expect(result.terminal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it("fails closed when a composite Snapshot is paired with the legacy collection operation", async () => {
    const ranked = availableObservationRow(OBSERVATION_FIXTURES[6]);
    const result = await runObservationValidationFixture(
      "dataforseo",
      ranked,
      {
        source: {
          datasetKey: DATAFORSEO_SEARCH_LANDSCAPE_DATASET_KEY,
          methodVersion: DATAFORSEO_SEARCH_LANDSCAPE_METHOD_VERSION,
        },
        collectionOperation: "keyword_gap_import",
      },
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
    expect(result.terminal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
      }),
    );
  });

  it.each(OBSERVATION_FIXTURES)(
    "rejects $provider observations with a metric outside the $metricKey registry before Context",
    async ({ provider, subjectType }) => {
      const result = await runObservationValidationFixture(
        provider,
        observationRow(provider, {
          metric_key: "forged.metric.v1",
          subject_type: subjectType,
        }),
      );

      expect(result.contextBuild).not.toHaveBeenCalled();
      expect(result.transaction).not.toHaveBeenCalled();
      expect(result.terminal).toHaveBeenCalledWith(
        {
          runId: "run-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          attemptCount: 1,
        },
        {
          status: "failed",
          lastErrorCode: "UNAVAILABLE",
          lastErrorSummary: "diagnostic failed",
        },
      );
    },
  );

  it.each(OBSERVATION_FIXTURES)(
    "rejects $provider $metricKey observations with the wrong subject type before Context",
    async ({ provider, metricKey, subjectType }) => {
      const result = await runObservationValidationFixture(
        provider,
        observationRow(provider, {
          metric_key: metricKey,
          subject_type: subjectType === "url" ? "site" : "url",
        }),
      );

      expect(result.contextBuild).not.toHaveBeenCalled();
      expect(result.transaction).not.toHaveBeenCalled();
      expect(result.terminal).toHaveBeenCalledWith(
        {
          runId: "run-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          attemptCount: 1,
        },
        {
          status: "failed",
          lastErrorCode: "UNAVAILABLE",
          lastErrorSummary: "diagnostic failed",
        },
      );
    },
  );

  it.each(SOURCE_PROVIDERS)(
    "rejects historical %s observations whose observedAt differs from snapshot.capturedAt before Context",
    async (provider) => {
      const result = await runObservationValidationFixture(
        provider,
        observationRow(provider, {
          observed_at: "2026-07-18T00:00:00.000Z",
        }),
      );

      expect(result.contextBuild).not.toHaveBeenCalled();
      expect(result.transaction).not.toHaveBeenCalled();
      expect(result.terminal).toHaveBeenCalledWith(
        {
          runId: "run-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          attemptCount: 1,
        },
        {
          status: "failed",
          lastErrorCode: "UNAVAILABLE",
          lastErrorSummary: "diagnostic failed",
        },
      );
    },
  );

  it("rejects a correctly registered crawl page with crafted unknown payload fields before Context", async () => {
    const fixture = OBSERVATION_FIXTURES[0];
    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(fixture, {
        value_json: {
          ...validProjectionFor(fixture),
          crafted: { sessions: 999_999 },
        },
      }),
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
    expect(result.terminal).toHaveBeenCalledWith(
      expect.any(Object),
      {
        status: "failed",
        lastErrorCode: "UNAVAILABLE",
        lastErrorSummary: "diagnostic failed",
      },
    );
  });

  it("rejects a GSC projection masquerading under the registered crawl page tuple before Context", async () => {
    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(OBSERVATION_FIXTURES[0], {
        value_json: validProjectionFor(OBSERVATION_FIXTURES[3]),
      }),
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "null initial status",
      patch: { status: null },
    },
    {
      label: "different terminal status without redirects",
      patch: { status: 200, finalStatus: 204, redirectChain: [] },
    },
    {
      label: "non-redirect initial status with a redirect chain",
      patch: {
        status: 200,
        finalStatus: 200,
        redirectChain: [`${SITE_ORIGIN}/redirect-target`],
      },
    },
  ])("rejects crawl page journey with $label before Context", async ({ patch }) => {
    const fixture = OBSERVATION_FIXTURES[0];
    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(fixture, {
        value_json: { ...validProjectionFor(fixture), ...patch },
      }),
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
  });

  it("rejects an unavailable observation carrying any value before Context", async () => {
    const fixture = OBSERVATION_FIXTURES[0];
    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(fixture, {
        availability: "unavailable",
      }),
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
  });

  it("loads the frozen Site identity and fails closed before observations when it is missing", async () => {
    const fixture = diagnosticFixture({ snapshots: [manifestEntry()] });
    const ctx = unitContext();
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    const site = vi
      .spyOn(SitesRepository.prototype, "findById")
      .mockResolvedValue(null);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      snapshotRow(),
    ]);
    const icp = vi.spyOn(IcpProfilesRepository.prototype, "findById");
    const observations = vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    );

    await runDiagnostic(ctx, {
      runId: fixture.run.id,
      ...fixture.scope,
    });

    expect(site).toHaveBeenCalledWith(fixture.scope, "site-1");
    expect(icp).not.toHaveBeenCalled();
    expect(observations).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  });

  it.each([
    {
      label: "crawl page fetch identity",
      fixture: OBSERVATION_FIXTURES[0],
      subjectRef: "https://outside.example/fixture",
      valueJson: {
        ...validProjectionFor(OBSERVATION_FIXTURES[0]),
        fetchUrl: "https://outside.example/fixture",
      },
    },
    {
      label: "crawl robots site subject",
      fixture: OBSERVATION_FIXTURES[1],
      subjectRef: "https://outside.example",
      valueJson: validProjectionFor(OBSERVATION_FIXTURES[1]),
    },
    {
      label: "crawl sitemap site subject",
      fixture: OBSERVATION_FIXTURES[2],
      subjectRef: "https://outside.example",
      valueJson: validProjectionFor(OBSERVATION_FIXTURES[2]),
    },
    {
      label: "GSC URL subject",
      fixture: OBSERVATION_FIXTURES[3],
      subjectRef: "https://outside.example/fixture",
      valueJson: validProjectionFor(OBSERVATION_FIXTURES[3]),
    },
    {
      label: "GA4 URL subject",
      fixture: OBSERVATION_FIXTURES[4],
      subjectRef: "https://outside.example/fixture",
      valueJson: validProjectionFor(OBSERVATION_FIXTURES[4]),
    },
  ])(
    "rejects an out-of-scope $label without logging the payload",
    async ({ fixture, subjectRef, valueJson }) => {
      const result = await runObservationValidationFixture(
        fixture.provider,
        availableObservationRow(fixture, {
          subject_ref: subjectRef,
          value_json: valueJson,
        }),
      );

      expect(result.contextBuild).not.toHaveBeenCalled();
      expect(result.transaction).not.toHaveBeenCalled();
      expect(JSON.stringify(result.errorLog.mock.calls)).not.toContain(
        "outside.example",
      );
    },
  );

  it.each([OBSERVATION_FIXTURES[5], OBSERVATION_FIXTURES[6]])(
    "accepts an absolute external currentUrl from $provider without changing keyword-cluster identity",
    async (fixture) => {
      const result = await runObservationValidationFixture(
        fixture.provider,
        availableObservationRow(fixture, {
          subject_ref: "widget pricing",
          value_json: {
            ...validProjectionFor(fixture),
            currentUrl: "https://outside.example/fixture",
          },
        }),
      );

      expect(result.contextBuild).toHaveBeenCalledOnce();
      expect(result.contextBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          observations: [
            expect.objectContaining({
              provider: fixture.provider,
              subjectRef: "widget pricing",
              valueJson: expect.objectContaining({
                currentUrl: "https://outside.example/fixture",
              }),
            }),
          ],
        }),
      );
      expect(result.transaction).toHaveBeenCalledOnce();
      expect(result.terminal).not.toHaveBeenCalled();
    },
  );

  it("rejects a same-origin crawl page whose fetch identity does not match its subject", async () => {
    const fixture = OBSERVATION_FIXTURES[0];
    const result = await runObservationValidationFixture(
      "crawl",
      availableObservationRow(fixture, {
        subject_ref: `${SITE_ORIGIN}/other`,
      }),
    );

    expect(result.contextBuild).not.toHaveBeenCalled();
    expect(result.transaction).not.toHaveBeenCalled();
  });

  it("rejects an available row frozen under an unavailable provider snapshot", async () => {
    const crawl = frozenSource("crawl");
    const gsc = frozenSource("gsc", { availability: "unavailable" });
    const fixture = diagnosticFixture({
      snapshots: [crawl.manifest, gsc.manifest],
    });
    const transaction = vi.fn();
    const ctx = unitContext(transaction);
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      crawl.snapshot,
      gsc.snapshot,
    ]);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
      validIcpRow(),
    );
    vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    ).mockResolvedValue([
      availableObservationRow(OBSERVATION_FIXTURES[3]),
    ]);
    const contextBuild = vi.spyOn(DiagnosticContext, "build");

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(contextBuild).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledWith(toRunAttempt(fixture.run), {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });
  });

  it("accepts CSV and DataForSEO together while preserving both provider identities in Context", async () => {
    const crawl = frozenSource("crawl");
    const csv = frozenSource("csv");
    const dataforseo = frozenSource("dataforseo", {
      availability: "partial",
    });
    const fixture = diagnosticFixture({
      snapshots: [crawl.manifest, csv.manifest, dataforseo.manifest],
    });
    const transaction = vi.fn();
    const ctx = unitContext(transaction);
    const terminal = mockClaimedDiagnostic(fixture.run, fixture.diagnostic);
    vi.spyOn(DataSnapshotsRepository.prototype, "findByIds").mockResolvedValue([
      crawl.snapshot,
      csv.snapshot,
      dataforseo.snapshot,
    ]);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(
      validIcpRow(),
    );
    vi.spyOn(
      ProviderDiscrepanciesRepository.prototype,
      "listUnresolvedBySnapshotIds",
    ).mockResolvedValue([]);
    vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    ).mockResolvedValue([
      availableObservationRow(OBSERVATION_FIXTURES[5]),
      availableObservationRow(OBSERVATION_FIXTURES[6], {
        id: "00000000-0000-4000-8000-000000000029",
      }),
    ]);
    vi.spyOn(
      PageSnapshotsRepository.prototype,
      "listByDataSnapshotWithSitePageIdentity",
    ).mockResolvedValue([]);
    const contextBuild = vi.spyOn(DiagnosticContext, "build");

    await runDiagnostic(ctx, { runId: fixture.run.id, ...fixture.scope });

    expect(contextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: expect.arrayContaining([
          expect.objectContaining({ provider: "csv" }),
          expect.objectContaining({ provider: "dataforseo" }),
        ]),
        coverage: expect.objectContaining({ csv: "available" }),
        availabilityByProvider: expect.objectContaining({
          csv: "available",
          dataforseo: "partial",
        }),
      }),
    );
    expect(transaction).toHaveBeenCalledOnce();
    expect(terminal).not.toHaveBeenCalled();
    const keywordLineage = new Map([
      [
        "csv",
        {
          snapshotId: csv.snapshot.id,
          collectionRunId: csv.snapshot.collection_run_id,
        },
      ],
      [
        "dataforseo",
        {
          snapshotId: dataforseo.snapshot.id,
          collectionRunId: dataforseo.snapshot.collection_run_id,
        },
      ],
    ]);
    expect(
      lineageForEvidenceProvider("csv", keywordLineage)?.snapshotId,
    ).toBe(csv.snapshot.id);
    expect(
      lineageForEvidenceProvider("dataforseo", keywordLineage)?.snapshotId,
    ).toBe(dataforseo.snapshot.id);
  });

  it.each(OBSERVATION_FIXTURES)(
    "accepts the registered $provider $metricKey/$subjectType tuple into Context",
    async (fixture) => {
      const { provider, metricKey, subjectType } = fixture;
      const observation = availableObservationRow(fixture);
      const result = await runObservationValidationFixture(
        provider,
        observation,
      );

      expect(result.contextBuild).toHaveBeenCalledOnce();
      expect(result.contextBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          observations: [
            expect.objectContaining({
              provider,
              metricKey,
              subjectType,
              observedAt: FROZEN_AT,
            }),
          ],
        }),
      );
      expect(result.transaction).toHaveBeenCalledOnce();
      expect(result.terminal).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["fractional KD", { keywordDifficulty: 1.5 }],
    ["negative KD", { keywordDifficulty: -1 }],
    ["above-100 KD", { keywordDifficulty: 101 }],
    ["non-numeric KD", { keywordDifficulty: "37" }],
    ["unknown provider intent", { providerSearchIntent: "research" }],
  ] as const)(
    "rejects DataForSEO keyword projection with %s before Context",
    async (_label, patch) => {
      const fixture = OBSERVATION_FIXTURES[6];
      const result = await runObservationValidationFixture(
        fixture.provider,
        availableObservationRow(fixture, {
          value_json: { ...validProjectionFor(fixture), ...patch },
        }),
      );

      expect(result.contextBuild).not.toHaveBeenCalled();
      expect(result.transaction).not.toHaveBeenCalled();
    },
  );

  it.each(["keywordDifficulty", "providerSearchIntent"] as const)(
    "requires DataForSEO keyword projection field %s",
    async (field) => {
      const fixture = OBSERVATION_FIXTURES[6];
      const valueJson = validProjectionFor(fixture);
      delete valueJson[field];

      const result = await runObservationValidationFixture(
        fixture.provider,
        availableObservationRow(fixture, { value_json: valueJson }),
      );

      expect(result.contextBuild).not.toHaveBeenCalled();
      expect(result.transaction).not.toHaveBeenCalled();
    },
  );
});

describe("diagnostic retry classification", () => {
  it("resets and rethrows a transient PostgreSQL transaction failure", async () => {
    const scope = { workspaceId: "workspace-1", projectId: "project-1" };
    const run = {
      id: "run-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "running",
      active_key: "diagnostic",
      contract_version: "2026-07-21",
      request_payload: {},
      progress: {},
      last_error_code: null,
      last_error_summary: null,
      result_type: null,
      result_id: null,
      attempt_count: 1,
      initiated_by: "actor-1",
      queued_at: "2026-07-19T00:00:00.000Z",
      started_at: "2026-07-19T00:00:01.000Z",
      completed_at: null,
    } satisfies AsyncRunRow;
    const attempt = toRunAttempt(run);
    const diagnostic = diagnosticFixture({
      snapshots: [manifestEntry()],
    }).diagnostic;
    const databaseFailure = Object.assign(new Error("serialization failure"), {
      code: "40001",
    });
    const warn = vi.fn();
    const error = vi.fn();
    const logger: Logger = {
      context: { service: "worker", environment: "test" },
      child: () => logger,
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error,
    };
    const ctx = {
      db: {} as WorkerContext["db"],
      logger,
    } as WorkerContext;

    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
    const reset = vi
      .spyOn(AsyncRunsRepository.prototype, "resetToQueued")
      .mockResolvedValue(true);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    vi.spyOn(
      DiagnosticRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(diagnostic);
    vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    ).mockResolvedValue([snapshotRow()]);
    vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue(
      validSiteRow(),
    );
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockRejectedValue(
      databaseFailure,
    );

    await expect(
      runDiagnostic(ctx, { runId: run.id, ...scope }),
    ).rejects.toBe(databaseFailure);
    expect(reset).toHaveBeenCalledWith(attempt);
    expect(terminal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("diagnostic_transient_error", {
      code: "40001",
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("acks a transient error when a newer attempt already owns the run", async () => {
    const scope = { workspaceId: "workspace-1", projectId: "project-1" };
    const run = {
      id: "run-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "running",
      active_key: "diagnostic",
      contract_version: "2026-07-21",
      request_payload: {},
      progress: {},
      last_error_code: null,
      last_error_summary: null,
      result_type: null,
      result_id: null,
      attempt_count: 1,
      initiated_by: "actor-1",
      queued_at: "2026-07-19T00:00:00.000Z",
      started_at: "2026-07-19T00:00:01.000Z",
      completed_at: null,
    } satisfies AsyncRunRow;
    const diagnostic = diagnosticFixture({
      snapshots: [manifestEntry()],
    }).diagnostic;
    const databaseFailure = Object.assign(new Error("serialization failure"), {
      code: "40001",
    });
    const logger: Logger = {
      context: { service: "worker", environment: "test" },
      child: () => logger,
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const ctx = { db: {} as WorkerContext["db"], logger } as WorkerContext;

    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
    const reset = vi
      .spyOn(AsyncRunsRepository.prototype, "resetToQueued")
      .mockResolvedValue(false);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    vi.spyOn(
      DiagnosticRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(diagnostic);
    vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    ).mockResolvedValue([snapshotRow()]);
    vi.spyOn(SitesRepository.prototype, "findById").mockResolvedValue(
      validSiteRow(),
    );
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockRejectedValue(
      databaseFailure,
    );

    await expect(
      runDiagnostic(ctx, { runId: run.id, ...scope }),
    ).resolves.toBeUndefined();
    expect(reset).toHaveBeenCalledWith(toRunAttempt(run));
    expect(terminal).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalledWith(
      "diagnostic_transient_error",
      expect.anything(),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "diagnostic_skip_stale_attempt",
      { code: "40001" },
    );
  });

  it("terminalizes a permanent failure without logging arbitrary error content", async () => {
    const scope = { workspaceId: "workspace-1", projectId: "project-1" };
    const run = {
      id: "run-1",
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "running",
      active_key: "diagnostic",
      contract_version: "2026-07-21",
      request_payload: {},
      progress: {},
      last_error_code: null,
      last_error_summary: null,
      result_type: null,
      result_id: null,
      attempt_count: 1,
      initiated_by: "actor-1",
      queued_at: "2026-07-19T00:00:00.000Z",
      started_at: "2026-07-19T00:00:01.000Z",
      completed_at: null,
    } satisfies AsyncRunRow;
    const attempt = toRunAttempt(run);
    const diagnostic = diagnosticFixture({
      snapshots: [manifestEntry()],
    }).diagnostic;
    const error = vi.fn();
    const logger: Logger = {
      context: { service: "worker", environment: "test" },
      child: () => logger,
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error,
    };
    const ctx = {
      db: {} as WorkerContext["db"],
      logger,
    } as WorkerContext;

    vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
    const terminal = vi
      .spyOn(AsyncRunsRepository.prototype, "setTerminal")
      .mockResolvedValue(true);
    vi.spyOn(
      DiagnosticRunsRepository.prototype,
      "findById",
    ).mockResolvedValue(diagnostic);
    vi.spyOn(
      DataSnapshotsRepository.prototype,
      "findByIds",
    ).mockResolvedValue([snapshotRow()]);
    vi.spyOn(IcpProfilesRepository.prototype, "findById").mockRejectedValue(
      new Error("parser rejected customer-content-secret"),
    );

    await runDiagnostic(ctx, { runId: run.id, ...scope });

    expect(error).toHaveBeenCalledWith("diagnostic_failed", {
      code: "UNAVAILABLE",
      type: "internal",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      "customer-content-secret",
    );
    expect(terminal).toHaveBeenCalledWith(attempt, {
      status: "failed",
      lastErrorCode: "UNAVAILABLE",
      lastErrorSummary: "diagnostic failed",
    });

    error.mockClear();
    terminal.mockResolvedValueOnce(false);
    await runDiagnostic(ctx, { runId: run.id, ...scope });
    expect(error).not.toHaveBeenCalledWith(
      "diagnostic_failed",
      expect.anything(),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "diagnostic_skip_stale_attempt",
      { code: "UNAVAILABLE" },
    );
  });
});

describe("dataForSeoTargetForOrigin", () => {
  // Regression for the 2026-08-07 production outage: the adapter's
  // normalizeTarget strips `www.` before querying DataForSEO, so frozen
  // observations of www-origin sites carry the apex domain. The diagnostic
  // used to demand the raw hostname and killed every run of such sites.
  it.each([
    ["https://www.astrologywiki.com", "astrologywiki.com"],
    ["https://example.com", "example.com"],
    ["https://WWW.Example.COM", "example.com"],
    ["https://example.com.", "example.com"],
  ])("normalizes %s to %s exactly like the adapter", (origin, expected) => {
    expect(dataForSeoTargetForOrigin(origin)).toBe(expected);
  });
});
