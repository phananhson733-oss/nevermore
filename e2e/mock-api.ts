import type { Page, Route } from "@playwright/test";
import type { components } from "../packages/contracts/src/generated/openapi.ts";
import {
  ActionRecheckResultsResponse as ActionRecheckResultsResponseSchema,
  ConfirmedProductProfileRowDto as ConfirmedProductProfileRowSchema,
  GeoCitationEvidenceResponse as GeoCitationEvidenceResponseSchema,
  GrowthMapInternalLinkMap as GrowthMapInternalLinkMapSchema,
  GrowthMapTopicModelInsights as GrowthMapTopicModelInsightsSchema,
  GrowthMapUrlDetailResponse as GrowthMapUrlDetailResponseSchema,
  GrowthMapUrlPortfolioResponse as GrowthMapUrlPortfolioResponseSchema,
  GrowthOpportunity as GrowthOpportunitySchema,
  MeasurementTargetKeywordRanks as MeasurementTargetKeywordRanksSchema,
  MeasurementWindowRecentResponse as MeasurementWindowRecentResponseSchema,
  ProductProfileDraft as ProductProfileDraftSchema,
  TopicModelWorkspaceProjection as TopicModelWorkspaceProjectionSchema,
  type ActionRecheckResultsResponse,
  type ConfirmedProductProfileRowDto,
  type GeoCitationEvidenceResponse,
  type GrowthMapInternalLinkMap,
  type GrowthMapTopicModelInsights,
  type GrowthMapUrlDetailResponse,
  type GrowthMapUrlFinding,
  type GrowthMapUrlPortfolioItem,
  type GrowthMapUrlPortfolioResponse,
  type GrowthOpportunity,
  type MeasurementWindow,
  type MeasurementTargetKeywordRanks,
  type MeasurementWindowRecentResponse,
  type TopicModelWorkspaceProjection,
} from "../packages/contracts/src/index.ts";

export const E2E_PROJECT_ID = "00000000-0000-4000-8000-000000000042";
export const E2E_SITE_ID = "00000000-0000-4000-8000-000000000043";
export const E2E_SECONDARY_SITE_ID = "00000000-0000-4000-8000-000000000045";

export type MockDataSnapshot = components["schemas"]["DataSnapshot"];
export type MockEvidence = components["schemas"]["Evidence"];

export const E2E_SNAPSHOT_PROVENANCE = {
  crawl: {
    datasetKey: "crawl.site_graph.v1",
    methodVersion: "crawl.site_graph.v2",
  },
  gsc: {
    datasetKey: "gsc.page_query_daily.v1",
    methodVersion: "gsc.search_analytics.v1",
  },
  ga4: {
    datasetKey: "ga4.organic_landing_daily.v1",
    methodVersion: "ga4.organic_landing.v1",
  },
  csv: {
    datasetKey: "csv.keyword_gap.v1",
    methodVersion: "csv.keyword_gap.v1",
  },
  dataforseo: {
    datasetKey: "csv.keyword_gap.v1",
    methodVersion: "dataforseo.ranked_keywords.v1",
  },
} as const;

export interface CriticalFlowApiState {
  readonly collectionRequests: unknown[];
  readonly sourceConnectRequests: {
    readonly provider: "gsc" | "ga4";
    readonly body: unknown;
  }[];
  readonly diagnosticRequests: unknown[];
  readonly findingReviewRequests: unknown[];
  readonly artifactCreateRequests: unknown[];
  readonly artifactPatchRequests: unknown[];
  readonly exportRequests: unknown[];
  /** One entry per export-detail GET: the exportId that was read. */
  readonly exportDetailReads: string[];
  /** One entry per report GET: the request's pathname + search (D4). */
  readonly reportReads: string[];
  sourceReads: number;
  collectionRunPolls: number;
  diagnosticRunPolls: number;
}

/* ------------------------------------------------------------------ *
 * R3 blueprint D8: the export mock is programmable. The create route  *
 * can answer 202 (with a valid, missing, wrong-type, or non-UUID      *
 * resourceRef) or 409 (with or without a body `current` pointer), and *
 * the detail route serves a per-read run-state sequence whose last    *
 * step repeats — so specs can drive queued -> running -> 503 ->       *
 * (Retry) -> running -> completed against the closed client state     *
 * machine, or a well-formed detail body whose id is not the tracked   *
 * export. Defaults preserve the original behavior: 202 + first detail *
 * read already completed.                                             *
 * ------------------------------------------------------------------ */

/** UUID pair for the 409 takeover pointer: the client adopts only zod-valid
 *  UUIDs. */
export const E2E_ACTIVE_EXPORT_RUN_ID = "00000000-0000-4000-8000-000000000860";
export const E2E_ACTIVE_EXPORT_BUNDLE_ID =
  "00000000-0000-4000-8000-000000000861";
/** Default 202 resourceRef id. OpenAPI pins `resourceRef.id` to a Uuid and the
 *  client rejects anything else, so the mock must not hand out a slug. */
export const E2E_EXPORT_BUNDLE_ID = "00000000-0000-4000-8000-000000000862";
/** A well-formed but WRONG bundle id, served by the detail route when
 *  `exportDetailIdMismatch` is set (protocol-break drill). */
export const E2E_MISMATCHED_EXPORT_BUNDLE_ID =
  "00000000-0000-4000-8000-000000000863";

export type MockExportDetailStep =
  | "queued"
  | "running"
  | "unavailable"
  | "completed";

export type MockExportCreateMode =
  | "accepted"
  | "acceptedMissingResourceRef"
  | "acceptedWrongTypeResourceRef"
  | "acceptedNonUuidResourceRef"
  | "conflictWithCurrent"
  | "conflictWithoutCurrent";

export interface CriticalFlowApiOptions {
  readonly exportCreate?: MockExportCreateMode;
  /** Consumed one step per detail GET (per exportId); last step repeats. */
  readonly exportDetailSequence?: readonly MockExportDetailStep[];
  /** Serve every export-detail body with a well-formed but different id. */
  readonly exportDetailIdMismatch?: boolean;
}

/** The 202 resourceRef for each programmable create mode (D8). */
function acceptedExportResourceRef(
  mode: MockExportCreateMode,
): { type: string; id: string } | null {
  switch (mode) {
    case "acceptedMissingResourceRef":
      return null;
    case "acceptedWrongTypeResourceRef":
      return { type: "artifact", id: E2E_EXPORT_BUNDLE_ID };
    case "acceptedNonUuidResourceRef":
      return { type: "export", id: "export-bundle" };
    default:
      return { type: "export", id: E2E_EXPORT_BUNDLE_ID };
  }
}

const NOW = "2026-07-18T12:00:00.000Z";
const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;

const project = {
  id: E2E_PROJECT_ID,
  clientName: "E2E Client",
  projectName: "E2E Critical Flow",
  stage: "planning",
  site: {
    id: E2E_SITE_ID,
    origin: "https://example.test",
    host: "example.test",
    marketCodes: ["US"],
    languageCodes: ["en", "zh-CN"],
  },
  contextStatus: "complete",
  currentIcpProfileVersion: 1,
  confirmedIcpProfileVersion: 1,
  defaultDeliveryLocale: "en",
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
};

const coverage = {
  overall: "partial",
  domains: {
    technical_seo: "complete",
    search_performance: "partial",
    content_intent: "complete",
    conversion_journey: "partial",
    geo_ai: "complete",
  },
  limitations: ["GSC unavailable", "GSC unavailable"],
};

const crawlSnapshot = {
  id: "00000000-0000-4000-8000-000000000101",
  siteId: E2E_SITE_ID,
  provider: "crawl",
  datasetKey: E2E_SNAPSHOT_PROVENANCE.crawl.datasetKey,
  schemaVersion: "0.2.0",
  methodVersion: E2E_SNAPSHOT_PROVENANCE.crawl.methodVersion,
  capturedAt: NOW,
  sourceWindow: { start: null, end: null },
  availability: "available",
  limitation: "Static HTML only; JavaScript-rendered content may be absent.",
  rowCount: 12,
  checksum: "c".repeat(64),
} satisfies MockDataSnapshot;
const CRAWL_COLLECTION_RUN_ID = "00000000-0000-4000-8000-000000000102";

function asyncRun(
  id: string,
  kind: "collection" | "diagnostic" | "artifact_generation" | "export",
  status: "queued" | "running" | "completed",
  progress = {
    phase: status,
    current: status === "completed" ? 2 : 1,
    total: 2,
  },
) {
  const resultType = {
    collection: "collection_run",
    diagnostic: "diagnostic_run",
    artifact_generation: "artifact",
    export: "export",
  }[kind];
  return {
    id,
    projectId: E2E_PROJECT_ID,
    kind,
    status,
    progress: { ...progress, messageKey: "worker.collection.raw_key" },
    lastError: null,
    resultRef: status === "completed" ? { type: resultType, id } : null,
    queuedAt: NOW,
    startedAt: status === "queued" ? null : NOW,
    completedAt: status === "completed" ? NOW : null,
  };
}

export function sourceSlot(
  provider: "crawl" | "gsc" | "ga4" | "csv" | "dataforseo",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const crawl = provider === "crawl";
  const oauth = provider === "gsc" || provider === "ga4";
  return {
    id: crawl ? "00000000-0000-4000-8000-000000000100" : null,
    projectId: E2E_PROJECT_ID,
    provider,
    connectionType: crawl
      ? "public"
      : oauth
        ? "oauth"
        : provider === "csv"
          ? "file_import"
          : "api_key_stub",
    state: crawl ? "available" : "disconnected",
    externalRef: null,
    scopes: [],
    connectedAt: crawl ? NOW : null,
    latestSnapshot: crawl ? crawlSnapshot : null,
    latestMetricSummary: null,
    activeRun: null,
    limitation: crawl
      ? "Static HTML crawl of public pages; no snapshot has been collected yet."
      : provider === "dataforseo"
        ? "DataForSEO is disabled in this MVP."
        : "Not connected.",
    featureEnabled: provider !== "dataforseo",
    updatedAt: NOW,
    ...overrides,
  };
}

const evidence: MockEvidence = {
  id: "00000000-0000-4000-8000-000000000201",
  sourceProvider: "crawl",
  origin: "direct_public",
  method: "observed",
  grade: "B",
  availability: "available",
  support: "supports",
  claim: "The URL returned HTTP 500.",
  subjectRefs: [{ type: "url", value: "https://example.test/product" }],
  observedAt: NOW,
  limitation: "One captured response.",
  snapshotId: crawlSnapshot.id,
  collectionRunId: CRAWL_COLLECTION_RUN_ID,
  analysisInvocationId: null,
};

function finding(reviewState: "unreviewed" | "confirmed") {
  return {
    id: "00000000-0000-4000-8000-000000000202",
    ruleId: "TECH-HTTP-001",
    ruleVersion: 2,
    domain: "technical_seo",
    titleKey: "finding.tech.http_status",
    titleArgs: {},
    summary: "A product page returned a server error.",
    summaryLocale: "en",
    severity: "high",
    confidence: "high",
    reviewState,
    reviewRevision: reviewState === "confirmed" ? 4 : 3,
    active: true,
    regressed: false,
    subjectRefs: [{ type: "url", value: "https://example.test/product" }],
    evidence: [evidence, { ...evidence, claim: "Duplicate projection row." }],
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    resolvedAt: null,
  };
}

/** Canonical Finding fixture with shallow overrides for focused UI tests. */
export function diagnosisFindingFixture(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    ...finding("unreviewed"),
    ...overrides,
  };
}

/** Complete findings envelope used by the Diagnosis mock read model. */
export function diagnosisFindingsEnvelopeFixture(
  findings: readonly ReturnType<typeof diagnosisFindingFixture>[] = [
    diagnosisFindingFixture(),
  ],
) {
  return {
    data: findings,
    meta: {
      nextCursor: null,
      hasNext: false,
      limit: 100,
      latestRun: asyncRun("diagnostic-run", "diagnostic", "completed"),
      coverage,
      ruleResults: [
        {
          ruleId: "TECH-HTTP-001",
          ruleVersion: 2,
          domain: "technical_seo",
          status: "candidate",
          reason: null,
          durationMs: 12,
        },
      ],
    },
  };
}

