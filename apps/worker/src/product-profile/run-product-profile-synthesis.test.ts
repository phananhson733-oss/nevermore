import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsyncRunsRepository,
  canonicalize,
  contentHash,
  DataSnapshotsRepository,
  IcpProfilesRepository,
  normalizedUrlHash,
  ObservationsRepository,
  PageSnapshotsRepository,
  ProductProfileInvocationAttemptsRepository,
  ProductProfileRunsRepository,
  ProjectsRepository,
  sha256Hex,
  toRunAttempt,
  type AsyncRunRow,
  type CanonicalValue,
  type DataSnapshotRow,
  type IcpProfileRow,
  type ObservationRow,
  type ProductProfileRunRow,
  type ProductProfileInvocationAttemptRow,
  type ProjectRow,
} from "@sf/db";
import {
  LLMError,
  MAX_PRODUCT_PROFILE_H1,
  MAX_PRODUCT_PROFILE_HEADINGS,
  MAX_PRODUCT_PROFILE_JSON_LD_TYPES,
  MAX_PRODUCT_PROFILE_PARAGRAPHS,
  PRODUCT_PROFILE_DECLARED_CONTEXT_PROMPT_SET_VERSION,
  PRODUCT_PROFILE_LEGACY_PROMPT_SET_VERSION,
  PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION,
  PRODUCT_PROFILE_PROMPT_SET_VERSION,
  prepareProductProfileSynthesis,
  type AnalysisInvocationRecord,
  type ProductProfilePageDescriptor,
  type ProductProfileSemanticCandidateEnvelope,
  type ProductProfileSynthesisInput,
  type ProductProfileSynthesisResult,
} from "@sf/artifacts";
import {
  createInitialProductProfileDraft,
  PRODUCT_PROFILE_LEGACY_SELECTION_POLICY_VERSION,
  PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_LEGACY_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_OUTPUT_LOCALE_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_VERSION,
  type ProductProfileSynthesisInputManifest,
} from "@sf/contracts";
import type { Logger } from "@sf/observability";
import {
  createDataForSeoSearchLandscapeScope,
  createDataForSeoSearchLandscapeV2Scope,
} from "@sf/sources";
import type { WorkerContext } from "../context.ts";
import {
  buildBoundedProductProfilePageDescriptor,
  buildProductProfileDeclaredContext,
  retainExactlyGroundedCompetitors,
  runProductProfileSynthesis,
} from "./run-product-profile-synthesis.ts";

const IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  site: "00000000-0000-4000-8000-000000000003",
  run: "00000000-0000-4000-8000-000000000004",
  baseProfile: "00000000-0000-4000-8000-000000000005",
  snapshot: "00000000-0000-4000-8000-000000000006",
  collectionRun: "00000000-0000-4000-8000-000000000007",
  sitePage: "00000000-0000-4000-8000-000000000008",
  pageSnapshot: "00000000-0000-4000-8000-000000000009",
  invocation: "00000000-0000-4000-8000-000000000010",
  resultProfile: "00000000-0000-4000-8000-000000000011",
  actor: "00000000-0000-4000-8000-000000000012",
  discoverySnapshot: "00000000-0000-4000-8000-000000000013",
  discoverySource: "00000000-0000-4000-8000-000000000014",
  discoveryCollectionRun: "00000000-0000-4000-8000-000000000015",
  discoveryObservation: "00000000-0000-4000-8000-000000000016",
} as const;
const capturedAt = "2026-07-22T01:00:00.000Z";
const generatedAt = "2026-07-22T02:00:00.000Z";
const sourcePageUrl = "https://example.com/product";
const scope = { workspaceId: IDS.workspace, projectId: IDS.project };

const projection = {
  fetchUrl: sourcePageUrl,
  status: 200,
  finalStatus: 200,
  redirectChain: [],
  canonicalTarget: sourcePageUrl,
  robotsIndexable: true,
  robotsDirectives: ["index", "follow"],
  title: "Acme Product",
  metaDescription: "Automate revenue work with RivalOne.example integrations.",
  h1: ["Revenue automation"],
  headings: ["Built for RevOps", "Compare RivalOne"],
  wordCount: 520,
  internalOutlinks: [],
  jsonLd: { types: ["SoftwareApplication"], errorCount: 0 },
  sitemapMember: true,
  bodyExcerpt: "Teams migrate from rivalone.example and not-rivalone.example.",
  paragraphs: ["See https://rivalone.example/pricing for the comparison."],
  responseMs: 42,
  contentType: "text/html; charset=utf-8",
} as const;
const extract = {
  schemaVersion: "crawl.page-extract.v1",
  subjectUrl: sourcePageUrl,
  depth: 0,
  projection,
} as const;
const pageContentHash = contentHash(extract);

const baseProfile = createInitialProductProfileDraft({
  sourceSiteId: IDS.site,
  sourcePageUrl,
  businessHint: "B2B workflow software",
  productName: "Customer-declared Acme",
  customerModel: "b2b",
  primaryMarket: "US",
  growthObjectives: [
    "generate_qualified_leads",
    "increase_organic_traffic",
  ],
});
const baseContentHash = contentHash({
  status: "draft",
  profile: baseProfile as unknown as CanonicalValue,
});

const manifest: ProductProfileSynthesisInputManifest = {
  schemaVersion: PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
  selectionPolicyVersion: PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
  projectId: IDS.project,
  siteId: IDS.site,
  sourcePageUrl,
  outputLocale: "zh-CN",
  competitorDiscovery: null,
  baseProfile: {
    id: IDS.baseProfile,
    version: 1,
    contentHash: baseContentHash,
    status: "draft",
  },
  crawlSnapshot: {
    id: IDS.snapshot,
    collectionRunId: IDS.collectionRun,
    sourceConnectionId: null,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "crawl.site_graph.v1",
    methodVersion: "crawl.site_graph.v2",
    capturedAt,
    checksum: "a".repeat(64),
    availability: "available",
    rowCount: 1,
    limitation: "Public HTML only.",
  },
  pages: [
    {
      pageSnapshotId: IDS.pageSnapshot,
      sitePageId: IDS.sitePage,
      dataSnapshotId: IDS.snapshot,
      normalizedUrl: sourcePageUrl,
      normalizedUrlHash: normalizedUrlHash(sourcePageUrl),
      contentHash: pageContentHash,
      capturedAt,
    },
  ],
};
const manifestHash = contentHash(manifest);

