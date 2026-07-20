import type { Page, Route } from "@playwright/test";

export const E2E_PROJECT_ID = "00000000-0000-4000-8000-000000000042";

export interface CriticalFlowApiState {
  readonly collectionRequests: unknown[];
  readonly diagnosticRequests: unknown[];
  readonly findingReviewRequests: unknown[];
  readonly artifactCreateRequests: unknown[];
  readonly artifactPatchRequests: unknown[];
  readonly exportRequests: unknown[];
  sourceReads: number;
  collectionRunPolls: number;
  diagnosticRunPolls: number;
}

const NOW = "2026-07-18T12:00:00.000Z";
const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;

const project = {
  id: E2E_PROJECT_ID,
  clientName: "E2E Client",
  projectName: "E2E Critical Flow",
  stage: "planning",
  site: {
    id: "00000000-0000-4000-8000-000000000043",
    origin: "https://example.test",
    host: "example.test",
    marketCodes: ["US"],
    languageCodes: ["en", "zh-CN"],
  },
  contextStatus: "complete",
  currentIcpProfileVersion: 1,
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
  provider: "crawl",
  datasetKey: "crawl_pages",
  schemaVersion: "1.0.0",
  methodVersion: "crawl-v1",
  capturedAt: NOW,
  sourceWindow: { start: null, end: null },
  availability: "available",
  limitation: "Static HTML only; JavaScript-rendered content may be absent.",
  rowCount: 12,
  checksum: "sha256:e2e-crawl",
};

function asyncRun(
  id: string,
  kind: "collection" | "diagnostic" | "artifact_generation" | "export",
  status: "queued" | "running" | "completed",
  progress = { phase: status, current: status === "completed" ? 2 : 1, total: 2 },
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

const evidence = {
  id: "00000000-0000-4000-8000-000000000201",
  sourceProvider: "crawl",
  origin: "direct_public",
  method: "observed",
  grade: "A",
  availability: "available",
  support: "supports",
  claim: "The URL returned HTTP 500.",
  subjectRefs: [{ type: "url", value: "https://example.test/product" }],
  observedAt: NOW,
  limitation: "One captured response.",
  snapshotId: crawlSnapshot.id,
  analysisInvocationId: null,
};

function finding(reviewState: "unreviewed" | "confirmed") {
  return {
    id: "00000000-0000-4000-8000-000000000202",
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
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
          ruleVersion: 1,
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
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
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
): Promise<CriticalFlowApiState> {
  const state: CriticalFlowApiState = {
    collectionRequests: [],
    diagnosticRequests: [],
    findingReviewRequests: [],
    artifactCreateRequests: [],
    artifactPatchRequests: [],
    exportRequests: [],
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
        "Content-Disposition":
          'attachment; filename="signalframe-client.zip"',
      },
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
      await json(route, {
        data: {
          run,
          statusUrl: `${BASE}/runs/${run.id}`,
          resourceRef: { type: "collection_run", id: run.id },
        },
      }, 202);
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
      const run = asyncRun("export-run", "export", "queued");
      await json(route, {
        data: {
          run,
          statusUrl: `${BASE}/runs/${run.id}`,
          resourceRef: { type: "export", id: "export-bundle" },
        },
      }, 202);
      return;
    }

    if (method === "GET" && path === `${BASE}/exports/export-bundle`) {
      const latestExportRequest = state.exportRequests.at(-1) as
        | { readonly outputLocale?: string }
        | undefined;
      await json(route, {
        data: {
          id: "export-bundle",
          kind: "client_bundle",
          schemaVersion: "1.0.0",
          outputLocale: latestExportRequest?.outputLocale ?? "en",
          run: asyncRun("export-run", "export", "completed"),
          checksum: "sha256:e2e-export",
          itemCounts: { findings: 1, actions: 1, artifacts: 1 },
          downloadUrl: "/mock-download/client.zip",
          downloadExpiresAt: "2026-07-18T12:15:00.000Z",
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