/** Fresh-project read model: no diagnostic run means no coverage assessment. */
export function diagnosisNotRunFindingsEnvelopeFixture() {
  const envelope = diagnosisFindingsEnvelopeFixture([]);
  return {
    ...envelope,
    meta: {
      ...envelope.meta,
      latestRun: null,
      coverage: null,
      ruleResults: [],
    },
  };
}

const action = {
  id: "00000000-0000-4000-8000-000000000301",
  findingId: "00000000-0000-4000-8000-000000000202",
  templateId: "fix_http_status.v1",
  title: "Fix the failing product page",
  description: "Restore a successful response for the product page.",
  contentLocale: "en",
  priorityBand: "high",
  roadmapLane: "now",
  status: "planned",
  effort: "small",
  risk: "low",
  expectedOutcome: "Visitors and crawlers can load the product page.",
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const artifact = {
  id: "00000000-0000-4000-8000-000000000401",
  actionId: action.id,
  artifactType: "technical_ticket",
  status: "draft",
  generationMode: "template",
  outputLocale: "en",
  currentRevision: 2,
  validationState: "valid",
  current: {
    id: "00000000-0000-4000-8000-000000000402",
    revision: 2,
    contentFormat: "markdown",
    content: "Restore the product endpoint and add a regression test.",
    contentHash: "sha256:e2e-artifact",
    validationErrors: [],
    note: null,
    createdAt: NOW,
  },
  activeRun: null,
  // No Content Shadow gate judges a technical_ticket.
  adoption: null,
  createdAt: NOW,
  updatedAt: NOW,
};

/**
 * Canonical ready Overview fixture. Tests may replace individual links with
 * null/empty values to exercise honest partial states without involving a DB.
 */
export function overviewWorkspaceFixture(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    view: "overview",
    project,
    coverage,
    activeRuns: [],
    frozenDiagnosticRunId: null,
    topActions: [action],
    decisionReminders: [],
    contentDecayMonitor: {
      version: "content-decay-monitor.v1",
      projectionMode: "read_time",
      scheduleState: "not_configured",
      status: "unavailable",
      timezone: "UTC",
      timezoneSource: "fallback",
      latestCheckpointMonth: null,
      limitations: [
        "Monthly scheduling is not connected; this is a read-time projection.",
      ],
      alerts: [],
    },
    latestSnapshot: crawlSnapshot,
    // One canonical evidence id even though the Diagnosis fixture intentionally
    // includes a duplicate row to test its own per-finding de-duplication.
    topActionEvidence: [evidence],
    deliveryFocus: {
      artifactId: artifact.id,
      actionId: artifact.actionId,
      artifactType: artifact.artifactType,
      status: artifact.status,
      updatedAt: artifact.updatedAt,
    },
    ...overrides,
  };
}

function listEnvelope(data: readonly unknown[]) {
  return { data, meta: { nextCursor: null, hasNext: false, limit: 100 } };
}