const run = {
  id: IDS.run,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  kind: "product_profile_synthesis",
  status: "running",
  active_key: `product-profile:${IDS.baseProfile}`,
  contract_version: "2026-07-21",
  request_payload: { baseVersion: 1 },
  progress: {},
  last_error_code: null,
  last_error_summary: null,
  result_type: null,
  result_id: null,
  attempt_count: 1,
  initiated_by: IDS.actor,
  queued_at: capturedAt,
  started_at: capturedAt,
  completed_at: null,
} satisfies AsyncRunRow;
const attempt = toRunAttempt(run);
const ledger = {
  id: IDS.run,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  site_id: IDS.site,
  base_icp_profile_id: IDS.baseProfile,
  base_icp_profile_version: 1,
  base_icp_profile_content_hash: baseContentHash,
  source_snapshot_id: IDS.snapshot,
  synthesis_version: PRODUCT_PROFILE_SYNTHESIS_VERSION,
  prompt_set_version: PRODUCT_PROFILE_PROMPT_SET_VERSION,
  input_manifest: manifest,
  input_hash: manifestHash,
  prompt_input_hash: null,
  result_icp_profile_id: null,
  created_at: capturedAt,
} as ProductProfileRunRow & { readonly prompt_input_hash: string | null };
const baseRow = {
  id: IDS.baseProfile,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  version: 1,
  status: "draft",
  profile: baseProfile,
  content_hash: baseContentHash,
  created_by: IDS.actor,
  created_at: capturedAt,
} satisfies IcpProfileRow;
const snapshot = {
  id: IDS.snapshot,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  site_id: IDS.site,
  collection_run_id: IDS.collectionRun,
  source_connection_id: null,
  provider: "crawl",
  dataset_key: "crawl.site_graph.v1",
  schema_version: "crawl.site_graph.v1",
  method_version: "crawl.site_graph.v2",
  captured_at: capturedAt,
  source_window: { start: null, end: capturedAt },
  availability: "available",
  limitation: "Public HTML only.",
  raw_object_key: "private/raw.json",
  row_count: 1,
  checksum: "a".repeat(64),
  summary: {},
  created_at: capturedAt,
} satisfies DataSnapshotRow;
const discoveryScope = createDataForSeoSearchLandscapeScope({
  target: "example.com",
  marketCode: "US",
  locationName: "United States",
  languageTag: "zh-CN",
  rankedKeywordsLimit: 200,
  competitorsDomainLimit: 100,
});
const discoverySnapshot = {
  id: IDS.discoverySnapshot,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  site_id: IDS.site,
  collection_run_id: IDS.discoveryCollectionRun,
  source_connection_id: IDS.discoverySource,
  provider: "dataforseo",
  dataset_key: "dataforseo.search_landscape.v1",
  schema_version: "dataforseo.search_landscape.v1",
  method_version: "dataforseo.search_landscape.v1",
  captured_at: capturedAt,
  source_window: { start: null, end: capturedAt },
  availability: "available",
  limitation: "Bounded US/zh search landscape.",
  raw_object_key: "private/dataforseo.json",
  row_count: 1,
  checksum: "d".repeat(64),
  summary: { collectionScope: discoveryScope },
  created_at: capturedAt,
} satisfies DataSnapshotRow;
const discoveryObservation = {
  id: IDS.discoveryObservation,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  snapshot_id: IDS.discoverySnapshot,
  site_page_id: null,
  provider: "dataforseo",
  metric_key: "dataforseo.competitor_domain.v1",
  subject_type: "site",
  subject_ref: "rival.example",
  observed_at: capturedAt,
  availability: "available",
  value_numeric: null,
  value_text: null,
  value_json: {
    targetDomain: "example.com",
    competitorDomain: "rival.example",
    intersections: 12,
    averagePosition: 4.5,
    summedPosition: 54,
    organicEstimatedTrafficVolume: 850,
    marketCode: "US",
    languageCode: "zh",
  },
  unit: null,
  origin: "vendor_observation",
  method: "observed",
  grade: "B",
  support: "supports",
  limitation: discoverySnapshot.limitation,
} satisfies ObservationRow;
const fallbackDiscoveryScope = createDataForSeoSearchLandscapeV2Scope({
  target: "example.com",
  marketCode: "US",
  locationName: "United States",
  languageTag: "zh-CN",
  rankedKeywordsLimit: 200,
  competitorsDomainLimit: 100,
  serpCompetitorsLimit: 100,
  seeds: [
    {
      keyword: "revenue automation software",
      sourceKind: "product_profile",
      sourceRef: `icp_profile:${IDS.baseProfile}#/productName`,
    },
  ],
});
const fallbackDiscoverySnapshot = {
  ...discoverySnapshot,
  dataset_key: "dataforseo.search_landscape.v2",
  schema_version: "dataforseo.search_landscape.v2",
  method_version: "dataforseo.search_landscape.v2",
  limitation: "Bounded US/zh search landscape with paid SERP fallback.",
  summary: { collectionScope: fallbackDiscoveryScope },
} satisfies DataSnapshotRow;
const fallbackDiscoveryObservation = {
  ...discoveryObservation,
  metric_key: "dataforseo.serp_competitor.v1",
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
    seedCount: 1,
    marketCode: "US",
    languageCode: "zh",
  },
  limitation: fallbackDiscoverySnapshot.limitation,
} satisfies ObservationRow;
const pageRow = {
  page_snapshot_id: IDS.pageSnapshot,
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  site_page_id: IDS.sitePage,
  data_snapshot_id: IDS.snapshot,
  content_hash: pageContentHash,
  canonical_extract: canonicalize(extract),
  extract,
  captured_at: capturedAt,
  created_at: capturedAt,
  normalized_url: sourcePageUrl,
  normalized_url_hash: normalizedUrlHash(sourcePageUrl),
  site_id: IDS.site,
};
const project = {
  id: IDS.project,
  workspace_id: IDS.workspace,
  client_name: "Acme",
  project_name: "Acme Growth",
  stage: "setup",
  default_delivery_locale: "zh-CN",
  current_icp_profile_id: IDS.baseProfile,
  confirmed_icp_profile_id: null,
  archived_at: null,
  created_by: IDS.actor,
  created_at: capturedAt,
  updated_at: capturedAt,
} satisfies ProjectRow;

const unknownScalar = {
  value: null,
  confidence: "unknown",
  sourcePageKeys: [],
  usesBusinessHint: false,
} satisfies ProductProfileSemanticCandidateEnvelope["productName"];
function candidate(
  competitorCandidates: ProductProfileSemanticCandidateEnvelope["competitorCandidates"] = [],
): ProductProfileSemanticCandidateEnvelope {
  return {
    productName: unknownScalar,
    oneLiner: unknownScalar,
    category: unknownScalar,
    productType: unknownScalar,
    valueProposition: unknownScalar,
    businessModels: [],
    coreFeatures: [],
    targetMarkets: [],
    targetAudiences: [],
    competitorCandidates,
    conflicts: [],
    unknownPaths: [
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
    ],
  };
}

