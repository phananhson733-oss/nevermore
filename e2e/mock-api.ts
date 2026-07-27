import type { Page, Route } from "@playwright/test";
import type { components } from "../packages/contracts/src/generated/openapi.ts";
import {
  ActionRecheckResultsResponse as ActionRecheckResultsResponseSchema,
  ConfirmedProductProfileRowDto as ConfirmedProductProfileRowSchema,
  GrowthMapUrlDetailResponse as GrowthMapUrlDetailResponseSchema,
  GrowthMapUrlPortfolioResponse as GrowthMapUrlPortfolioResponseSchema,
  ProductProfileDraft as ProductProfileDraftSchema,
  type ActionRecheckResultsResponse,
  type ConfirmedProductProfileRowDto,
  type GrowthMapUrlDetailResponse,
  type GrowthMapUrlFinding,
  type GrowthMapUrlPortfolioItem,
  type GrowthMapUrlPortfolioResponse,
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
      await json(route, listEnvelope([crawlSnapshot]));
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
    pageType: "guide",
    templateKey: "guide-detail",
    clusterKey: null,
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
            derivationVersion: "max_finding_severity.v1",
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
  });
  const secondary = onboardingPortfolioItem({
    sitePageId: E2E_SECOND_SITE_PAGE_ID,
    pageSnapshotId: E2E_SECOND_PAGE_SNAPSHOT_ID,
    normalizedUrl: "https://example.test/pricing",
    title: "Pricing overview",
    findingIds: [],
    reviewableFindingIds: [],
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
): GrowthMapUrlDetailResponse {
  const item = onboardingPortfolioItem({
    sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
    pageSnapshotId: E2E_ONBOARDING_PAGE_SNAPSHOT_ID,
    normalizedUrl: E2E_ONBOARDING_URL,
    title: "Customer onboarding guide",
    findingIds: ALL_FINDING_IDS,
    reviewableFindingIds: onboardingReviewableIds(confirmedFindingIds),
    priority: "high",
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
  readonly confirmedFindingIds: Set<string>;
  /**
   * First-diagnosis seam (R1): while false, the audit projection answers with
   * the server's real-shape 404 NOT_FOUND problem ("no completed audit").
   * Defaults to true, so existing specs keep their behavior; a spec flips it
   * to model the portfolio becoming readable after a diagnostic run.
   */
  auditProjectionAvailable: boolean;
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
    confirmedFindingIds: new Set<string>(),
    auditProjectionAvailable: options.auditProjectionAvailable ?? true,
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
      await json(route, {
        data: growthAuditPortfolioFixture(state.confirmedFindingIds),
      });
      return;
    }
    // `/audit/urls/{sitePageId}` — always serve the onboarding detail.
    await json(route, {
      data: growthAuditDetailFixture(state.confirmedFindingIds),
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