async function json(route: Route, value: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

function problem(code: string, detail: string, status: number) {
  return {
    type: "about:blank",
    title: status === 409 ? "Conflict" : "Mock route missing",
    status,
    code,
    detail,
    requestId: "e2e-request",
  };
}

/**
 * Install an entirely in-browser API. No handler reaches Next route code, and
 * the server itself receives an intentionally unusable loopback DATABASE_URL.
 */
export async function installCriticalFlowApi(
  page: Page,
  options: CriticalFlowApiOptions = {},
): Promise<CriticalFlowApiState> {
  const state: CriticalFlowApiState = {
    collectionRequests: [],
    sourceConnectRequests: [],
    diagnosticRequests: [],
    findingReviewRequests: [],
    artifactCreateRequests: [],
    artifactPatchRequests: [],
    exportRequests: [],
    exportDetailReads: [],
    reportReads: [],
    sourceReads: 0,
    collectionRunPolls: 0,
    diagnosticRunPolls: 0,
  };
  let findingConfirmed = false;

  await page.route("**/mock-download/client.zip", async (route) => {
    await route.fulfill({
      status: 200,
      body: "isolated e2e bundle",
      contentType: "application/zip",
      headers: {
        "Content-Disposition": 'attachment; filename="gengrowth-client.zip"',
      },
    });
  });

  await page.route("**/mock-google-oauth**", async (route) => {
    const provider = new URL(route.request().url()).searchParams.get("provider");
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<title>Google OAuth configuration</title><h1>Configure ${provider ?? "Google"}</h1>`,
    });
  });

  await page.route("**/api/mvp/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;

    if (method === "GET" && path === `${BASE}/workspace`) {
      await json(route, {
        data: overviewWorkspaceFixture(),
      });
      return;
    }

    if (method === "GET" && path === `${BASE}/sources`) {
      state.sourceReads += 1;
      await json(route, {
        data: [
          sourceSlot("crawl"),
          sourceSlot("gsc"),
          sourceSlot("ga4"),
          sourceSlot("csv"),
          sourceSlot("dataforseo"),
        ],
      });
      return;
    }

    const connectMatch = path.match(
      new RegExp(`^${BASE}/sources/(gsc|ga4)/connect$`),
    );
    if (method === "POST" && connectMatch) {
      const provider = connectMatch[1] as "gsc" | "ga4";
      const body = request.postDataJSON();
      state.sourceConnectRequests.push({ provider, body });
      await json(route, {
        data: {
          phase: "authorization",
          authorizationUrl: `${url.origin}/mock-google-oauth?provider=${provider}`,
          expiresAt: "2026-07-18T12:15:00.000Z",
        },
      });
      return;
    }

    if (
      method === "POST" &&
      path === `${BASE}/sources/csv/import` &&
      request.headers()["content-type"]?.includes("multipart/form-data")
    ) {
      await json(route, {
        data: {
          importToken: "e2e-preview-token-0000000000000000",
          expiresAt: "2026-07-18T12:30:00.000Z",
          rowCount: 1,
          previewRows: [
            {
              keyword: "signal frame",
              search_volume: 120,
              market_code: "US",
              language_code: "en",
            },
          ],
          detectedColumns: [
            "keyword",
            "search_volume",
            "market_code",
            "language_code",
          ],
          suggestedMapping: {
            keyword: "keyword",
            searchVolume: "search_volume",
            cluster: null,
            currentUrl: null,
            currentRank: null,
            competitorDomain: null,
            competitorRank: null,
            marketCode: "market_code",
            languageCode: "language_code",
          },
          errors: [],
          warnings: [],
        },
      });
      return;
    }

    if (method === "POST" && path === `${BASE}/collection-runs`) {
      state.collectionRequests.push(request.postDataJSON());
      const run = asyncRun("collection-run", "collection", "queued");
      await json(
        route,
        {
          data: {
            run,
            statusUrl: `${BASE}/runs/${run.id}`,
            resourceRef: { type: "collection_run", id: run.id },
          },
        },
        202,
      );
      return;
    }

    if (method === "GET" && path === `${BASE}/runs/collection-run`) {
      state.collectionRunPolls += 1;
      const status = state.collectionRunPolls >= 3 ? "completed" : "running";
      await json(route, {
        data: asyncRun("collection-run", "collection", status),
      });
      return;
    }

    if (method === "GET" && path === `${BASE}/snapshots`) {
      const provider = url.searchParams.get("provider");
      await json(
        route,
        listEnvelope(
          provider === null || provider === "crawl" ? [crawlSnapshot] : [],
        ),
      );
      return;
    }

    if (method === "POST" && path === `${BASE}/diagnostic-runs`) {
      state.diagnosticRequests.push(request.postDataJSON());
      const run = asyncRun("diagnostic-recheck", "diagnostic", "queued");
      await json(
        route,
        {
          data: {
            run,
            statusUrl: `${BASE}/runs/${run.id}`,
            resourceRef: { type: "diagnostic_run", id: run.id },
          },
        },
        202,
      );
      return;
    }

    if (method === "GET" && path === `${BASE}/runs/diagnostic-recheck`) {
      state.diagnosticRunPolls += 1;
      const status = state.diagnosticRunPolls >= 2 ? "completed" : "running";
      await json(route, {
        data: asyncRun("diagnostic-recheck", "diagnostic", status),
      });
      return;
    }

    if (method === "GET" && path === `${BASE}/findings`) {
      await json(
        route,
        diagnosisFindingsEnvelopeFixture([
          finding(findingConfirmed ? "confirmed" : "unreviewed"),
        ]),
      );
      return;
    }

    if (
      method === "PATCH" &&
      path === `${BASE}/findings/00000000-0000-4000-8000-000000000202`
    ) {
      const body = request.postDataJSON();
      state.findingReviewRequests.push(body);
      findingConfirmed = true;
      await json(route, {
        data: { finding: finding("confirmed"), action },
      });
      return;
    }

    if (
      method === "GET" &&
      path === `${BASE}/artifacts/execution-states`
    ) {
      const artifactIds = url.searchParams.getAll("artifactId");
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          items: artifactIds.map((artifactId) => ({
            actionId: action.id,
            artifactId,
            current: null,
          })),
        },
      });
      return;
    }

    const actionExecutionStateMatch =
      method === "GET"
        ? path.match(
            new RegExp(
              `^${BASE}/actions/([^/]+)/execution-state$`,
            ),
          )
        : null;
    if (actionExecutionStateMatch !== null) {
      const actionId = decodeURIComponent(actionExecutionStateMatch[1] ?? "");
      const artifactId = url.searchParams.get("artifactId");
      if (actionId !== action.id || artifactId !== artifact.id) {
        await json(
          route,
          problem(
            "EXECUTION_STATE_STREAM_NOT_FOUND",
            "The requested Action and Artifact do not identify the fixture execution stream.",
            404,
          ),
          404,
        );
        return;
      }
      await json(route, {
        data: {
          actionId: action.id,
          artifactId: artifact.id,
          current: null,
          history: [],
        },
      });
      return;
    }

    if (method === "GET" && path === `${BASE}/artifacts`) {
      await json(route, listEnvelope([artifact]));
      return;
    }

    if (
      method === "POST" &&
      path === `${BASE}/actions/${action.id}/artifacts`
    ) {
      state.artifactCreateRequests.push(request.postDataJSON());
      const run = asyncRun("artifact-run", "artifact_generation", "queued");
      await json(
        route,
        {
          data: {
            run,
            statusUrl: `${BASE}/runs/${run.id}`,
            resourceRef: { type: "artifact", id: artifact.id },
          },
        },
        202,
      );
      return;
    }

    if (method === "GET" && path === `${BASE}/runs/artifact-run`) {
      await json(route, {
        data: asyncRun("artifact-run", "artifact_generation", "completed"),
      });
      return;
    }

    if (method === "PATCH" && path === `${BASE}/artifacts/${artifact.id}`) {
      state.artifactPatchRequests.push(request.postDataJSON());
      await json(
        route,
        problem(
          "STALE_REVISION",
          "The artifact was updated by another operator.",
          409,
        ),
        409,
      );
      return;
    }

    if (method === "GET" && path === `${BASE}/actions`) {
      await json(route, listEnvelope([action]));
      return;
    }

    if (method === "GET" && path === `${BASE}/report`) {
      state.reportReads.push(`${path}${url.search}`);
      await json(route, {
        data: {
          project,
          outputLocale: url.searchParams.get("outputLocale") ?? "en",
          generatedAt: NOW,
          coverage,
          findings: [finding("confirmed")],
          actions: [action],
          artifacts: [{ ...artifact, status: "ready" }],
          methodology:
            "Findings are derived from deterministic rules over captured evidence.",
          limitations: ["GSC unavailable", "GSC unavailable"],
        },
      });
      return;
    }

    if (method === "POST" && path === `${BASE}/exports`) {
      state.exportRequests.push(request.postDataJSON());
      const createMode = options.exportCreate ?? "accepted";
      if (
        createMode === "conflictWithCurrent" ||
        createMode === "conflictWithoutCurrent"
      ) {
        await json(
          route,
          {
            ...problem(
              "RUN_ALREADY_ACTIVE",
              "An export of this kind is already running.",
              409,
            ),
            ...(createMode === "conflictWithCurrent"
              ? {
                  current: {
                    runId: E2E_ACTIVE_EXPORT_RUN_ID,
                    exportId: E2E_ACTIVE_EXPORT_BUNDLE_ID,
                    kind: "client_bundle",
                  },
                }
              : {}),
          },
          409,
        );
        return;
      }
      const run = asyncRun("export-run", "export", "queued");
      await json(
        route,
        {
          data: {
            run,
            statusUrl: `${BASE}/runs/${run.id}`,
            resourceRef: acceptedExportResourceRef(createMode),
          },
        },
        202,
      );
      return;
    }

    const exportDetailMatch =
      method === "GET" &&
      (path === `${BASE}/exports/${E2E_EXPORT_BUNDLE_ID}`
        ? E2E_EXPORT_BUNDLE_ID
        : path === `${BASE}/exports/${E2E_ACTIVE_EXPORT_BUNDLE_ID}`
          ? E2E_ACTIVE_EXPORT_BUNDLE_ID
          : null);
    if (typeof exportDetailMatch === "string") {
      state.exportDetailReads.push(exportDetailMatch);
      const sequence = options.exportDetailSequence ?? ["completed"];
      const readsOfThisExport = state.exportDetailReads.filter(
        (id) => id === exportDetailMatch,
      ).length;
      const step =
        sequence[Math.min(readsOfThisExport - 1, sequence.length - 1)] ??
        "completed";
      if (step === "unavailable") {
        await json(
          route,
          problem(
            "DEPENDENCY_UNAVAILABLE",
            "raw object-storage endpoint detail",
            503,
          ),
          503,
        );
        return;
      }
      const latestExportRequest = state.exportRequests.at(-1) as
        | { readonly outputLocale?: string }
        | undefined;
      const completed = step === "completed";
      await json(route, {
        data: {
          id:
            options.exportDetailIdMismatch === true
              ? E2E_MISMATCHED_EXPORT_BUNDLE_ID
              : exportDetailMatch,
          kind: "client_bundle",
          schemaVersion: "1.0.0",
          outputLocale: latestExportRequest?.outputLocale ?? "en",
          run: asyncRun("export-run", "export", step),
          checksum: completed ? "sha256:e2e-export" : null,
          itemCounts: { findings: 1, actions: 1, artifacts: 1 },
          downloadUrl: completed ? "/mock-download/client.zip" : null,
          downloadExpiresAt: completed ? "2026-07-18T12:15:00.000Z" : null,
          createdAt: NOW,
        },
      });
      return;
    }

    if (method === "GET" && path === BASE) {
      await json(route, { data: project });
      return;
    }

    if (
      method === "GET" &&
      (path === `${BASE}/results` ||
        path === `${BASE}/measurement-windows/recent` ||
        path.match(
          new RegExp(
            `^${BASE}/measurement-windows/[^/]+/(keyword-ranks|geo-citations)$`,
          ),
        ) !== null)
    ) {
      await route.fallback();
      return;
    }

    await json(
      route,
      problem("E2E_ROUTE_MISSING", `${method} ${path} is not mocked.`, 501),
      501,
    );
  });

  return state;
}

/* ------------------------------------------------------------------ *
 * Slice 1 Growth Audit vertical mock (Task 6 growth-map E2E + Task 9  *
 * technical vertical E2E). Extends installCriticalFlowApi with the    *
 * audit projection, opportunity confirmation, recheck, and Results    *
 * surfaces so the four-entry vertical can be driven end to end with   *
 * stable IDs that still mimic the real response contracts.            *
 * ------------------------------------------------------------------ */

export const E2E_ONBOARDING_SITE_PAGE_ID =
  "00000000-0000-4000-8000-000000000800";
export const E2E_ONBOARDING_PAGE_SNAPSHOT_ID =
  "00000000-0000-4000-8000-000000000801";
export const E2E_AUDIT_DIAGNOSTIC_RUN_ID =
  "00000000-0000-4000-8000-000000000802";
export const E2E_AUDIT_CRAWL_SNAPSHOT_ID =
  "00000000-0000-4000-8000-000000000803";
export const E2E_SECOND_SITE_PAGE_ID = "00000000-0000-4000-8000-000000000804";
export const E2E_SECOND_PAGE_SNAPSHOT_ID =
  "00000000-0000-4000-8000-000000000805";
export const E2E_RESOURCE_SITE_PAGE_ID =
  "00000000-0000-4000-8000-000000000806";
export const E2E_INTERNAL_LINK_OBSERVATION_ID =
  "00000000-0000-4000-8000-000000000807";
export const E2E_INTERNAL_LINK_TOPIC_ID =
  "00000000-0000-4000-8000-000000000808";
export const E2E_GROWTH_MAP_TOPIC_NODE_ID =
  "00000000-0000-4000-8000-000000000830";
const E2E_GROWTH_MAP_TOPIC_ALIAS_ID =
  "00000000-0000-4000-8000-000000000831";
const E2E_GROWTH_MAP_TOPIC_ACTOR_ID =
  "00000000-0000-4000-8000-000000000832";
const E2E_SEARCH_QUERY_OBSERVATION_ID =
  "00000000-0000-4000-8000-000000000833";
const E2E_SEARCH_QUERY_SNAPSHOT_ID =
  "00000000-0000-4000-8000-000000000834";
const E2E_GENERATIVE_QUERY_OBSERVATION_ID =
  "00000000-0000-4000-8000-000000000835";
const E2E_GENERATIVE_QUERY_SNAPSHOT_ID =
  "00000000-0000-4000-8000-000000000836";

/** Three separately reviewable Findings on one URL: one per Slice 1 artifact type. */
export const E2E_CANONICAL_FINDING_ID = "00000000-0000-4000-8000-000000000810";
export const E2E_CTR_FINDING_ID = "00000000-0000-4000-8000-000000000811";
export const E2E_CONTENT_FINDING_ID = "00000000-0000-4000-8000-000000000812";
export const E2E_CANONICAL_EVIDENCE_ID = "00000000-0000-4000-8000-000000000820";
export const E2E_CTR_EVIDENCE_ID = "00000000-0000-4000-8000-000000000821";
export const E2E_CONTENT_EVIDENCE_ID = "00000000-0000-4000-8000-000000000822";

export const E2E_PRIOR_AUDIT_RUN_ID = "00000000-0000-4000-8000-000000000840";
export const E2E_RECHECK_RUN_ID = "00000000-0000-4000-8000-000000000841";
export const E2E_RECHECK_AUDIT_RUN_ID = "00000000-0000-4000-8000-000000000842";
export const E2E_PROFILE_ROW_ID = "00000000-0000-4000-8000-000000000850";
export const E2E_PRIMARY_AUDIENCE_ID = "00000000-0000-4000-8000-000000000851";
export const E2E_DIRECT_COMPETITOR_ID = "00000000-0000-4000-8000-000000000852";

export const E2E_ONBOARDING_URL = "https://example.test/customer-onboarding";

/** Which confirmed Action the recheck re-verifies (reuses the canonical Action). */
export const E2E_CANONICAL_ACTION_ID = action.id;
/** The technical-ticket Artifact promoted to `ready` when work is marked done. */
export const E2E_ARTIFACT_ID = artifact.id;

const AUDIT_OBSERVED_AT = NOW;
const RECHECK_OBSERVED_AT = "2026-07-21T09:00:00.000Z";

type FindingKind = "canonical" | "ctr" | "content";

const FINDING_BLUEPRINT: Readonly<
  Record<
    FindingKind,
    {
      readonly findingId: string;
      readonly evidenceId: string;
      readonly ruleId: string;
      readonly ruleVersion: number;
      readonly title: string;
      readonly severity: "critical" | "high" | "medium" | "low";
    }
  >
> = {
  canonical: {
    findingId: E2E_CANONICAL_FINDING_ID,
    evidenceId: E2E_CANONICAL_EVIDENCE_ID,
    ruleId: "TECH-CANONICAL-002",
    ruleVersion: 2,
    title: "The onboarding page points to a conflicting canonical URL.",
    severity: "high",
  },
  ctr: {
    findingId: E2E_CTR_FINDING_ID,
    evidenceId: E2E_CTR_EVIDENCE_ID,
    ruleId: "SEARCH-CTR-004",
    ruleVersion: 1,
    title:
      "The onboarding page underperforms its impressions on click-through.",
    severity: "medium",
  },
  content: {
    findingId: E2E_CONTENT_FINDING_ID,
    evidenceId: E2E_CONTENT_EVIDENCE_ID,
    ruleId: "CONTENT-COVERAGE-001",
    ruleVersion: 1,
    title: "The onboarding page has a measured content coverage gap.",
    severity: "medium",
  },
};

const ALL_FINDING_IDS = [
  E2E_CANONICAL_FINDING_ID,
  E2E_CTR_FINDING_ID,
  E2E_CONTENT_FINDING_ID,
];

function onboardingFinding(
  kind: FindingKind,
  confirmedFindingIds: ReadonlySet<string>,
): GrowthMapUrlFinding {
  const spec = FINDING_BLUEPRINT[kind];
  return {
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    findingId: spec.findingId,
    diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
    ruleId: spec.ruleId,
    ruleVersion: spec.ruleVersion,
    title: spec.title,
    severity: spec.severity,
    reviewState: confirmedFindingIds.has(spec.findingId)
      ? "confirmed"
      : "unreviewed",
    reviewRevision: confirmedFindingIds.has(spec.findingId) ? 1 : 0,
    active: true,
    regressed: false,
    evidenceIds: [spec.evidenceId],
    targetRelation: {
      relation: "direct_url",
      targetKind: "url",
      targetRef: E2E_ONBOARDING_URL,
      sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
      pageSnapshotId: E2E_ONBOARDING_PAGE_SNAPSHOT_ID,
    },
    executionPreview: null,
    executionRef: null,
  };
}

function onboardingPortfolioItem(input: {
  readonly sitePageId: string;
  readonly pageSnapshotId: string;
  readonly normalizedUrl: string;
  readonly title: string;
  readonly findingIds: readonly string[];
  readonly reviewableFindingIds: readonly string[];
  readonly priority?: "critical" | "high" | "medium" | "low";
  readonly clusterKey?: string | null;
}): GrowthMapUrlPortfolioItem {
  const findingIds = [...input.findingIds];
  const hasPriority = input.priority !== undefined && findingIds.length > 0;
  return {
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: E2E_AUDIT_CRAWL_SNAPSHOT_ID,
    sitePageId: input.sitePageId,
    pageSnapshotId: input.pageSnapshotId,
    pageSnapshotCapturedAt: AUDIT_OBSERVED_AT,
    identitySources: [
      {
        kind: "page_snapshot",
        provider: "crawl",
        snapshotId: E2E_AUDIT_CRAWL_SNAPSHOT_ID,
        pageSnapshotId: input.pageSnapshotId,
        observedAt: AUDIT_OBSERVED_AT,
      },
    ],
    normalizedUrl: input.normalizedUrl,
    title: input.title,
    pageType: "documentation",
    templateKey: "guide-detail",
    clusterKey: input.clusterKey ?? null,
    ownerId: null,
    coverage: {
      availability: "partial",
      limitations: [
        "No customer analytics source is available for this URL, so click-through evidence is absent.",
      ],
    },
    metricObservations: [],
    findingIds,
    reviewableFindingIds: [...input.reviewableFindingIds],
    priority: hasPriority
      ? {
          availability: "available",
          value: input.priority!,
          basis: {
            derivationVersion: "url_opportunity_rank.v1",
            projectId: E2E_PROJECT_ID,
            siteId: E2E_SITE_ID,
            diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
            sitePageId: input.sitePageId,
            findingIds,
          },
          limitation: null,
        }
      : {
          availability: "unavailable",
          value: null,
          limitation: "No current-run Finding targets this URL.",
        },
    delta: {
      availability: "unavailable",
      value: null,
      limitation: "No immutable before-and-after recheck is available.",
    },
  };
}

function countPriorityBand(
  items: readonly GrowthMapUrlPortfolioItem[],
  band: "critical" | "high" | "medium" | "low",
): number {
  return items.filter(
    (item) =>
      item.priority.availability === "available" && item.priority.value === band,
  ).length;
}

/**
 * The generation-wide counts the portfolio contract requires beside every page.
 * They are derived from the fixture rows rather than hand-written so the mock
 * can never claim a total its own rows contradict.
 */
function portfolioSummary(items: readonly GrowthMapUrlPortfolioItem[]) {
  const opportunityUrls = items.filter((item) => item.findingIds.length > 0);
  const signalIds = new Set(
    opportunityUrls.flatMap((item) => [...item.findingIds]),
  );
  return {
    urlCount: items.length,
    opportunityUrlCount: opportunityUrls.length,
    listedUrlCount: items.length,
    signalCount: signalIds.size,
    priorityCounts: {
      critical: countPriorityBand(opportunityUrls, "critical"),
      high: countPriorityBand(opportunityUrls, "high"),
      medium: countPriorityBand(opportunityUrls, "medium"),
      low: countPriorityBand(opportunityUrls, "low"),
    },
    precedingUrlCount: 0,
  };
}

function onboardingReviewableIds(
  confirmedFindingIds: ReadonlySet<string>,
): readonly string[] {
  return ALL_FINDING_IDS.filter((id) => !confirmedFindingIds.has(id));
}

/** The multi-URL portfolio the Growth Map and Overview both read. */
export function growthAuditPortfolioFixture(
  confirmedFindingIds: ReadonlySet<string> = new Set(),
): GrowthMapUrlPortfolioResponse {
  const onboarding = onboardingPortfolioItem({
    sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
    pageSnapshotId: E2E_ONBOARDING_PAGE_SNAPSHOT_ID,
    normalizedUrl: E2E_ONBOARDING_URL,
    title: "Customer onboarding guide",
    findingIds: ALL_FINDING_IDS,
    reviewableFindingIds: onboardingReviewableIds(confirmedFindingIds),
    priority: "high",
    clusterKey: "customer-onboarding",
  });
  const secondary = onboardingPortfolioItem({
    sitePageId: E2E_SECOND_SITE_PAGE_ID,
    pageSnapshotId: E2E_SECOND_PAGE_SNAPSHOT_ID,
    normalizedUrl: "https://example.test/pricing",
    title: "Pricing overview",
    findingIds: [],
    reviewableFindingIds: [],
    clusterKey: "customer-onboarding",
  });
  return GrowthMapUrlPortfolioResponseSchema.parse({
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: E2E_AUDIT_CRAWL_SNAPSHOT_ID,
    data: [onboarding, secondary],
    meta: {
      limit: 50,
      nextCursor: null,
      hasNext: false,
      summary: portfolioSummary([onboarding, secondary]),
      coverage: {
        availability: "partial",
        limitations: [
          "One customer analytics source is not available for this audit.",
        ],
      },
    },
  });
}

/** The selected onboarding URL detail with three separately reviewable Findings. */
export function growthAuditDetailFixture(
  confirmedFindingIds: ReadonlySet<string> = new Set(),
  sitePageId = E2E_ONBOARDING_SITE_PAGE_ID,
): GrowthMapUrlDetailResponse {
  if (sitePageId === E2E_SECOND_SITE_PAGE_ID) {
    const item = onboardingPortfolioItem({
      sitePageId: E2E_SECOND_SITE_PAGE_ID,
      pageSnapshotId: E2E_SECOND_PAGE_SNAPSHOT_ID,
      normalizedUrl: "https://example.test/pricing",
      title: "Pricing overview",
      findingIds: [],
      reviewableFindingIds: [],
      clusterKey: "customer-onboarding",
    });
    return GrowthMapUrlDetailResponseSchema.parse({
      projectId: E2E_PROJECT_ID,
      siteId: E2E_SITE_ID,
      diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
      crawlSnapshotId: E2E_AUDIT_CRAWL_SNAPSHOT_ID,
      data: {
        ...item,
        findings: [],
      },
    });
  }
  const item = onboardingPortfolioItem({
    sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
    pageSnapshotId: E2E_ONBOARDING_PAGE_SNAPSHOT_ID,
    normalizedUrl: E2E_ONBOARDING_URL,
    title: "Customer onboarding guide",
    findingIds: ALL_FINDING_IDS,
    reviewableFindingIds: onboardingReviewableIds(confirmedFindingIds),
    priority: "high",
    clusterKey: "customer-onboarding",
  });
  return GrowthMapUrlDetailResponseSchema.parse({
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: E2E_AUDIT_CRAWL_SNAPSHOT_ID,
    data: {
      ...item,
      findings: [
        onboardingFinding("canonical", confirmedFindingIds),
        onboardingFinding("ctr", confirmedFindingIds),
        onboardingFinding("content", confirmedFindingIds),
      ],
    },
  });
}

const OPPORTUNITY_FIXTURE_BLUEPRINT = {
  canonical: {
    workShape: "fix",
    lens: "site_health",
    artifactType: "technical_ticket",
    templateId: "fix_canonical_conflict.v1",
    previewTitle: "Fix the conflicting canonical URL",
    previewDescription:
      "Align the onboarding page with one canonical destination and verify the rendered tag.",
    expectedOutcome:
      "The page exposes one consistent canonical URL in the next crawl.",
    actionId: E2E_CANONICAL_ACTION_ID,
  },
  ctr: {
    workShape: "improve",
    lens: "search_ai_visibility",
    artifactType: "metadata_rewrite",
    templateId: "improve_search_ctr.v1",
    previewTitle: "Improve the onboarding search snippet",
    previewDescription:
      "Rewrite the title and description around the observed onboarding intent.",
    expectedOutcome:
      "The next review can compare the exact metadata change against later observations.",
    actionId: "00000000-0000-4000-8000-000000000837",
  },
  content: {
    workShape: "improve",
    lens: "demand_competition",
    artifactType: "content_brief",
    templateId: "improve_content_coverage.v1",
    previewTitle: "Close the onboarding content coverage gap",
    previewDescription:
      "Expand the existing guide around the governed onboarding questions and decision criteria.",
    expectedOutcome:
      "The page covers the governed intent more completely without inventing a ranking outcome.",
    actionId: "00000000-0000-4000-8000-000000000838",
  },
} as const satisfies Readonly<
  Record<
    FindingKind,
    {
      readonly workShape: "fix" | "improve";
      readonly lens:
        | "site_health"
        | "search_ai_visibility"
        | "demand_competition";
      readonly artifactType:
        | "technical_ticket"
        | "metadata_rewrite"
        | "content_brief";
      readonly templateId: string;
      readonly previewTitle: string;
      readonly previewDescription: string;
      readonly expectedOutcome: string;
      readonly actionId: string;
    }
  >
>;

function opportunitySearchQueries(kind: FindingKind) {
  return kind === "content"
    ? [
        {
          queryKind: "search" as const,
          observationId: E2E_SEARCH_QUERY_OBSERVATION_ID,
          snapshotId: E2E_SEARCH_QUERY_SNAPSHOT_ID,
          query: "Customer onboarding software",
          marketCode: "US",
          languageCode: "en-US",
          sourceProvider: "dataforseo",
          observedAt: AUDIT_OBSERVED_AT,
          freshness: "current" as const,
          limitation: "One immutable provider observation.",
          metrics: {
            monthlyVolume: 900,
            keywordDifficulty: 42,
            organicRank: null,
            impressions: null,
            clicks: null,
          },
        },
      ]
    : [];
}

function opportunityGenerativeQueries(kind: FindingKind) {
  return kind === "content"
    ? [
        {
          queryKind: "generative" as const,
          observationId: E2E_GENERATIVE_QUERY_OBSERVATION_ID,
          snapshotId: E2E_GENERATIVE_QUERY_SNAPSHOT_ID,
          query: "How do I automate customer onboarding?",
          marketCode: "US",
          languageCode: "en-US",
          sourceProvider: "answer-sample",
          observedAt: AUDIT_OBSERVED_AT,
          freshness: "current" as const,
          limitation: "Three immutable answer samples.",
          metrics: {
            sampleSize: 3,
            brandMentionCount: 1,
            brandCitationCount: 1,
            citedCompetitorCount: 2,
          },
        },
      ]
    : [];
}

function growthOpportunityFixture(
  kind: FindingKind,
  confirmedFindingIds: ReadonlySet<string>,
): GrowthOpportunity {
  const findingSpec = FINDING_BLUEPRINT[kind];
  const opportunitySpec = OPPORTUNITY_FIXTURE_BLUEPRINT[kind];
  const executionPreview = {
    templateId: opportunitySpec.templateId,
    templateVersion: 1 as const,
    artifactType: opportunitySpec.artifactType,
    effort: "medium" as const,
    risk: "low" as const,
    contentLocale: "en" as const,
    title: opportunitySpec.previewTitle,
    description: opportunitySpec.previewDescription,
    expectedOutcome: opportunitySpec.expectedOutcome,
  };
  const base = {
    opportunityKey: `url:/customer-onboarding:${findingSpec.ruleId}`,
    title: findingSpec.title,
    workShape: opportunitySpec.workShape,
    primaryTarget: "url" as const,
    targetRef: E2E_ONBOARDING_URL,
    evidenceSummary: [
      {
        traceKind: "evidence" as const,
        evidenceId: findingSpec.evidenceId,
        diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
        snapshotId: E2E_AUDIT_CRAWL_SNAPSHOT_ID,
        collectionRunId: CRAWL_COLLECTION_RUN_ID,
        analysisInvocationId: null,
        sourceProvider: "crawl",
        availability: "available" as const,
        support: "supports" as const,
        observedAt: AUDIT_OBSERVED_AT,
        freshness: "current" as const,
        claim: findingSpec.title,
        limitation: "One immutable crawl snapshot.",
      },
    ],
    searchQueries: opportunitySearchQueries(kind),
    generativeQueries: opportunityGenerativeQueries(kind),
    competitorRefs: [],
    currentOwnedAsset: {
      sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
      snapshotId: E2E_ONBOARDING_PAGE_SNAPSHOT_ID,
      url: E2E_ONBOARDING_URL,
      suitableForIntent: true,
    },
    supportingFindingIds: [],
    lenses: [opportunitySpec.lens],
    coverageAndLimitations: [
      "One immutable crawl snapshot; no publication or ranking outcome is inferred.",
    ],
    primaryFindingId: findingSpec.findingId,
    primaryRule: {
      ruleId: findingSpec.ruleId,
      ruleVersion: findingSpec.ruleVersion,
    },
    executionPreview,
  };

  return GrowthOpportunitySchema.parse(
    confirmedFindingIds.has(findingSpec.findingId)
      ? {
          ...base,
          readiness: "confirmed",
          actionId: opportunitySpec.actionId,
          action: {
            actionId: opportunitySpec.actionId,
            findingId: findingSpec.findingId,
            status: "planned",
            artifactType: opportunitySpec.artifactType,
          },
        }
      : {
          ...base,
          readiness: "reviewable",
        },
  );
}

/** Complete frozen Opportunity projection used by the default page view. */
export function growthOpportunitiesFixture(
  confirmedFindingIds: ReadonlySet<string> = new Set(),
) {
  return {
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
    data: (["canonical", "ctr", "content"] as const).map((kind) =>
      growthOpportunityFixture(kind, confirmedFindingIds),
    ),
    meta: { limit: 100, nextCursor: null, hasNext: false },
  };
}

/** Confirmed Topic authority maps the legacy URL cluster key to one stable UUID. */
export function growthMapTopicWorkspaceFixture(): TopicModelWorkspaceProjection {
  return TopicModelWorkspaceProjectionSchema.parse({
    projectId: E2E_PROJECT_ID,
    latestConfirmed: {
      projectId: E2E_PROJECT_ID,
      topicModelRevision: 3,
      editRevision: 2,
      rootTopicNodeId: E2E_GROWTH_MAP_TOPIC_NODE_ID,
      nodes: [
        {
          projectId: E2E_PROJECT_ID,
          topicNodeId: E2E_GROWTH_MAP_TOPIC_NODE_ID,
          topicModelRevision: 3,
          parentTopicNodeId: null,
          label: "Customer onboarding",
          description: "Implementation, handoffs, and time-to-value guidance.",
          intentEnvelope: ["commercial", "informational"],
          lifecycleState: "active",
        },
      ],
      aliases: [
        {
          aliasId: E2E_GROWTH_MAP_TOPIC_ALIAS_ID,
          projectId: E2E_PROJECT_ID,
          topicNodeId: E2E_GROWTH_MAP_TOPIC_NODE_ID,
          clusterKey: "customer-onboarding",
          validFromTopicModelRevision: 3,
          validThroughTopicModelRevision: null,
          isCurrent: true,
        },
      ],
      successorRelationships: [],
      createdAt: "2026-07-17T12:00:00.000Z",
      createdBy: E2E_GROWTH_MAP_TOPIC_ACTOR_ID,
      state: "confirmed",
      confirmedAt: "2026-07-18T11:00:00.000Z",
      confirmedBy: E2E_GROWTH_MAP_TOPIC_ACTOR_ID,
      contentHash: "e".repeat(64),
    },
    draft: null,
    generatedAt: AUDIT_OBSERVED_AT,
  });
}

export function growthMapTopicInsightsFixture(): GrowthMapTopicModelInsights {
  return GrowthMapTopicModelInsightsSchema.parse({
    projectId: E2E_PROJECT_ID,
    topicModelRevision: 3,
    nodes: [
      {
        projectId: E2E_PROJECT_ID,
        topicNodeId: E2E_GROWTH_MAP_TOPIC_NODE_ID,
        topicModelRevision: 3,
        label: "Customer onboarding",
        keywordCount: 3,
        approvedKeywordCount: 2,
        reviewPendingKeywordCount: 1,
        existingPageKeywordCount: 2,
        newAssetKeywordCount: 1,
        unassignedKeywordCount: 0,
        mappedPageCount: 2,
        conflictingIntentCount: 0,
        coverageState: "partial",
        limitation:
          "One governed Keyword still requires a new answer asset before this Topic is fully covered.",
      },
    ],
    coverage: {
      availability: "partial",
      limitations: ["One governed Keyword still requires a new asset."],
    },
    generatedAt: AUDIT_OBSERVED_AT,
  });
}

export function growthInternalLinkMapFixture(
  selectedSitePageId: string,
): GrowthMapInternalLinkMap {
  const onboardingUrl = E2E_ONBOARDING_URL;
  const pricingUrl = "https://example.test/pricing";
  const resourcesUrl = "https://example.test/resources";
  const observedEdge = {
    sourceCanonicalUrl: pricingUrl,
    targetCanonicalUrl: onboardingUrl,
    sourceSitePageIds: [E2E_SECOND_SITE_PAGE_ID],
    targetSitePageIds: [E2E_ONBOARDING_SITE_PAGE_ID],
    facts: [
      {
        observationId: E2E_INTERNAL_LINK_OBSERVATION_ID,
        sourceSitePageId: E2E_SECOND_SITE_PAGE_ID,
        anchorText: "Customer onboarding",
        rel: null,
      },
    ],
    reciprocal: false,
  };
  const selectedOnboarding =
    selectedSitePageId === E2E_ONBOARDING_SITE_PAGE_ID;
  const selectedPricing =
    selectedSitePageId === E2E_SECOND_SITE_PAGE_ID;
  const selectedPage = selectedOnboarding
    ? {
        selectedSitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
        canonicalUrl: onboardingUrl,
        inboundSources: [observedEdge],
        recommendationCoverage: {
          availability: "available" as const,
          limitations: [],
        },
        recommendations: [
          {
            sourceCanonicalUrl: resourcesUrl,
            sourceSitePageIds: [E2E_RESOURCE_SITE_PAGE_ID],
            targetCanonicalUrl: onboardingUrl,
            targetSitePageIds: [E2E_ONBOARDING_SITE_PAGE_ID],
            basis: {
              kind: "same_confirmed_topic" as const,
              topicNodeId: E2E_INTERNAL_LINK_TOPIC_ID,
              topicModelRevision: 3,
              topicLabel: "Customer onboarding",
            },
            explanation:
              "资源页与目标页属于同一个已确认 Topic，冻结 Crawl 中未观察到这个链接方向。",
          },
        ],
        totalRecommendationCount: 1,
        recommendationsTruncated: false,
      }
    : selectedPricing
      ? {
          selectedSitePageId: E2E_SECOND_SITE_PAGE_ID,
          canonicalUrl: pricingUrl,
          inboundSources: [],
          recommendationCoverage: {
            availability: "available" as const,
            limitations: [],
          },
          recommendations: [
            {
              sourceCanonicalUrl: onboardingUrl,
              sourceSitePageIds: [E2E_ONBOARDING_SITE_PAGE_ID],
              targetCanonicalUrl: pricingUrl,
              targetSitePageIds: [E2E_SECOND_SITE_PAGE_ID],
              basis: {
                kind: "same_confirmed_topic" as const,
                topicNodeId: E2E_INTERNAL_LINK_TOPIC_ID,
                topicModelRevision: 3,
                topicLabel: "Customer onboarding",
              },
              explanation:
                "产品页与价格页属于同一个已确认 Topic，冻结 Crawl 中未观察到这个链接方向。",
            },
          ],
          totalRecommendationCount: 1,
          recommendationsTruncated: false,
        }
      : null;

  return GrowthMapInternalLinkMapSchema.parse({
    projectId: E2E_PROJECT_ID,
    diagnosticRunId: E2E_AUDIT_DIAGNOSTIC_RUN_ID,
    crawlSnapshot: {
      snapshotId: E2E_AUDIT_CRAWL_SNAPSHOT_ID,
      capturedAt: AUDIT_OBSERVED_AT,
      availability: "available",
      limitation: null,
    },
    coverage: {
      availability: "available",
      crawlCompleteness: "complete",
      limitations: [],
    },
    graph: {
      nodes: [
        {
          canonicalUrl: onboardingUrl,
          sitePageIds: [E2E_ONBOARDING_SITE_PAGE_ID],
          title: "Customer onboarding guide",
          inboundCount: 1,
          outboundCount: 0,
          status: "one_way",
          executionRefs: [
            {
              findingId: E2E_CANONICAL_FINDING_ID,
              actionId: E2E_CANONICAL_ACTION_ID,
            },
          ],
        },
        {
          canonicalUrl: pricingUrl,
          sitePageIds: [E2E_SECOND_SITE_PAGE_ID],
          title: "Pricing overview",
          inboundCount: 0,
          outboundCount: 1,
          status: "one_way",
          executionRefs: [
            {
              findingId: E2E_CONTENT_FINDING_ID,
              actionId: null,
            },
          ],
        },
        {
          canonicalUrl: resourcesUrl,
          sitePageIds: [E2E_RESOURCE_SITE_PAGE_ID],
          title: "Resources",
          inboundCount: 0,
          outboundCount: 0,
          status: "orphan",
          executionRefs: [],
        },
      ],
      edges: [observedEdge],
      totalEdgeCount: 1,
      edgesTruncated: false,
    },
    selectedPage,
    generatedAt: "2026-07-28T08:05:00.000Z",
  });
}

/** Prior-vs-new recheck comparison; technical condition only, no lift claims. */
export function recheckResultsFixture(): ActionRecheckResultsResponse {
  return ActionRecheckResultsResponseSchema.parse({
    priorRunId: E2E_PRIOR_AUDIT_RUN_ID,
    currentRunId: E2E_RECHECK_AUDIT_RUN_ID,
    priorObservedAt: AUDIT_OBSERVED_AT,
    currentObservedAt: RECHECK_OBSERVED_AT,
    rules: [
      {
        ruleId: "TECH-CANONICAL-002",
        ruleVersion: 2,
        priorStatus: "candidate",
        currentStatus: "pass",
        state: "verified",
        disposition: "resolved",
        label: "Technical condition verified",
      },
    ],
    limitations: [
      "This recheck compares only the technical rule condition between two immutable runs.",
    ],
  });
}

function measurementFixtureId(value: number): string {
  return `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function measurementWindowFixture({
  offset,
  canonicalUrl,
  recordedAt,
  clicks,
  sessions,
  directConversions = [18, 27],
  campaignDirectConversions = [7, 12],
  campaign,
}: {
  readonly offset: number;
  readonly canonicalUrl: string;
  readonly recordedAt: string;
  readonly clicks: readonly [number, number];
  readonly sessions: readonly [number, number];
  readonly directConversions?: readonly [number, number];
  readonly campaignDirectConversions?: readonly [number, number];
  readonly campaign: string;
}): MeasurementWindow {
  const beforeWindow = {
    startAt: "2026-05-23T12:00:00.000Z",
    endAt: "2026-06-20T12:00:00.000Z",
  };
  const afterWindow = {
    startAt: "2026-06-20T12:00:00.000Z",
    endAt: "2026-07-18T12:00:00.000Z",
  };
  const id = (delta: number) => measurementFixtureId(offset + delta);
  const artifactContentHash = "a".repeat(64);
  const contentChecksum = "b".repeat(64);

  return {
    measurementWindowId: id(1),
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    target: {
      kind: "url",
      targetRef: `site-page://${id(2)}`,
      sitePageId: id(2),
    },
    actionId: id(3),
    artifactId: id(4),
    artifactRevisionId: id(5),
    artifactRevision: 2,
    artifactContentHash,
    publicationAttemptId: id(6),
    verifiedChangeReceipt: {
      id: id(7),
      providerKind: "github",
      providerRequestId: `merge-${offset}`,
      remoteScopeRef: "github:repository:gengrowth/e2e",
      remoteObjectId: String(offset),
      remoteRevision: `merge-sha-${offset}`,
      deliveryUrl: `https://github.com/gengrowth/e2e/pull/${offset}`,
      artifactContentHash,
      contentChecksum,
      remoteFacts: {},
      observedAt: "2026-06-20T12:00:00.000Z",
      receiptKind: "change_receipt",
      predecessorDeliveryReceiptId: id(8),
      remoteObjectKind: "github_merge",
      liveCanonicalUrl: canonicalUrl,
      verificationState: "verified_live",
      evidenceRefs: [`evidence://github/merge/${offset}`],
      limitation: null,
    },
    timelineDeliveryReceipt: null,
    beforeWindow,
    afterWindow,
    timezone: "UTC",
    url: canonicalUrl,
    canonicalUrl,
    interpretation: "observational_non_causal",
    state: "observed",
    technicalVerificationRef: null,
    limitation:
      "固定窗口观测仅用于判断变化方向，不把结果归因给单一交付物。",
    dimensions: {
      gsc: {
        provider: "gsc",
        state: "observed",
        baselineSource: {
          provider: "gsc",
          sourceRef: id(9),
          snapshotId: id(10),
          coveredWindow: beforeWindow,
          observedAt: "2026-06-20T13:00:00.000Z",
          freshness: "current",
        },
        outcomeSource: {
          provider: "gsc",
          sourceRef: id(9),
          snapshotId: id(11),
          coveredWindow: afterWindow,
          observedAt: "2026-07-18T13:00:00.000Z",
          freshness: "current",
        },
        sampleSize: {
          baseline: 12_400,
          outcome: 15_600,
          unit: "impressions",
          coverage: "complete",
        },
        limitation: null,
        metrics: {
          clicks: { baseline: clicks[0], outcome: clicks[1] },
          impressions: { baseline: 12_400, outcome: 15_600 },
          ctr: { baseline: 0.033, outcome: 0.0368 },
          averagePosition: { baseline: 15.2, outcome: 10.4 },
        },
      },
      ga4: {
        provider: "ga4",
        state: "observed",
        baselineSource: {
          provider: "ga4",
          sourceRef: id(12),
          snapshotId: id(13),
          coveredWindow: beforeWindow,
          observedAt: "2026-06-20T13:00:00.000Z",
          freshness: "current",
        },
        outcomeSource: {
          provider: "ga4",
          sourceRef: id(12),
          snapshotId: id(14),
          coveredWindow: afterWindow,
          observedAt: "2026-07-18T13:00:00.000Z",
          freshness: "current",
        },
        sampleSize: {
          baseline: sessions[0],
          outcome: sessions[1],
          unit: "sessions",
          coverage: "complete",
        },
        limitation: null,
        directConversionDefinition: {
          conversionDefinitionId: id(15),
          kind: "direct",
          eventNames: ["generate_lead"],
          countingMethod: "once_per_session",
          attributionBoundary: "ga4_reported_primary_touchpoint",
          lookbackWindowDays: 30,
        },
        assistedConversionDefinition: {
          conversionDefinitionId: id(16),
          kind: "assisted",
          eventNames: ["generate_lead"],
          countingMethod: "once_per_session",
          attributionBoundary: "path_touchpoint_not_primary",
          lookbackWindowDays: 30,
        },
        metrics: {
          sessions: { baseline: sessions[0], outcome: sessions[1] },
          engagedSessions: { baseline: 214, outcome: 302 },
          directConversions: {
            baseline: directConversions[0],
            outcome: directConversions[1],
          },
          assistedConversions: { baseline: 11, outcome: 19 },
        },
        campaigns: [
          {
            identity: {
              utmIdentityId: id(17),
              source: "google",
              medium: "organic",
              campaign,
              content: "guide",
            },
            metrics: {
              sessions: { baseline: 118, outcome: 171 },
              directConversions: {
                baseline: campaignDirectConversions[0],
                outcome: campaignDirectConversions[1],
              },
              assistedConversions: { baseline: 3, outcome: 7 },
            },
          },
        ],
      },
      geo: {
        provider: "geo",
        state: offset === 100 ? "observed" : "unavailable",
        baselineSource:
          offset === 100
            ? {
                provider: "geo",
                sourceRef: id(18),
                snapshotId: id(19),
                coveredWindow: beforeWindow,
                observedAt: "2026-06-20T13:00:00.000Z",
                freshness: "current",
              }
            : null,
        outcomeSource:
          offset === 100
            ? {
                provider: "geo",
                sourceRef: id(18),
                snapshotId: id(20),
                coveredWindow: afterWindow,
                observedAt: "2026-07-18T13:00:00.000Z",
                freshness: "current",
              }
            : null,
        sampleSize: {
          baseline: offset === 100 ? 20 : null,
          outcome: offset === 100 ? 20 : null,
          unit: "tracked_queries",
          coverage: offset === 100 ? "complete" : "none",
        },
        limitation:
          offset === 100
            ? "固定窗口中的 AI 回答为独立观测，不支持单一交付物因果结论。"
            : "当前 URL 尚未接入可验证的 GEO 引用观测来源。",
        metrics: {
          trackedQueries: {
            baseline: offset === 100 ? 20 : null,
            outcome: offset === 100 ? 20 : null,
          },
          citedQueries: {
            baseline: offset === 100 ? 3 : null,
            outcome: offset === 100 ? 7 : null,
          },
          citations: {
            baseline: offset === 100 ? 4 : null,
            outcome: offset === 100 ? 9 : null,
          },
          citationRate: {
            baseline: offset === 100 ? 0.15 : null,
            outcome: offset === 100 ? 0.35 : null,
          },
        },
      },
    },
    recordedAt,
  };
}

/** Two independently selectable URL windows for the customer Results surface. */
export function recentMeasurementWindowsFixture(): MeasurementWindowRecentResponse {
  return MeasurementWindowRecentResponseSchema.parse({
    projectId: E2E_PROJECT_ID,
    windows: [
      measurementWindowFixture({
        offset: 100,
        canonicalUrl: "https://example.test/customer-onboarding/",
        recordedAt: "2026-07-22T13:00:00.000Z",
        clicks: [410, 574],
        sessions: [350, 470],
        campaign: "customer-onboarding",
      }),
      measurementWindowFixture({
        offset: 200,
        canonicalUrl: "https://example.test/pricing/",
        recordedAt: "2026-07-21T13:00:00.000Z",
        clicks: [721, 982],
        sessions: [505, 688],
        directConversions: [9, 14],
        campaignDirectConversions: [2, 6],
        campaign: "pricing-intent",
      }),
    ],
    generatedAt: "2026-07-23T13:00:00.000Z",
  });
}

function targetKeywordRankPoint(input: {
  readonly idOffset: number;
  readonly phase: "before" | "after";
  readonly value: number;
}) {
  const observedAt =
    input.phase === "before"
      ? "2026-06-01T12:00:00.000Z"
      : "2026-07-01T12:00:00.000Z";
  return {
    occurrenceId: measurementFixtureId(input.idOffset),
    snapshotId: measurementFixtureId(input.idOffset + 1),
    observationId: measurementFixtureId(input.idOffset + 2),
    provider: "dataforseo" as const,
    metric: "absolute_rank" as const,
    value: input.value,
    valuePointer: "/valueJson/currentRank",
    observedAt,
    providerDataAsOf: null,
    grade: "B" as const,
    limitation:
      "DataForSEO does not expose a separate provider data-as-of timestamp.",
  };
}

/** Per-URL governed target Keyword ranks for the Results comparison. */
export function measurementTargetKeywordRanksFixture(
  measurementWindowId: string,
): MeasurementTargetKeywordRanks {
  const pricing =
    measurementWindowId === measurementFixtureId(201);
  const offset = pricing ? 200 : 100;
  const keywordId = measurementFixtureId(offset + 30);
  const beforeRank = pricing ? 8 : 12;
  const afterRank = pricing ? 9 : 7;
  const rankImprovement = beforeRank - afterRank;
  const canonicalUrl = pricing
    ? "https://example.test/pricing/"
    : "https://example.test/customer-onboarding/";

  return MeasurementTargetKeywordRanksSchema.parse({
    projectId: E2E_PROJECT_ID,
    measurementWindowId: measurementFixtureId(offset + 1),
    sitePageId: measurementFixtureId(offset + 2),
    canonicalUrl,
    beforeWindow: {
      startAt: "2026-05-23T12:00:00.000Z",
      endAt: "2026-06-20T12:00:00.000Z",
    },
    afterWindow: {
      startAt: "2026-06-20T12:00:00.000Z",
      endAt: "2026-07-18T12:00:00.000Z",
    },
    interpretation:
      "dataforseo_absolute_rank_observational_non_causal",
    keywords: [
      {
        keywordId,
        displayKeyword: pricing
          ? "customer onboarding pricing"
          : "customer onboarding automation",
        normalizedKeyword: pricing
          ? "customer onboarding pricing"
          : "customer onboarding automation",
        marketCode: "US",
        languageTag: "en-US",
        topicNodeId: measurementFixtureId(offset + 31),
        topicLabel: pricing
          ? "Pricing and packaging"
          : "Customer onboarding",
        topicModelRevision: 3,
        state: "observed",
        baselineObservation: targetKeywordRankPoint({
          idOffset: offset + 32,
          phase: "before",
          value: beforeRank,
        }),
        outcomeObservation: targetKeywordRankPoint({
          idOffset: offset + 35,
          phase: "after",
          value: afterRank,
        }),
        rankImprovement,
        trend:
          rankImprovement > 0
            ? "improved"
            : rankImprovement < 0
              ? "regressed"
              : "unchanged",
        limitation: null,
      },
    ],
    coverage: {
      availability: "available",
      limitations: [
        "DataForSEO absolute rank is compared by collection observation time because the provider does not expose a separate data-as-of timestamp.",
      ],
    },
    generatedAt: "2026-07-23T13:00:00.000Z",
  });
}

/** Immutable per-URL GEO reverse lookup for the Results comparison. */
export function measurementGeoCitationsFixture(
  measurementWindowId: string,
): GeoCitationEvidenceResponse {
  const pricing =
    measurementWindowId === measurementFixtureId(201);
  const offset = pricing ? 200 : 100;
  const canonicalUrl = pricing
    ? "https://example.test/pricing/"
    : "https://example.test/customer-onboarding/";
  const evidence = {
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    measurementWindowId: measurementFixtureId(offset + 1),
    sitePageId: measurementFixtureId(offset + 2),
    canonicalUrl,
    interpretation: "observational_non_causal" as const,
    phases: pricing
      ? { baseline: null, outcome: null }
      : {
          baseline: {
            sourceConnectionId: measurementFixtureId(118),
            snapshotId: measurementFixtureId(119),
            normalizedObservationId:
              measurementFixtureId(121),
            queries: [
              {
                id: measurementFixtureId(122),
                query: "best customer onboarding software",
                platform: {
                  kind: "known" as const,
                  key: "chatgpt" as const,
                },
                model: "gpt-search",
                collector: {
                  kind: "browser_probe" as const,
                  providerKey: "gengrowth-browser",
                  version: "2026-07-28",
                },
                collectedAt: "2026-06-10T12:00:00.000Z",
                marketCode: "US",
                languageTag: "en-US",
                citationState: "cited" as const,
                answerEvidence: {
                  excerpt:
                    "RelayOps appears in the compared onboarding tools.",
                  contentHash: "c".repeat(64),
                  selector: "answer:0",
                },
                limitation:
                  "Point-in-time answer observation; results may vary.",
                citations: [
                  {
                    id: measurementFixtureId(123),
                    citationUrl: canonicalUrl,
                    citationOrdinal: 1,
                    answerEvidenceExcerpt:
                      "RelayOps appears in the compared onboarding tools.",
                    citedPageExcerpt:
                      "Automate customer onboarding handoffs.",
                    citedPageContentHash: "d".repeat(64),
                    citedParagraphHash: "e".repeat(64),
                    citedParagraphSelector:
                      "main p:nth-of-type(2)",
                    citedParagraphIndex: 1,
                    evidenceClassification:
                      "direct_observation" as const,
                  },
                ],
                evidenceStatements: [
                  {
                    classification: "inference" as const,
                    statement:
                      "被引用页面使用了明确的产品定义、分步骤流程和可定位的证据段落；同一查询下未被引用的对照内容缺少这组结构。",
                    evidence: {
                      excerpt:
                        "Definition → workflow steps → evidence-backed implementation guidance.",
                      contentHash: "9".repeat(64),
                      selector: "structure-comparison:0",
                    },
                    limitation:
                      "这是同一固定查询与采集窗口内的结构对照，不证明该结构导致了引用。",
                  },
                ],
              },
            ],
          },
          outcome: {
            sourceConnectionId: measurementFixtureId(118),
            snapshotId: measurementFixtureId(120),
            normalizedObservationId:
              measurementFixtureId(124),
            queries: [
              {
                id: measurementFixtureId(125),
                query: "customer onboarding automation tools",
                platform: {
                  kind: "known" as const,
                  key: "perplexity" as const,
                },
                model: "sonar",
                collector: {
                  kind: "vendor_api" as const,
                  providerKey: "gengrowth-visibility",
                  version: "2026-07-28",
                },
                collectedAt: "2026-07-10T12:00:00.000Z",
                marketCode: "US",
                languageTag: "en-US",
                citationState: "cited" as const,
                answerEvidence: {
                  excerpt:
                    "RelayOps is included in the cited onboarding shortlist.",
                  contentHash: "f".repeat(64),
                  selector: "answer:citation[1]",
                },
                limitation:
                  "Point-in-time answer observation; results may vary.",
                citations: [
                  {
                    id: measurementFixtureId(126),
                    citationUrl: canonicalUrl,
                    citationOrdinal: 1,
                    answerEvidenceExcerpt:
                      "RelayOps is included in the cited onboarding shortlist.",
                    citedPageExcerpt:
                      "Automate customer onboarding handoffs.",
                    citedPageContentHash: "d".repeat(64),
                    citedParagraphHash: "e".repeat(64),
                    citedParagraphSelector:
                      "main p:nth-of-type(2)",
                    citedParagraphIndex: 1,
                    evidenceClassification:
                      "direct_observation" as const,
                  },
                ],
              },
            ],
          },
        },
    limitation: pricing
      ? "当前 URL 尚无真实 GEO 引用观测，不会把缺失值补为 0。"
      : "固定窗口中的 AI 回答为独立观测，不支持单一交付物因果结论。",
  };
  return GeoCitationEvidenceResponseSchema.parse(evidence);
}

function confirmedProfileFixture(): ConfirmedProductProfileRowDto {
  const semanticRoots = [
    "/businessHint",
    "/productName",
    "/oneLiner",
    "/category",
    "/productType",
    "/businessModels",
    "/valueProposition",
    "/coreFeatures",
    "/targetMarkets",
    "/targetAudiences",
    "/competitorCandidates",
  ] as const;
  const profile = ProductProfileDraftSchema.parse({
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: E2E_SITE_ID,
    sourcePageUrl: "https://relayops.com/product/",
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    businessHint: "B2B customer operations software for global teams.",
    productName: "RelayOps",
    oneLiner: "Customer onboarding operations for global B2B teams.",
    category: "Customer Operations",
    productType: "B2B SaaS",
    businessModels: ["Subscription"],
    valueProposition:
      "Standardize complex onboarding without slowing customer-facing teams.",
    coreFeatures: ["Workflow orchestration", "Handoff visibility"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        candidateId: E2E_PRIMARY_AUDIENCE_ID,
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies with 50-500 employees",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize onboarding handoffs"],
        triggers: ["Rising implementation volume"],
        pains: ["Inconsistent handoffs"],
        jtbd: ["Launch customers predictably"],
        outcomes: ["Shorter time to value"],
        barriers: ["Fragmented tooling"],
        qualificationSignals: ["Dedicated customer operations team"],
        disqualifiers: ["No repeatable onboarding motion"],
      },
    ],
    competitorCandidates: [
      {
        candidateId: E2E_DIRECT_COMPETITOR_ID,
        name: "GuideCX",
        domain: "guidecx.com",
        relationship: "direct",
        analysisScope: ["positioning", "keyword_gap"],
        similarity: 0.88,
        reason: "Overlapping customer onboarding workflow category.",
        reviewStatus: "approved",
        confidence: "high",
      },
    ],
    fieldProvenance: semanticRoots.map((path, index) => ({
      path,
      derivation: "declared",
      confidence: "high",
      evidenceRefs: [
        {
          evidenceRefId: `00000000-0000-4000-8000-${String(860 + index).padStart(12, "0")}`,
          kind: "userEdit",
        },
      ],
      limitation: null,
      observedAt: null,
    })),
    missingFields: [],
    conflictingFields: [],
  });

  return ConfirmedProductProfileRowSchema.parse({
    id: E2E_PROFILE_ROW_ID,
    projectId: E2E_PROJECT_ID,
    version: 4,
    status: "complete",
    profile,
    contentHash: "d".repeat(64),
    createdAt: NOW,
    isCurrent: true,
    isConfirmed: true,
  });
}

export interface GrowthVerticalApiState {
  readonly critical: CriticalFlowApiState;
  readonly auditRunRequests: unknown[];
  readonly findingReviewRequests: {
    readonly findingId: string;
    readonly body: unknown;
  }[];
  readonly recheckRequests: {
    readonly actionId: string;
    readonly body: unknown;
  }[];
  readonly artifactStatusPatches: unknown[];
  readonly internalLinkMapReads: string[];
  readonly geoCitationReads: string[];
  readonly completeUrlPageReads: (string | null)[];
  readonly completeOpportunityPageReads: (string | null)[];
  readonly confirmedFindingIds: Set<string>;
  /**
   * First-diagnosis seam (R1): while false, the audit projection answers with
   * the server's real-shape 404 NOT_FOUND problem ("no completed audit").
   * Defaults to true, so existing specs keep their behavior; a spec flips it
   * to model the portfolio becoming readable after a diagnostic run.
   */
  auditProjectionAvailable: boolean;
  topicModelReadsFail: boolean;
}

/**
 * Install the full Slice 1 growth-audit vertical over the critical-flow API.
 * Registered after installCriticalFlowApi so the specific audit/opportunity/
 * results routes take precedence over the broad critical-flow handler.
 */
export async function installGrowthVerticalApi(
  page: Page,
  options: { readonly auditProjectionAvailable?: boolean } = {},
): Promise<GrowthVerticalApiState> {
  const critical = await installCriticalFlowApi(page);
  const confirmedProfile = confirmedProfileFixture();
  const state: GrowthVerticalApiState = {
    critical,
    auditRunRequests: [],
    findingReviewRequests: [],
    recheckRequests: [],
    artifactStatusPatches: [],
    internalLinkMapReads: [],
    geoCitationReads: [],
    completeUrlPageReads: [],
    completeOpportunityPageReads: [],
    confirmedFindingIds: new Set<string>(),
    auditProjectionAvailable: options.auditProjectionAvailable ?? true,
    topicModelReadsFail: false,
  };

  // Growth Audit projection: URL portfolio (list) and selected URL detail.
  await page.route(`**${BASE}/audit/urls**`, async (route) => {
    const url = new URL(route.request().url());
    if (!state.auditProjectionAvailable) {
      // The exact shape `getGrowthMapUrlPortfolio` answers before any readable
      // run exists (`lib/services/growth-map.ts` loadReadContext).
      await json(
        route,
        {
          type: "about:blank",
          title: "Not found",
          status: 404,
          code: "NOT_FOUND",
          detail:
            "No completed Growth Map audit is available for this project.",
          requestId: "e2e-request",
        },
        404,
      );
      return;
    }
    if (route.request().method() !== "GET") {
      await json(route, growthAuditPortfolioFixture(state.confirmedFindingIds));
      return;
    }
    if (url.pathname === `${BASE}/audit/urls`) {
      const response = growthAuditPortfolioFixture(state.confirmedFindingIds);
      if (url.searchParams.get("limit") === "100") {
        const cursor = url.searchParams.get("cursor");
        state.completeUrlPageReads.push(cursor);
        const pageIndex = cursor === null ? 0 : cursor === "urls-opaque-page-2" ? 1 : -1;
        if (pageIndex === -1) {
          await json(
            route,
            problem("VALIDATION_ERROR", "Unknown URL cursor.", 400),
            400,
          );
          return;
        }
        await json(route, {
          data: {
            ...response,
            data: response.data.slice(pageIndex, pageIndex + 1),
            meta: {
              ...response.meta,
              limit: 100,
              nextCursor: pageIndex === 0 ? "urls-opaque-page-2" : null,
              hasNext: pageIndex === 0,
              summary: {
                ...response.meta.summary,
                precedingUrlCount: pageIndex,
              },
            },
          },
        });
        return;
      }
      await json(route, {
        data: response,
      });
      return;
    }
    const sitePageId = decodeURIComponent(
      url.pathname.slice(`${BASE}/audit/urls/`.length),
    );
    if (
      sitePageId !== E2E_ONBOARDING_SITE_PAGE_ID &&
      sitePageId !== E2E_SECOND_SITE_PAGE_ID
    ) {
      await json(
        route,
        problem("NOT_FOUND", "SitePage is not in the frozen audit.", 404),
        404,
      );
      return;
    }
    await json(route, {
      data: growthAuditDetailFixture(
        state.confirmedFindingIds,
        sitePageId,
      ),
    });
  });

  await page.route(`**${BASE}/opportunities**`, async (route) => {
    if (route.request().method() !== "GET") {
      await json(
        route,
        problem("E2E_ROUTE_MISSING", "Opportunities are GET only", 501),
        501,
      );
      return;
    }
    const url = new URL(route.request().url());
    const listPath = `${BASE}/opportunities`;
    const response = growthOpportunitiesFixture(state.confirmedFindingIds);
    if (url.pathname === listPath) {
      if (url.searchParams.get("limit") === "100") {
        const cursor = url.searchParams.get("cursor");
        state.completeOpportunityPageReads.push(cursor);
        const pageIndex =
          cursor === null ? 0 : cursor === "opportunities-opaque-page-2" ? 1 : -1;
        if (pageIndex === -1) {
          await json(
            route,
            problem("VALIDATION_ERROR", "Unknown Opportunity cursor.", 400),
            400,
          );
          return;
        }
        const pageData =
          pageIndex === 0 ? response.data.slice(0, 2) : response.data.slice(2);
        await json(route, {
          data: {
            ...response,
            data: pageData,
            meta: {
              ...response.meta,
              nextCursor:
                pageIndex === 0 ? "opportunities-opaque-page-2" : null,
              hasNext: pageIndex === 0,
            },
          },
        });
        return;
      }
      await json(route, { data: response });
      return;
    }
    const opportunityId = decodeURIComponent(
      url.pathname.slice(`${listPath}/`.length),
    );
    const opportunity = response.data.find(
      (item) =>
        item.readiness !== "candidate" &&
        item.primaryFindingId === opportunityId,
    );
    if (opportunity === undefined) {
      await json(
        route,
        problem("NOT_FOUND", "Opportunity is not in the frozen audit.", 404),
        404,
      );
      return;
    }
    await json(route, {
      data: {
        projectId: response.projectId,
        siteId: response.siteId,
        diagnosticRunId: response.diagnosticRunId,
        data: opportunity,
      },
    });
  });

  await page.route(
    `**${BASE}/audit/topic-model/insights`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      if (state.topicModelReadsFail) {
        await json(
          route,
          problem(
            "DEPENDENCY_UNAVAILABLE",
            "Confirmed Topic insights are temporarily unavailable.",
            503,
          ),
          503,
        );
        return;
      }
      await json(route, { data: growthMapTopicInsightsFixture() });
    },
  );

  await page.route(`**${BASE}/audit/topic-model`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    if (state.topicModelReadsFail) {
      await json(
        route,
        problem(
          "DEPENDENCY_UNAVAILABLE",
          "Confirmed Topic workspace is temporarily unavailable.",
          503,
        ),
        503,
      );
      return;
    }
    await json(route, { data: growthMapTopicWorkspaceFixture() });
  });

  await page.route(`**${BASE}/audit/internal-link-map**`, async (route) => {
    if (route.request().method() !== "GET") {
      await json(
        route,
        problem("E2E_ROUTE_MISSING", "Internal Link Map is GET only", 501),
        501,
      );
      return;
    }
    const url = new URL(route.request().url());
    const sitePageId = url.searchParams.get("sitePageId");
    if (
      sitePageId !== E2E_ONBOARDING_SITE_PAGE_ID &&
      sitePageId !== E2E_SECOND_SITE_PAGE_ID
    ) {
      await json(
        route,
        problem("NOT_FOUND", "Selected SitePage is not in the map.", 404),
        404,
      );
      return;
    }
    state.internalLinkMapReads.push(sitePageId);
    await json(route, {
      data: growthInternalLinkMapFixture(sitePageId),
    });
  });

  // Product Profile read model with a confirmed ICP (enables Run Audit).
  await page.route(`**${BASE}/product-profile`, async (route) => {
    if (route.request().method() !== "GET") {
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          currentProfile: confirmedProfile,
          confirmedProfile,
          activeSynthesisRun: null,
          activeCrawlRun: null,
        },
      });
      return;
    }
    await json(route, {
      data: {
        projectId: E2E_PROJECT_ID,
        currentProfile: confirmedProfile,
        confirmedProfile,
        activeSynthesisRun: null,
        activeCrawlRun: null,
      },
    });
  });

  // createGrowthAuditRun — 202 accepted, records the request body.
  await page.route(`**${BASE}/audit-runs`, async (route) => {
    if (route.request().method() !== "POST") {
      await json(
        route,
        problem("E2E_ROUTE_MISSING", "audit-runs is POST only", 501),
        501,
      );
      return;
    }
    state.auditRunRequests.push(route.request().postDataJSON());
    const run = asyncRun("growth-audit-run", "diagnostic", "queued");
    await json(
      route,
      {
        data: {
          run,
          statusUrl: `${BASE}/runs/${run.id}`,
          resourceRef: { type: "audit_run", id: E2E_RECHECK_AUDIT_RUN_ID },
        },
      },
      202,
    );
  });

  // Confirm one canonical Finding (Opportunity Review). Records the review and
  // marks the Finding confirmed so the refetched detail drops it from review.
  for (const findingId of ALL_FINDING_IDS) {
    await page.route(`**${BASE}/findings/${findingId}`, async (route) => {
      if (route.request().method() !== "PATCH") {
        await json(
          route,
          problem("E2E_ROUTE_MISSING", "finding review is PATCH only", 501),
          501,
        );
        return;
      }
      state.findingReviewRequests.push({
        findingId,
        body: route.request().postDataJSON(),
      });
      state.confirmedFindingIds.add(findingId);
      await json(route, {
        data: {
          finding: finding("confirmed"),
          action: { ...action, findingId },
        },
      });
    });
  }

  // Artifact status transitions ("mark work done" → ready). Overrides the
  // critical-flow 409 so the existing Action lifecycle can complete.
  await page.route(`**${BASE}/artifacts/${artifact.id}`, async (route) => {
    if (route.request().method() !== "PATCH") {
      await json(route, listEnvelope([artifact]));
      return;
    }
    const body = route.request().postDataJSON();
    state.artifactStatusPatches.push(body);
    const nextStatus =
      body && typeof body === "object" && "status" in body
        ? (body as { status: string }).status
        : artifact.status;
    await json(route, {
      data: {
        ...artifact,
        status: nextStatus,
        current: { ...artifact.current, note: null },
      },
    });
  });

  // createActionRecheck — 202 with a brand-new run id that preserves the prior.
  await page.route(
    `**${BASE}/actions/${E2E_CANONICAL_ACTION_ID}/recheck`,
    async (route) => {
      if (route.request().method() !== "POST") {
        await json(
          route,
          problem("E2E_ROUTE_MISSING", "recheck is POST only", 501),
          501,
        );
        return;
      }
      state.recheckRequests.push({
        actionId: E2E_CANONICAL_ACTION_ID,
        body: route.request().postDataJSON(),
      });
      const run = asyncRun("recheck-run", "diagnostic", "queued");
      await json(
        route,
        {
          data: {
            run: { ...run, id: E2E_RECHECK_RUN_ID },
            statusUrl: `${BASE}/runs/${E2E_RECHECK_RUN_ID}`,
            resourceRef: { type: "audit_run", id: E2E_RECHECK_AUDIT_RUN_ID },
          },
        },
        202,
      );
    },
  );

  // Results comparison read model.
  await page.route(`**${BASE}/results`, async (route) => {
    await json(route, { data: recheckResultsFixture() });
  });

  // Project-level immutable before/after windows across multiple URLs.
  await page.route(`**${BASE}/measurement-windows/recent**`, async (route) => {
    await json(route, { data: recentMeasurementWindowsFixture() });
  });

  await page.route(
    `**${BASE}/measurement-windows/*/keyword-ranks`,
    async (route) => {
      const segments = new URL(route.request().url()).pathname.split("/");
      const measurementWindowId = segments.at(-2) ?? "";
      await json(route, {
        data: measurementTargetKeywordRanksFixture(
          measurementWindowId,
        ),
      });
    },
  );

  await page.route(
    `**${BASE}/measurement-windows/*/geo-citations`,
    async (route) => {
      const segments = new URL(route.request().url()).pathname.split("/");
      const measurementWindowId = segments.at(-2) ?? "";
      state.geoCitationReads.push(measurementWindowId);
      await json(route, {
        data: measurementGeoCitationsFixture(
          measurementWindowId,
        ),
      });
    },
  );

  return state;
}