const invocation = {
  task: "product_profile_synthesis" as const,
  provider: "openai",
  model: "gpt-test",
  promptSetVersion: PRODUCT_PROFILE_PROMPT_SET_VERSION,
  inputHash: prepareProductProfileSynthesis({
    sourcePageUrl,
    outputLocale: "zh-CN",
    ...(baseProfile.businessHint === null
      ? {}
      : { businessHint: baseProfile.businessHint }),
    declaredContext: {
      productName: "Customer-declared Acme",
      customerModel: "b2b",
      growthObjectives: [
        "generate_qualified_leads",
        "increase_organic_traffic",
      ],
      targetMarkets: [{ marketCode: "US", priority: "primary" }],
    },
    pages: [buildBoundedProductProfilePageDescriptor(manifest.pages[0]!, extract)],
  }).inputHash,
  outputHash: sha256Hex(JSON.stringify(candidate())),
  status: "succeeded",
  inputTokens: 100,
  outputTokens: 80,
  costUsd: null,
  latencyMs: 50,
  errorCode: null,
} satisfies AnalysisInvocationRecord;

const reservation = {
  id: "00000000-0000-4000-8000-000000000014",
  workspace_id: IDS.workspace,
  project_id: IDS.project,
  product_profile_run_id: IDS.run,
  ordinal: 1,
  async_attempt_count: attempt.attemptCount,
  provider: invocation.provider,
  model: invocation.model,
  prompt_set_version: invocation.promptSetVersion,
  input_hash: invocation.inputHash,
  planned_analysis_invocation_id: IDS.invocation,
  status: "reserved",
  analysis_invocation_id: null,
  terminal_error_code: null,
  reserved_at: generatedAt,
  provider_returned_at: null,
  finalized_at: null,
} satisfies ProductProfileInvocationAttemptRow;

const finalizedReservation = {
  ...reservation,
  status: "succeeded",
  analysis_invocation_id: IDS.invocation,
  provider_returned_at: generatedAt,
  finalized_at: generatedAt,
} satisfies ProductProfileInvocationAttemptRow;

const logger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const transaction = vi.fn(
  async (callback: (tx: object) => Promise<unknown>) => callback({}),
);
const ctx = {
  db: { transaction },
  boss: {},
  blobStore: {},
  credentialKey: Buffer.alloc(32),
  appOrigin: "https://app.example",
  googleOAuth: { clientId: "google-id", clientSecret: "google-secret" },
  openai: { apiKey: "openai-key", model: "gpt-test" },
  findingSummariesEnabled: true,
  logger,
} as unknown as WorkerContext;

const synthesizeProductProfile = vi.fn(
  async (
    _input: ProductProfileSynthesisInput,
  ): Promise<ProductProfileSynthesisResult> => ({
    candidate: candidate(),
    pageKeyMap: [{ pageKey: "page-1", inputIndex: 0 }],
    droppedCompetitorCount: 0,
    invocation,
  }),
);

beforeEach(() => {
  vi.restoreAllMocks();
  transaction.mockClear();
  synthesizeProductProfile.mockReset().mockResolvedValue({
    candidate: candidate(),
    pageKeyMap: [{ pageKey: "page-1", inputIndex: 0 }],
    droppedCompetitorCount: 0,
    invocation,
  });
  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();

  vi.spyOn(AsyncRunsRepository.prototype, "claim").mockResolvedValue(run);
  vi.spyOn(AsyncRunsRepository.prototype, "lockAttemptForUpdate").mockResolvedValue(run);
  vi.spyOn(AsyncRunsRepository.prototype, "resetToQueued").mockResolvedValue(true);
  vi.spyOn(AsyncRunsRepository.prototype, "setTerminal").mockResolvedValue(true);
  vi.spyOn(ProductProfileRunsRepository.prototype, "findById").mockResolvedValue(ledger);
  vi.spyOn(ProductProfileRunsRepository.prototype, "setResult").mockResolvedValue(true);
  vi.spyOn(IcpProfilesRepository.prototype, "findById").mockResolvedValue(baseRow);
  vi.spyOn(IcpProfilesRepository.prototype, "findByContentHash").mockResolvedValue(null);
  vi.spyOn(IcpProfilesRepository.prototype, "maxVersion").mockResolvedValue(1);
  vi.spyOn(IcpProfilesRepository.prototype, "insertVersion").mockImplementation(async (values) => ({
    id: IDS.resultProfile,
    workspace_id: values.workspaceId,
    project_id: values.projectId,
    version: values.version,
    status: values.status,
    profile: values.profile,
    content_hash: values.contentHash,
    created_by: values.createdBy,
    created_at: generatedAt,
  }));
  vi.spyOn(DataSnapshotsRepository.prototype, "findById").mockResolvedValue(snapshot);
  vi.spyOn(PageSnapshotsRepository.prototype, "findByIdsWithSitePageIdentity").mockResolvedValue([pageRow]);
  vi.spyOn(
    ProductProfileInvocationAttemptsRepository.prototype,
    "reserve",
  ).mockResolvedValue({ kind: "reserved", reservation });
  vi.spyOn(
    ProductProfileInvocationAttemptsRepository.prototype,
    "finalizeWithInvocation",
  ).mockResolvedValue({
    kind: "finalized",
    reservation: finalizedReservation,
    invocationId: IDS.invocation,
  });
  vi.spyOn(
    ProductProfileInvocationAttemptsRepository.prototype,
    "markOutcomeUnknown",
  ).mockImplementation(async (_attempt, _reservationId, errorCode) => ({
    kind: "marked",
    reservation: {
      ...reservation,
      status: "outcome_unknown",
      terminal_error_code: errorCode,
      provider_returned_at: generatedAt,
      finalized_at: generatedAt,
    },
  }));
  vi.spyOn(ProjectsRepository.prototype, "findByIdForUpdate").mockResolvedValue(project);
  vi.spyOn(ProjectsRepository.prototype, "setCurrentIcpProfile").mockResolvedValue(true);
});