/* ------------------------------------------------------------------ *
 * R2 Action override mock (Execution rail dialog). Blueprint D7: the  *
 * action store is MUTABLE - a successful PATCH applies the change and *
 * advances the revision, and every later GET /actions observes it, so *
 * specs assert UI state and the next request's baseRevision instead   *
 * of only counting requests. The stale-409 toggle bumps the action    *
 * (status -> blocked, revision + 1) BEFORE refusing, modelling a      *
 * concurrent operator; the illegal-409 toggle refuses with the        *
 * revision unmoved, modelling the transition-guard branch that shares *
 * VERSION_CONFLICT on the server (actions-service.ts).                *
 * ------------------------------------------------------------------ */

export type MockOverrideAction = typeof action;

export function overrideActionFixture(
  n: number,
  overrides: Partial<MockOverrideAction> = {},
): MockOverrideAction {
  return {
    ...action,
    id: `00000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`,
    title: `Override action ${n}`,
    ...overrides,
  };
}

export function overrideArtifactFixture(n: number, actionId: string) {
  return {
    ...artifact,
    id: `00000000-0000-4000-8000-0000000008${String(n).padStart(2, "0")}`,
    actionId,
    current: {
      ...artifact.current,
      id: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`,
    },
  };
}

export interface ActionOverrideApiState {
  readonly critical: CriticalFlowApiState;
  readonly actionPatchRequests: {
    readonly actionId: string;
    readonly body: unknown;
  }[];
  /** Mutable current truth behind GET /actions and PATCH /actions/{id}. */
  readonly currentActions: MockOverrideAction[];
  conflictMode: "none" | "stale" | "illegal";
  /**
   * While true, every first-page GET /actions read 500s. Persistent rather
   * than one-shot: the app's QueryClient retries a failed query once, so a
   * single injected failure would be absorbed by the retry.
   */
  failActionsGet: boolean;
  /** While true, every cursor-bearing GET /actions read 500s. */
  failActionsPage: boolean;
  /**
   * Every GET /actions list read in arrival order, by cursor. Specs assert
   * the exact cursor sequence (each page fetched exactly once) rather than a
   * bare request count, which would accept a pathological refetch loop.
   */
  readonly actionGetRequests: { readonly cursor: string | null }[];
  /**
   * While true, PATCH /actions/{id} records the request and then parks until
   * released, modelling an in-flight request the UI must not offer to
   * "discard" its way out of. Flip back to false and call every parked
   * release to let the held responses complete.
   */
  holdPatch: boolean;
  readonly heldPatchReleases: (() => void)[];
}

export async function installActionOverrideApi(
  page: Page,
  options: {
    readonly actions: readonly MockOverrideAction[];
    readonly artifacts?: readonly ReturnType<typeof overrideArtifactFixture>[];
    /** Split GET /actions into cursor pages of this size (default: one page). */
    readonly actionsPageSize?: number;
  },
): Promise<ActionOverrideApiState> {
  const critical = await installCriticalFlowApi(page);
  const state: ActionOverrideApiState = {
    critical,
    actionPatchRequests: [],
    currentActions: options.actions.map((item) => ({ ...item })),
    conflictMode: "none",
    failActionsGet: false,
    failActionsPage: false,
    actionGetRequests: [],
    holdPatch: false,
    heldPatchReleases: [],
  };
  const artifacts = options.artifacts ?? [];
  const pageSize = options.actionsPageSize ?? Number.MAX_SAFE_INTEGER;

  // Trailing ** so the limit/cursor query still matches; anything that is not
  // the artifact list read (e.g. PATCH /artifacts/{id}) falls through to the
  // broad critical-flow handler.
  await page.route(`**${BASE}/artifacts**`, async (route) => {
    const listUrl = new URL(route.request().url());
    if (
      route.request().method() !== "GET" ||
      listUrl.pathname !== `${BASE}/artifacts`
    ) {
      await route.fallback();
      return;
    }
    await json(route, listEnvelope(artifacts));
  });

  // The Execution workspace also reads Content Shadow runs; keep the surface
  // clean (no injected 501 alert) with an honest empty list.
  await page.route(`**${BASE}/content-shadow-runs**`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await json(route, listEnvelope([]));
  });

  await page.route(`**${BASE}/actions**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;

    if (method === "GET" && path === `${BASE}/actions`) {
      const cursor = url.searchParams.get("cursor");
      state.actionGetRequests.push({ cursor });
      if (cursor === null && state.failActionsGet) {
        await json(
          route,
          problem("INTERNAL", "Injected actions read failure.", 500),
          500,
        );
        return;
      }
      if (cursor !== null && state.failActionsPage) {
        await json(
          route,
          problem("INTERNAL", "Injected actions page failure.", 500),
          500,
        );
        return;
      }
      const pageIndex =
        cursor === null
          ? 0
          : Number.parseInt(cursor.replace("actions-page-", ""), 10);
      const start = pageIndex * pageSize;
      const slice = state.currentActions
        .slice(start, start + pageSize)
        .map((item) => ({ ...item }));
      const hasNext = start + pageSize < state.currentActions.length;
      await json(route, {
        data: slice,
        meta: {
          nextCursor: hasNext ? `actions-page-${pageIndex + 1}` : null,
          hasNext,
          limit: 100,
        },
      });
      return;
    }

    const patchPrefix = `${BASE}/actions/`;
    if (method === "PATCH" && path.startsWith(patchPrefix)) {
      const actionId = path.slice(patchPrefix.length);
      if (!actionId.includes("/")) {
        const body = request.postDataJSON() as {
          readonly baseRevision?: number;
          readonly status?: string;
          readonly priorityBand?: string;
          readonly roadmapLane?: string;
        };
        state.actionPatchRequests.push({ actionId, body });
        if (state.holdPatch) {
          // Park the response until the spec releases it; the request itself
          // was already recorded above, so the spec can see it in flight.
          await new Promise<void>((resolve) => {
            state.heldPatchReleases.push(resolve);
          });
        }
        const current = state.currentActions.find(
          (item) => item.id === actionId,
        );
        if (current === undefined) {
          await json(
            route,
            problem("NOT_FOUND", "Action not found.", 404),
            404,
          );
          return;
        }
        if (state.conflictMode === "stale") {
          current.status = "blocked";
          current.revision += 1;
          await json(
            route,
            problem(
              "VERSION_CONFLICT",
              "Action was modified; refetch and retry.",
              409,
            ),
            409,
          );
          return;
        }
        if (state.conflictMode === "illegal") {
          await json(
            route,
            problem(
              "VERSION_CONFLICT",
              "Requested action status transition is not allowed.",
              409,
            ),
            409,
          );
          return;
        }
        if (body.baseRevision !== current.revision) {
          await json(
            route,
            problem(
              "VERSION_CONFLICT",
              "Action was modified; refetch and retry.",
              409,
            ),
            409,
          );
          return;
        }
        if (typeof body.status === "string") current.status = body.status;
        if (typeof body.priorityBand === "string") {
          current.priorityBand = body.priorityBand;
        }
        if (typeof body.roadmapLane === "string") {
          current.roadmapLane = body.roadmapLane;
        }
        current.revision += 1;
        await json(route, { data: { ...current } });
        return;
      }
    }

    await route.fallback();
  });

  return state;
}