describe("retainExactlyGroundedCompetitors", () => {
  const descriptor: ProductProfilePageDescriptor = {
    pageSnapshotId: IDS.pageSnapshot,
    sitePageId: IDS.sitePage,
    snapshotId: IDS.snapshot,
    contentHash: pageContentHash,
    subjectUrl: sourcePageUrl,
    fetchUrl: sourcePageUrl,
    title: projection.title,
    metaDescription: projection.metaDescription,
    h1: projection.h1,
    headings: projection.headings,
    bodyExcerpt: projection.bodyExcerpt,
    paragraphs: projection.paragraphs,
    jsonLdTypes: projection.jsonLd.types,
    canonicalTarget: projection.canonicalTarget,
    contentType: projection.contentType,
  };
  const competitor = (domain: string, sourcePageKeys = ["page-1"]) => ({
    name: "Rival One",
    domain,
    relationship: "direct" as const,
    analysisScope: ["product_capability" as const],
    similarity: null,
    reason: "Mentioned in a migration comparison.",
    confidence: "medium" as const,
    sourcePageKeys,
    usesBusinessHint: false,
  });

  it("retains only an exact domain found in a page the candidate cited", () => {
    const result = retainExactlyGroundedCompetitors(
      candidate([
        competitor("rivalone.example"),
        competitor("one.example"),
        competitor("uncited.example", ["page-2"]),
      ]),
      [descriptor],
      [{ pageKey: "page-1", inputIndex: 0 }],
    );
    expect(result.competitorCandidates.map((item) => item.domain)).toEqual([
      "rivalone.example",
    ]);
  });

  it("does not accept hostname substrings with unsafe boundaries", () => {
    const hostile = {
      ...descriptor,
      metaDescription: "not-rivalone.example and rivalone.example.attacker",
      bodyExcerpt: null,
      paragraphs: [],
    };
    expect(
      retainExactlyGroundedCompetitors(
        candidate([competitor("rivalone.example")]),
        [hostile],
        [{ pageKey: "page-1", inputIndex: 0 }],
      ).competitorCandidates,
    ).toEqual([]);
  });

  it("never retains the submitted product host as its own competitor", () => {
    expect(
      retainExactlyGroundedCompetitors(
        candidate([competitor("example.com")]),
        [descriptor],
        [{ pageKey: "page-1", inputIndex: 0 }],
      ).competitorCandidates,
    ).toEqual([]);
  });
});

describe("buildBoundedProductProfilePageDescriptor", () => {
  it("projects only bounded semantic fields from a strict crawl extract", () => {
    const descriptor = buildBoundedProductProfilePageDescriptor(
      manifest.pages[0]!,
      {
        ...extract,
        projection: {
          ...projection,
          h1: Array.from({ length: 20 }, (_, index) => `h1-${index}`),
          headings: Array.from(
            { length: 40 },
            (_, index) => `heading-${index}`,
          ),
          paragraphs: Array.from(
            { length: 20 },
            (_, index) => `paragraph-${index}`,
          ),
          jsonLd: {
            types: Array.from(
              { length: 20 },
              (_, index) => `Type${index}`,
            ),
            errorCount: 0,
          },
        },
      },
    );

    expect(descriptor.h1).toHaveLength(MAX_PRODUCT_PROFILE_H1);
    expect(descriptor.headings).toHaveLength(MAX_PRODUCT_PROFILE_HEADINGS);
    expect(descriptor.paragraphs).toHaveLength(MAX_PRODUCT_PROFILE_PARAGRAPHS);
    expect(descriptor.jsonLdTypes).toHaveLength(
      MAX_PRODUCT_PROFILE_JSON_LD_TYPES,
    );
    expect(descriptor).not.toHaveProperty("projection");
    expect(descriptor).not.toHaveProperty("rawProviderPayload");
  });
});

describe("buildProductProfileDeclaredContext", () => {
  it("projects only customer-authored base facts and stays absent for legacy or inferred-only profiles", () => {
    expect(buildProductProfileDeclaredContext(baseProfile)).toEqual({
      productName: "Customer-declared Acme",
      customerModel: "b2b",
      growthObjectives: [
        "generate_qualified_leads",
        "increase_organic_traffic",
      ],
      targetMarkets: [{ marketCode: "US", priority: "primary" }],
    });

    const legacy = createInitialProductProfileDraft({
      sourceSiteId: IDS.site,
      sourcePageUrl,
      businessHint: "Legacy profile with no declared planning facts",
    });
    expect(buildProductProfileDeclaredContext(legacy)).toBeUndefined();

    expect(
      buildProductProfileDeclaredContext({
        ...legacy,
        productName: "Model-inferred name",
        fieldProvenance: [
          {
            path: "/productName",
            derivation: "inferred",
            confidence: "high",
            evidenceRefs: [
              {
                evidenceRefId: IDS.invocation,
                kind: "analysisInvocation",
                analysisInvocationId: IDS.invocation,
              },
              {
                evidenceRefId: IDS.actor,
                kind: "declaredHint",
              },
            ],
            limitation: null,
            observedAt: generatedAt,
          },
        ],
        missingFields: legacy.missingFields.filter(
          (path) => path !== "/productName",
        ),
        sourceSnapshotId: IDS.snapshot,
        analysisInvocationId: IDS.invocation,
        generatedAt,
      }),
    ).toBeUndefined();
  });
});

describe("runProductProfileSynthesis", () => {
  const dependencies = {
    createClient: vi.fn(() => ({ synthesizeProductProfile })),
    now: () => new Date(generatedAt),
  };

  it("revalidates exact frozen lineage, persists the call, appends a draft and binds result before completion", async () => {
    const order: string[] = [];
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockImplementation(async () => {
      order.push("reservation");
      return { kind: "reserved", reservation };
    });
    synthesizeProductProfile.mockImplementationOnce(async () => {
      order.push("provider");
      return {
        candidate: candidate(),
        pageKeyMap: [{ pageKey: "page-1", inputIndex: 0 }],
        droppedCompetitorCount: 0,
        invocation,
      };
    });
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockImplementation(async () => {
      order.push("invocation");
      return {
        kind: "finalized",
        reservation: finalizedReservation,
        invocationId: IDS.invocation,
      };
    });
    vi.mocked(ProductProfileRunsRepository.prototype.setResult).mockImplementation(async () => {
      order.push("result");
      return true;
    });
    vi.mocked(AsyncRunsRepository.prototype.setTerminal).mockImplementation(async (_attempt, value) => {
      if (value.status === "completed") order.push("terminal");
      return true;
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(dependencies.createClient).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "openai-key",
      model: "gpt-test",
      promptSetVersion: PRODUCT_PROFILE_PROMPT_SET_VERSION,
    }));
    expect(synthesizeProductProfile).toHaveBeenCalledTimes(1);
    const modelInput = synthesizeProductProfile.mock.calls[0]![0];
    expect(modelInput).toEqual({
      sourcePageUrl,
      outputLocale: "zh-CN",
      businessHint: "B2B workflow software",
      declaredContext: {
        productName: "Customer-declared Acme",
        customerModel: "b2b",
        growthObjectives: [
          "generate_qualified_leads",
          "increase_organic_traffic",
        ],
        targetMarkets: [{ marketCode: "US", priority: "primary" }],
      },
      pages: [expect.objectContaining({
        pageSnapshotId: IDS.pageSnapshot,
        fetchUrl: sourcePageUrl,
        title: "Acme Product",
      })],
    });
    expect(modelInput.pages[0]).not.toHaveProperty("extract");
    expect(modelInput.pages[0]).not.toHaveProperty("rawProviderPayload");
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).toHaveBeenCalledWith(
      attempt,
      {
        provider: "openai",
        model: "gpt-test",
        promptSetVersion: PRODUCT_PROFILE_PROMPT_SET_VERSION,
        inputHash: invocation.inputHash,
      },
    );
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).toHaveBeenCalledWith(
      attempt,
      reservation.id,
      expect.objectContaining({
        provider: "openai",
        model: "gpt-test",
        inputHash: invocation.inputHash,
        status: "succeeded",
      }),
    );
    expect(order.indexOf("reservation")).toBeLessThan(order.indexOf("provider"));
    expect(order.indexOf("provider")).toBeLessThan(order.indexOf("invocation"));
    expect(order.indexOf("invocation")).toBeLessThan(order.indexOf("result"));
    expect(order.indexOf("result")).toBeLessThan(order.indexOf("terminal"));
    expect(ProjectsRepository.prototype.setCurrentIcpProfile).toHaveBeenCalledWith(
      { workspaceId: IDS.workspace },
      IDS.project,
      IDS.resultProfile,
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(attempt, {
      status: "completed",
      resultType: "icp_profile",
      resultId: IDS.resultProfile,
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toMatch(
      /B2B workflow|Acme Product|raw\.json|inputHash|outputHash/,
    );
  });

  it("warns with the drop count when the provider thinned the competitor pool", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockImplementation(async () => ({ kind: "reserved", reservation }));
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockImplementation(async () => ({
      kind: "finalized",
      reservation: finalizedReservation,
      invocationId: IDS.invocation,
    }));
    vi.mocked(ProductProfileRunsRepository.prototype.setResult).mockImplementation(
      async () => true,
    );
    vi.mocked(AsyncRunsRepository.prototype.setTerminal).mockImplementation(
      async () => true,
    );
    synthesizeProductProfile.mockResolvedValueOnce({
      candidate: candidate(),
      pageKeyMap: [{ pageKey: "page-1", inputIndex: 0 }],
      droppedCompetitorCount: 2,
      invocation,
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(logger.warn).toHaveBeenCalledWith(
      "product_profile_competitors_dropped",
      {
        code: "PRODUCT_PROFILE_COMPETITORS_DROPPED",
        droppedCompetitorCount: 2,
      },
    );
  });

  it("stays silent about drops on a clean response", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockImplementation(async () => ({ kind: "reserved", reservation }));
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockImplementation(async () => ({
      kind: "finalized",
      reservation: finalizedReservation,
      invocationId: IDS.invocation,
    }));
    vi.mocked(ProductProfileRunsRepository.prototype.setResult).mockImplementation(
      async () => true,
    );
    vi.mocked(AsyncRunsRepository.prototype.setTerminal).mockImplementation(
      async () => true,
    );

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(logger.warn).not.toHaveBeenCalledWith(
      "product_profile_competitors_dropped",
      expect.anything(),
    );
  });

  it("validates frozen DataForSEO observations and merges them into the Product Profile", async () => {
    const manifestWithDiscovery: ProductProfileSynthesisInputManifest = {
      ...manifest,
      competitorDiscovery: {
        snapshotId: IDS.discoverySnapshot,
        collectionRunId: IDS.discoveryCollectionRun,
        sourceConnectionId: IDS.discoverySource,
        datasetKey: "dataforseo.search_landscape.v1",
        schemaVersion: "dataforseo.search_landscape.v1",
        methodVersion: "dataforseo.search_landscape.v1",
        capturedAt,
        checksum: discoverySnapshot.checksum,
        availability: "available",
        rowCount: 1,
        limitation: discoverySnapshot.limitation,
        targetDomain: "example.com",
        marketCode: "US",
        languageCode: "zh",
        observations: [
          {
            observationId: IDS.discoveryObservation,
            domain: "rival.example",
            intersections: 12,
            organicEstimatedTrafficVolume: 850,
            observedAt: capturedAt,
          },
        ],
      },
    };
    vi.mocked(
      ProductProfileRunsRepository.prototype.findById,
    ).mockResolvedValueOnce({
      ...ledger,
      input_manifest: manifestWithDiscovery,
      input_hash: contentHash(manifestWithDiscovery),
    });
    vi.mocked(DataSnapshotsRepository.prototype.findById)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(discoverySnapshot);
    vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    ).mockResolvedValueOnce([discoveryObservation]);

    await runProductProfileSynthesis(
      ctx,
      { runId: IDS.run, ...scope },
      dependencies,
    );

    const inserted = vi.mocked(
      IcpProfilesRepository.prototype.insertVersion,
    ).mock.calls[0]?.[0];
    expect(inserted?.profile).toEqual(
      expect.objectContaining({
        competitorCandidates: [
          expect.objectContaining({
            domain: "rival.example",
            relationship: "direct",
            reviewStatus: "approved",
            similarity: null,
          }),
        ],
        fieldProvenance: expect.arrayContaining([
          expect.objectContaining({
            path: "/competitorCandidates/0",
            evidenceRefs: [
              expect.objectContaining({
                kind: "observation",
                observationId: IDS.discoveryObservation,
              }),
            ],
          }),
        ]),
      }),
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("validates frozen v2 SERP fallback evidence without representing it as domain overlap", async () => {
    const manifestWithFallback: ProductProfileSynthesisInputManifest = {
      ...manifest,
      competitorDiscovery: {
        snapshotId: IDS.discoverySnapshot,
        collectionRunId: IDS.discoveryCollectionRun,
        sourceConnectionId: IDS.discoverySource,
        datasetKey: "dataforseo.search_landscape.v2",
        schemaVersion: "dataforseo.search_landscape.v2",
        methodVersion: "dataforseo.search_landscape.v2",
        capturedAt,
        checksum: fallbackDiscoverySnapshot.checksum,
        availability: "available",
        rowCount: 1,
        limitation: fallbackDiscoverySnapshot.limitation,
        targetDomain: "example.com",
        marketCode: "US",
        languageCode: "zh",
        observations: [
          {
            sourceKind: "serp_competitor",
            observationId: IDS.discoveryObservation,
            domain: "rival.example",
            rating: 92,
            keywordsCount: 18,
            relevantSerpItems: 6,
            organicEstimatedTrafficVolume: 850,
            observedAt: capturedAt,
          },
        ],
      },
    };
    vi.mocked(
      ProductProfileRunsRepository.prototype.findById,
    ).mockResolvedValueOnce({
      ...ledger,
      input_manifest: manifestWithFallback,
      input_hash: contentHash(manifestWithFallback),
    });
    vi.mocked(DataSnapshotsRepository.prototype.findById)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(fallbackDiscoverySnapshot);
    vi.spyOn(
      ObservationsRepository.prototype,
      "listBySnapshotIds",
    ).mockResolvedValueOnce([fallbackDiscoveryObservation]);

    await runProductProfileSynthesis(
      ctx,
      { runId: IDS.run, ...scope },
      dependencies,
    );

    const inserted = vi.mocked(
      IcpProfilesRepository.prototype.insertVersion,
    ).mock.calls[0]?.[0];
    expect(inserted?.profile).toEqual(
      expect.objectContaining({
        competitorCandidates: [
          expect.objectContaining({
            domain: "rival.example",
            relationship: "direct",
            reason: expect.stringMatching(/SERP.*92.*6/iu),
            reviewStatus: "approved",
            similarity: null,
          }),
        ],
        fieldProvenance: expect.arrayContaining([
          expect.objectContaining({
            path: "/competitorCandidates/0",
            evidenceRefs: [
              expect.objectContaining({
                kind: "observation",
                observationId: IDS.discoveryObservation,
              }),
            ],
          }),
        ]),
      }),
    );
    expect(JSON.stringify(inserted?.profile)).not.toMatch(/keyword intersection/iu);
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it.each([
    [PRODUCT_PROFILE_LEGACY_PROMPT_SET_VERSION, false],
    [PRODUCT_PROFILE_DECLARED_CONTEXT_PROMPT_SET_VERSION, true],
  ] as const)(
    "finishes queued historical ledger %s through its exact client path",
    async (promptSetVersion, includesDeclaredContext) => {
      const legacyBase = createInitialProductProfileDraft({
        sourceSiteId: IDS.site,
        sourcePageUrl,
        businessHint: "Pre-deploy B2B workflow software",
        productName: "Customer-declared historical Acme",
        customerModel: "b2b",
        primaryMarket: "US",
        growthObjectives: ["generate_qualified_leads"],
      });
      const legacyBaseHash = contentHash({
        status: "draft",
        profile: legacyBase as unknown as CanonicalValue,
      });
      const {
        outputLocale: _outputLocale,
        competitorDiscovery: _competitorDiscovery,
        schemaVersion: _schemaVersion,
        ...legacyManifestBase
      } = manifest;
      const legacyManifest: ProductProfileSynthesisInputManifest = {
        ...legacyManifestBase,
        schemaVersion: PRODUCT_PROFILE_SYNTHESIS_LEGACY_INPUT_SCHEMA_VERSION,
        selectionPolicyVersion:
          PRODUCT_PROFILE_LEGACY_SELECTION_POLICY_VERSION,
        baseProfile: {
          ...manifest.baseProfile,
          contentHash: legacyBaseHash,
        },
      };
      const historicalDeclaredContext =
        buildProductProfileDeclaredContext(legacyBase);
      const legacyProviderInput: ProductProfileSynthesisInput = {
        sourcePageUrl,
        businessHint: "Pre-deploy B2B workflow software",
        pages: [
          buildBoundedProductProfilePageDescriptor(
            legacyManifest.pages[0]!,
            extract,
          ),
        ],
        ...(includesDeclaredContext && historicalDeclaredContext !== undefined
          ? { declaredContext: historicalDeclaredContext }
          : {}),
      };
      const legacyProviderHash = prepareProductProfileSynthesis(
        legacyProviderInput,
        promptSetVersion,
      ).inputHash;
      const legacyInvocation = {
        ...invocation,
        promptSetVersion,
        inputHash: legacyProviderHash,
      };
      const legacyReservation = {
        ...reservation,
        prompt_set_version: promptSetVersion,
        input_hash: legacyProviderHash,
      };
      vi.mocked(
        ProductProfileRunsRepository.prototype.findById,
      ).mockResolvedValueOnce({
        ...ledger,
        base_icp_profile_content_hash: legacyBaseHash,
        prompt_set_version: promptSetVersion,
        input_manifest: legacyManifest,
        input_hash: contentHash(legacyManifest),
      });
      vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValueOnce({
        ...baseRow,
        profile: legacyBase,
        content_hash: legacyBaseHash,
      });
      vi.mocked(
        ProductProfileInvocationAttemptsRepository.prototype.reserve,
      ).mockResolvedValueOnce({
        kind: "reserved",
        reservation: legacyReservation,
      });
      vi.mocked(
        ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
      ).mockResolvedValueOnce({
        kind: "finalized",
        reservation: {
          ...legacyReservation,
          status: "succeeded",
          analysis_invocation_id: IDS.invocation,
          provider_returned_at: generatedAt,
          finalized_at: generatedAt,
        },
        invocationId: IDS.invocation,
      });
      synthesizeProductProfile.mockResolvedValueOnce({
        candidate: candidate(),
        pageKeyMap: [{ pageKey: "page-1", inputIndex: 0 }],
        droppedCompetitorCount: 0,
        invocation: legacyInvocation,
      });

      await runProductProfileSynthesis(
        ctx,
        { runId: IDS.run, ...scope },
        dependencies,
      );

      expect(dependencies.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          promptSetVersion,
        }),
      );
      expect(synthesizeProductProfile).toHaveBeenCalledWith(
        legacyProviderInput,
      );
      if (includesDeclaredContext) {
        expect(synthesizeProductProfile.mock.calls[0]![0]).toHaveProperty(
          "declaredContext",
        );
      } else {
        expect(synthesizeProductProfile.mock.calls[0]![0]).not.toHaveProperty(
          "declaredContext",
        );
      }
      expect(
        ProductProfileInvocationAttemptsRepository.prototype.reserve,
      ).toHaveBeenCalledWith(
        attempt,
        expect.objectContaining({
          promptSetVersion,
          inputHash: legacyProviderHash,
        }),
      );
      expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
        attempt,
        expect.objectContaining({ status: "completed" }),
      );
    },
  );

  it("finishes the prior output-locale prompt with its matching frozen manifest version", async () => {
    const {
      competitorDiscovery: _competitorDiscovery,
      schemaVersion: _schemaVersion,
      ...manifestBase
    } = manifest;
    const priorManifest: ProductProfileSynthesisInputManifest = {
      ...manifestBase,
      schemaVersion:
        PRODUCT_PROFILE_SYNTHESIS_OUTPUT_LOCALE_INPUT_SCHEMA_VERSION,
      selectionPolicyVersion:
        PRODUCT_PROFILE_LEGACY_SELECTION_POLICY_VERSION,
    };
    const priorInput: ProductProfileSynthesisInput = {
      sourcePageUrl,
      outputLocale: "zh-CN",
      businessHint: "B2B workflow software",
      declaredContext: buildProductProfileDeclaredContext(baseProfile)!,
      pages: [
        buildBoundedProductProfilePageDescriptor(
          priorManifest.pages[0]!,
          extract,
        ),
      ],
    };
    const priorHash = prepareProductProfileSynthesis(
      priorInput,
      PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION,
    ).inputHash;
    const priorInvocation = {
      ...invocation,
      promptSetVersion: PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION,
      inputHash: priorHash,
    };
    const priorReservation = {
      ...reservation,
      prompt_set_version: PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION,
      input_hash: priorHash,
    };
    vi.mocked(
      ProductProfileRunsRepository.prototype.findById,
    ).mockResolvedValueOnce({
      ...ledger,
      prompt_set_version: PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION,
      input_manifest: priorManifest,
      input_hash: contentHash(priorManifest),
    });
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({
      kind: "reserved",
      reservation: priorReservation,
    });
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockResolvedValueOnce({
      kind: "finalized",
      reservation: {
        ...priorReservation,
        status: "succeeded",
        analysis_invocation_id: IDS.invocation,
        provider_returned_at: generatedAt,
        finalized_at: generatedAt,
      },
      invocationId: IDS.invocation,
    });
    synthesizeProductProfile.mockResolvedValueOnce({
      candidate: candidate(),
      pageKeyMap: [{ pageKey: "page-1", inputIndex: 0 }],
      droppedCompetitorCount: 0,
      invocation: priorInvocation,
    });

    await runProductProfileSynthesis(
      ctx,
      { runId: IDS.run, ...scope },
      dependencies,
    );

    expect(dependencies.createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        promptSetVersion: PRODUCT_PROFILE_OUTPUT_LOCALE_PROMPT_SET_VERSION,
      }),
    );
    expect(synthesizeProductProfile).toHaveBeenCalledWith(priorInput);
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("revalidates an old frozen UTC manifest against offset database text for the same instant", async () => {
    const offsetInstant = "2026-07-22 09:00:00.000000+08";
    vi.mocked(DataSnapshotsRepository.prototype.findById).mockResolvedValueOnce({
      ...snapshot,
      captured_at: offsetInstant,
    });
    vi.mocked(
      PageSnapshotsRepository.prototype.findByIdsWithSitePageIdentity,
    ).mockResolvedValueOnce([{ ...pageRow, captured_at: offsetInstant }]);

    await runProductProfileSynthesis(
      ctx,
      { runId: IDS.run, ...scope },
      dependencies,
    );

    expect(synthesizeProductProfile).toHaveBeenCalledOnce();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("fails closed before a model call when immutable PageSnapshot lineage was tampered", async () => {
    vi.mocked(PageSnapshotsRepository.prototype.findByIdsWithSitePageIdentity).mockResolvedValueOnce([
      { ...pageRow, content_hash: "d".repeat(64) },
    ]);

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "PRODUCT_PROFILE_SYNTHESIS_INPUT_INVALID",
      }),
    );
  });

  it("fails before a model call when the base Product Profile changed after enqueue", async () => {
    vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValueOnce({
      ...baseRow,
      profile: { ...baseProfile, productName: "Mutated after queue" },
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "PRODUCT_PROFILE_SYNTHESIS_INPUT_INVALID",
      }),
    );
  });

  it("rejects a frozen complete base profile before any provider work", async () => {
    const completeBaseHash = contentHash({
      status: "complete",
      profile: baseProfile as unknown as CanonicalValue,
    });
    const completeManifest = {
      ...manifest,
      baseProfile: {
        ...manifest.baseProfile,
        contentHash: completeBaseHash,
        status: "complete",
      },
    } as unknown as ProductProfileSynthesisInputManifest;
    vi.mocked(ProductProfileRunsRepository.prototype.findById).mockResolvedValueOnce({
      ...ledger,
      base_icp_profile_content_hash: completeBaseHash,
      input_manifest: completeManifest,
      input_hash: contentHash(completeManifest),
    });
    vi.mocked(IcpProfilesRepository.prototype.findById).mockResolvedValueOnce({
      ...baseRow,
      status: "complete",
      content_hash: completeBaseHash,
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "PRODUCT_PROFILE_SYNTHESIS_INPUT_INVALID",
      }),
    );
  });

  it("fails without creating a fourth model call when the persisted budget is exhausted", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({ kind: "budget_exhausted" });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_BUDGET_EXHAUSTED",
      }),
    );
  });

  it("does not call the provider again for an existing reservation owned by the same delivery", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({ kind: "existing", reservation });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).not.toHaveBeenCalled();
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
  });

  it("fails a newer delivery when an older provider outcome remains unresolved", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({ kind: "unresolved", reservation });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      {
        status: "failed",
        lastErrorCode:
          "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN",
        lastErrorSummary:
          "The provider invocation outcome could not be safely recovered.",
      },
    );
  });

  it("fails before provider work when a durable reservation reports different preflight identity", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({ kind: "configuration_mismatch" });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode:
          "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_CONFIGURATION_MISMATCH",
      }),
    );
  });

  it("fails closed without provider work when a reserved row does not match the exact preflight", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).mockResolvedValueOnce({
      kind: "reserved",
      reservation: { ...reservation, input_hash: "e".repeat(64) },
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).not.toHaveBeenCalled();
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.markOutcomeUnknown,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        lastErrorCode:
          "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_CONFIGURATION_MISMATCH",
      }),
    );
  });

  it("makes exactly one model call after atomically reserving one budget slot", async () => {
    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).toHaveBeenCalledTimes(1);
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).toHaveBeenCalledTimes(1);
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).toHaveBeenCalledTimes(1);
  });

  it("persists a transient failed invocation, resets the exact attempt, then rethrows for pg-boss", async () => {
    const failedInvocation = {
      ...invocation,
      outputHash: null,
      status: "failed" as const,
      errorCode: "RATE_LIMITED",
    };
    const failure = new LLMError("RATE_LIMITED", "provider secret", failedInvocation);
    synthesizeProductProfile.mockRejectedValueOnce(failure);

    await expect(
      runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies),
    ).rejects.toBe(failure);

    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).toHaveBeenCalledWith(
      attempt,
      reservation.id,
      expect.objectContaining({
        inputHash: failedInvocation.inputHash,
        status: "failed",
      }),
    );
    expect(AsyncRunsRepository.prototype.resetToQueued).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({ code: "RATE_LIMITED" }),
    );
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      "provider secret",
    );
  });

  it("persists a rejected invocation and terminalizes a permanent failure without retry", async () => {
    const rejectedInvocation = {
      ...invocation,
      outputHash: null,
      status: "rejected" as const,
      errorCode: "SCHEMA_INVALID",
    };
    synthesizeProductProfile.mockRejectedValueOnce(
      new LLMError("SCHEMA_INVALID", "candidate secret", rejectedInvocation),
    );

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).toHaveBeenCalledTimes(1);
    expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "SCHEMA_INVALID",
      }),
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      "candidate secret",
    );
  });

  it("marks the reservation unknown and never commits when the client reports a different preflight hash", async () => {
    synthesizeProductProfile.mockResolvedValueOnce({
      candidate: candidate(),
      pageKeyMap: [{ pageKey: "page-1", inputIndex: 0 }],
      droppedCompetitorCount: 0,
      invocation: { ...invocation, inputHash: "d".repeat(64) },
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).not.toHaveBeenCalled();
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      reservation.id,
      "INVOCATION_IDENTITY_MISMATCH",
    );
    expect(IcpProfilesRepository.prototype.insertVersion).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode:
          "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN",
      }),
    );
  });

  it("retains a durable unknown attempt when provider success cannot be finalized", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockRejectedValueOnce(new Error("database write failed after provider return"));

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).toHaveBeenCalledTimes(1);
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      reservation.id,
      "INVOCATION_PERSISTENCE_UNKNOWN",
    );
    expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
    expect(IcpProfilesRepository.prototype.insertVersion).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode:
          "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN",
      }),
    );
  });

  it("marks an auditable unknown outcome when the provider boundary throws without invocation metadata", async () => {
    const failure = new Error("provider response contained a customer secret");
    synthesizeProductProfile.mockRejectedValueOnce(failure);

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      ProductProfileInvocationAttemptsRepository.prototype.markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      reservation.id,
      "PROVIDER_OUTCOME_UNKNOWN",
    );
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        lastErrorCode:
          "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN",
      }),
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
      "customer secret",
    );
  });

  it("terminalizes from the durable reservation when recording an unknown provider outcome also throws", async () => {
    const providerFailure = new Error("provider response was indeterminate");
    const persistenceFailure = new Error(
      "connection closed before acknowledgement",
    );
    const terminalizationFailure = new Error(
      "terminal failure commit acknowledgement was lost",
    );
    const redeliveryRun = {
      ...run,
      attempt_count: run.attempt_count + 1,
    } satisfies AsyncRunRow;
    const redeliveryAttempt = toRunAttempt(redeliveryRun);
    synthesizeProductProfile.mockRejectedValueOnce(providerFailure);
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.markOutcomeUnknown,
    ).mockRejectedValueOnce(persistenceFailure);
    vi.mocked(AsyncRunsRepository.prototype.claim)
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(redeliveryRun);
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    )
      .mockResolvedValueOnce({ kind: "reserved", reservation })
      .mockResolvedValueOnce({ kind: "unresolved", reservation });
    vi.mocked(AsyncRunsRepository.prototype.setTerminal)
      .mockRejectedValueOnce(terminalizationFailure)
      .mockResolvedValueOnce(true);

    await expect(
      runProductProfileSynthesis(
        ctx,
        { runId: IDS.run, ...scope },
        dependencies,
      ),
    ).rejects.toBe(terminalizationFailure);
    await runProductProfileSynthesis(
      ctx,
      { runId: IDS.run, ...scope },
      dependencies,
    );

    expect(synthesizeProductProfile).toHaveBeenCalledTimes(1);
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.reserve,
    ).toHaveBeenCalledTimes(2);
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.markOutcomeUnknown,
    ).toHaveBeenCalledTimes(1);
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.markOutcomeUnknown,
    ).toHaveBeenCalledWith(
      attempt,
      reservation.id,
      "PROVIDER_OUTCOME_UNKNOWN",
    );
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.resetToQueued).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledTimes(2);
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenNthCalledWith(
      1,
      attempt,
      {
        status: "failed",
        lastErrorCode:
          "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN",
        lastErrorSummary:
          "The provider invocation outcome could not be safely recovered.",
      },
    );
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenNthCalledWith(
      2,
      redeliveryAttempt,
      {
        status: "failed",
        lastErrorCode:
          "PRODUCT_PROFILE_SYNTHESIS_INVOCATION_OUTCOME_UNKNOWN",
        lastErrorSummary:
          "The provider invocation outcome could not be safely recovered.",
      },
    );
    expect(IcpProfilesRepository.prototype.insertVersion).not.toHaveBeenCalled();
    expect(
      ProjectsRepository.prototype.setCurrentIcpProfile,
    ).not.toHaveBeenCalled();
    expect(
      ProductProfileRunsRepository.prototype.setResult,
    ).not.toHaveBeenCalled();
  });

  it("continues with the canonical invocation id after an ambiguous finalize commit", async () => {
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).mockRejectedValueOnce(new Error("connection closed after commit"));
    vi.mocked(
      ProductProfileInvocationAttemptsRepository.prototype.markOutcomeUnknown,
    ).mockResolvedValueOnce({
      kind: "finalized",
      reservation: finalizedReservation,
      invocationId: IDS.invocation,
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(IcpProfilesRepository.prototype.insertVersion).toHaveBeenCalledTimes(1);
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      {
        status: "completed",
        resultType: "icp_profile",
        resultId: IDS.resultProfile,
      },
    );
  });

  it("rejects a succeeded envelope whose candidate no longer matches its immutable output hash", async () => {
    synthesizeProductProfile.mockResolvedValueOnce({
      candidate: candidate(),
      pageKeyMap: [{ pageKey: "page-1", inputIndex: 0 }],
      droppedCompetitorCount: 0,
      invocation: { ...invocation, outputHash: "d".repeat(64) },
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).toHaveBeenCalledTimes(1);
    expect(IcpProfilesRepository.prototype.insertVersion).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(
      attempt,
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "PRODUCT_PROFILE_SYNTHESIS_RESULT_INVALID",
      }),
    );
  });

  it("cancels a stale synthesis after the model call without replacing the newer profile", async () => {
    vi.mocked(ProjectsRepository.prototype.findByIdForUpdate).mockResolvedValueOnce({
      ...project,
      current_icp_profile_id: IDS.resultProfile,
    });

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(IcpProfilesRepository.prototype.insertVersion).not.toHaveBeenCalled();
    expect(ProductProfileRunsRepository.prototype.setResult).not.toHaveBeenCalled();
    expect(ProjectsRepository.prototype.setCurrentIcpProfile).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).toHaveBeenCalledWith(attempt, {
      status: "cancelled",
      lastErrorCode: "PRODUCT_PROFILE_SYNTHESIS_SUPERSEDED",
      lastErrorSummary: "Product Profile synthesis was superseded.",
    });
  });

  it("stops after the provider audit row when the claimed attempt lost ownership", async () => {
    vi.mocked(AsyncRunsRepository.prototype.lockAttemptForUpdate).mockResolvedValueOnce(null);

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(synthesizeProductProfile).toHaveBeenCalledTimes(1);
    expect(
      ProductProfileInvocationAttemptsRepository.prototype.finalizeWithInvocation,
    ).toHaveBeenCalledTimes(1);
    expect(IcpProfilesRepository.prototype.insertVersion).not.toHaveBeenCalled();
    expect(ProjectsRepository.prototype.setCurrentIcpProfile).not.toHaveBeenCalled();
    expect(ProductProfileRunsRepository.prototype.setResult).not.toHaveBeenCalled();
    expect(AsyncRunsRepository.prototype.setTerminal).not.toHaveBeenCalled();
  });

  it("does nothing for a stale delivery that cannot claim the canonical run", async () => {
    vi.mocked(AsyncRunsRepository.prototype.claim).mockResolvedValueOnce(null);

    await runProductProfileSynthesis(ctx, { runId: IDS.run, ...scope }, dependencies);

    expect(ProductProfileRunsRepository.prototype.findById).not.toHaveBeenCalled();
    expect(synthesizeProductProfile).not.toHaveBeenCalled();
  });

});
