import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["OPENAI_API_KEY"] ??= "sk-test";
process.env["OPENAI_MODEL"] ??= "gpt-4o-mini";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["LOG_LEVEL"] ??= "error";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createDbHandle, type Db, type DbHandle } from "@sf/db/client";
import {
  ActionsRepository,
  AsyncRunsRepository,
  CapabilityRunsRepository,
  CollectionRunsRepository,
  contentHash,
  canonicalUtcTimestamptz,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  FlowShadowQaGateReplayConflictError,
  FlowShadowQaGatesRepository,
  FlowShadowResearchPacksRepository,
  FlowShadowRunsRepository,
  PageSnapshotsRepository,
  SitePagesRepository,
  CONTENT_SHADOW_PROJECTION_VERSION,
  SourceConnectionsRepository,
  type CanonicalValue,
  type ProjectScope,
} from "@sf/db";
import {
  asyncRuns,
  clientProjects,
  icpProfiles,
  sites,
  workspaces,
} from "@sf/db/schema";
import {
  buildContentShadowInputManifest,
  CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS,
  extractContentBriefExternalTargets,
  CONTENT_SHADOW_ADAPTER_VERSION,
} from "@sf/flow-shadow";
import {
  CONTENT_SHADOW_PROMPT_SET_VERSION,
  extractContentBriefOutline,
  LLMError,
} from "@sf/artifacts";
import {
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { reconcileActiveRuns } from "../../handlers/recovery.ts";
import { runContentShadow } from "../run-content-shadow.ts";

/**
 * The Content Shadow pipeline driven end to end against a real local Postgres
 * with a stubbed model call. Covers what the shadow contract actually promises:
 * the append-only provenance chain, convergence on crash re-delivery, the
 * pinned-input replay guard, and the absence of any external/publish write.
 */

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CRAWL_METHOD_VERSION = "crawl.site_graph.v2";
const CRAWL_DATASET_KEY = "crawl.site_graph.v1";
const CONTENT_RULE_ID = "CONTENT-COVERAGE-001";
const DRAFT_MARKDOWN = "# Shadow draft\n\nA deterministic fixture body.";
const CLUSTER_KEY = "onboarding";
/** A realistic confirmed brief: the extractor must find its `## ` headings. */
const BRIEF_MARKDOWN = [
  "## Objective",
  "",
  "Close the onboarding coverage gap.",
  "",
  "## Audience",
  "",
  "RevOps leads evaluating onboarding tooling.",
  "",
  "## Outline",
  "",
  "- Intro",
  "- Core sections",
  "",
  "[Analyst note](https://example.net/research/onboarding-automation)",
].join("\n");
const EXTERNAL_RESEARCH_URL = "https://example.net/research/onboarding-automation";
const CRAWL_PAGE_EXTRACT_SCHEMA_VERSION = "crawl.page-extract.v1";
const firstPartyPageUrl = (projectId: string, index = 0): string =>
  `https://${projectId}.example.test/templates/onboarding-checklist${index === 0 ? "" : `-${index}`}`;
const firstPartyProjection = (projectId: string, index = 0) => ({
  fetchUrl: firstPartyPageUrl(projectId, index),
  status: 200,
  finalStatus: 200,
  redirectChain: [],
  canonicalTarget: null,
  robotsIndexable: true,
  robotsDirectives: [],
  title: "Onboarding Checklist Template",
  metaDescription: "A first-party template page for onboarding handoffs.",
  h1: ["Onboarding Checklist Template"],
  headings: ["Onboarding Checklist Template", "Handoff Steps"],
  wordCount: 42,
  internalOutlinks: [],
  jsonLd: { types: [], errorCount: 0 },
  sitemapMember: true,
  bodyExcerpt:
    index === 0
      ? "Use this onboarding checklist to keep customer handoffs and milestones consistent."
      : `First-party context page ${index}.`,
  paragraphs:
    index === 0
      ? [
          "Use this onboarding checklist to keep customer handoffs and milestones consistent.",
          "Track owners, due dates, and dependencies in one shared workflow.",
        ]
      : [
          `First-party context page ${index}.`,
          "Track owners, due dates, and dependencies in one shared workflow.",
        ],
  responseMs: 123,
  contentType: "text/html; charset=utf-8",
} as const);

const generateArtifact = vi.hoisted(() => vi.fn());
const retrievePublicWebResearch = vi.hoisted(() => vi.fn());
vi.mock("@sf/artifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/artifacts")>();
  return {
    ...actual,
    createOpenAIClient: () => ({ generateArtifact }),
  };
});
vi.mock("@sf/sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sf/sources")>();
  return {
    ...actual,
    retrievePublicWebResearch,
  };
});

/** A queue whose job for the run has vanished, which is what recovery is for. */
const RECOVERY_BOSS = {
  getJobById: async () => null,
  findJobs: async () => [],
};

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface ShadowFixture {
  readonly base: ProjectSeed;
  readonly scope: ProjectScope;
  readonly actorId: string;
  readonly siteId: string;
  readonly findingId: string;
  readonly actionId: string;
  readonly briefArtifactId: string;
  readonly diagnosticRunId: string;
  readonly asyncRunId: string;
  readonly flowShadowRunId: string;
  readonly keywordId: string;
  readonly crawlSnapshotId: string;
  readonly crawlCapturedAt: string;
}

async function seedProject(db: Db): Promise<ProjectSeed> {
  const actorId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const icpProfileId = randomUUID();
  const icpProfile = {
    productName: "Shadow fixture",
    siteLanguageCodes: ["en"],
    brandConstraints: ["Use precise operational language."],
    complianceConstraints: ["Do not promise guaranteed time savings."],
    prohibitedTerms: ["best-in-class"],
    claimRestrictions: ["Do not cite unsupported benchmarks."],
  };
  const icpContentHash = contentHash(icpProfile);

  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: `Shadow ${workspaceId}` });
  await db.insert(clientProjects).values({
    id: projectId,
    workspace_id: workspaceId,
    client_name: `Client ${projectId}`,
    project_name: `Project ${projectId}`,
    default_delivery_locale: "en",
    created_by: actorId,
  });
  await db.insert(sites).values({
    id: siteId,
    workspace_id: workspaceId,
    project_id: projectId,
    origin: `https://${projectId}.example.test`,
    host: `${projectId}.example.test`,
    market_codes: ["US"],
    language_codes: ["en"],
  });
  const crawlSource = await new SourceConnectionsRepository(
    db,
  ).insertDefaultCrawl({ workspaceId, projectId, siteId, createdBy: actorId });
  await db.insert(icpProfiles).values({
    id: icpProfileId,
    workspace_id: workspaceId,
    project_id: projectId,
    version: 1,
    status: "complete",
    profile: icpProfile,
    content_hash: icpContentHash,
    created_by: actorId,
  });

  return {
    scope: { workspaceId, projectId },
    actorId,
    siteId,
    icpProfileId,
    icpContentHash,
    crawlSourceConnectionId: crawlSource.id,
  };
}

interface ProjectSeed {
  readonly scope: ProjectScope;
  readonly actorId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
  readonly icpContentHash: string;
  readonly crawlSourceConnectionId: string;
}

interface DiagnosticSeed {
  readonly runId: string;
  readonly collectionRunId: string;
  readonly snapshotId: string;
  readonly capturedAt: string;
}

/** One complete collection -> snapshot -> diagnostic run lineage. */
async function seedDiagnosticRun(
  db: Db,
  base: ProjectSeed,
): Promise<DiagnosticSeed> {
  const { scope, actorId, siteId } = base;
  const capturedAt = new Date().toISOString();
  const sourceWindow = { start: null, end: null };

  const collectionRunId = randomUUID();
  await db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "collection",
    status: "completed",
    initiated_by: actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const collectionRuns = new CollectionRunsRepository(db);
  await collectionRuns.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    sourceConnectionId: base.crawlSourceConnectionId,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    collectionRunId,
    sourceConnectionId: base.crawlSourceConnectionId,
    provider: "crawl",
    datasetKey: CRAWL_DATASET_KEY,
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow,
    availability: "available",
    limitation: "Content shadow worker fixture.",
    rawObjectKey: null,
    rowCount: 1,
    checksum: contentHash({ collectionRunId, capturedAt }),
  });
  await collectionRuns.finalize(collectionRunId, {
    rowCount: snapshot.row_count,
    sourceWindow,
    providerUsage: { urlsFetched: 1, pagesCollected: 1 },
    stopReason: null,
  });

  const runId = randomUUID();
  await db.insert(asyncRuns).values({
    id: runId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "diagnostic",
    status: "completed",
    initiated_by: actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const inputManifest = {
    projectId: scope.projectId,
    siteId,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en",
    governance: {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [],
      competitors: [],
    },
    icp: {
      id: base.icpProfileId,
      version: 1,
      contentHash: base.icpContentHash,
    },
    snapshots: [
      {
        snapshotId: snapshot.id,
        provider: "crawl",
        datasetKey: snapshot.dataset_key,
        schemaVersion: snapshot.schema_version,
        methodVersion: snapshot.method_version,
        checksum: snapshot.checksum,
        availability: snapshot.availability,
        sourceWindow,
        capturedAt: snapshot.captured_at,
      },
    ],
  };
  await new DiagnosticRunsRepository(db).insert({
    runId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    icpProfileId: base.icpProfileId,
    icpProfileVersion: 1,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: "en",
    inputManifest,
    inputHash: contentHash(inputManifest),
  });
  return {
    runId,
    collectionRunId,
    snapshotId: snapshot.id,
    capturedAt: snapshot.captured_at,
  };
}

/** Attach one primary Evidence row from `diagnostic` to `findingId`. */
async function linkFindingEvidence(
  db: Db,
  base: ProjectSeed,
  findingId: string,
  diagnostic: DiagnosticSeed,
): Promise<void> {
  const evidenceRepo = new EvidenceRepository(db);
  const evidenceScope = {
    workspaceId: base.scope.workspaceId,
    projectId: base.scope.projectId,
    diagnosticRunId: diagnostic.runId,
  };
  const [evidenceId] = await evidenceRepo.insertMany(evidenceScope, [
    {
      sourceProvider: "crawl",
      origin: "direct_public",
      method: "observed",
      grade: "B",
      availability: "available",
      support: "supports",
      subjectRefs: ["https://example.test/blog"],
      claim: "Observed content coverage gap.",
      observedAt: diagnostic.capturedAt,
      limitation: "Disposable worker fixture.",
      snapshotId: diagnostic.snapshotId,
      collectionRunId: diagnostic.collectionRunId,
    },
  ]);
  await evidenceRepo.linkObservations(evidenceScope, [
    { findingId, evidenceId: evidenceId!, role: "primary" },
  ]);
}

async function seedShadowChain(
  handle: DbHandle,
  options: {
    readonly flowAdapterVersion?: string;
    readonly projectionVersion?: string;
    readonly promptSetVersion?: string;
    readonly briefMarkdown?: string;
    readonly firstPartyPageCount?: number;
  } = {},
): Promise<ShadowFixture> {
  const flowAdapterVersion =
    options.flowAdapterVersion ?? CONTENT_SHADOW_ADAPTER_VERSION;
  const projectionVersion =
    options.projectionVersion ?? CONTENT_SHADOW_PROJECTION_VERSION;
  const db = handle.db;
  const base = await seedProject(db);
  const { scope, actorId, siteId } = base;
  const diagnostic = await seedDiagnosticRun(db, base);
  const diagnosticRunId = diagnostic.runId;
  const capturedAt = canonicalUtcTimestamptz(diagnostic.capturedAt);

  const finding = await new FindingsRepository(db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    findingKey: contentHash({ fixtureId: randomUUID() }),
    ruleId: CONTENT_RULE_ID,
    ruleVersion: 1,
    ruleFamily: "content-coverage",
    intent: "improve_coverage",
    domain: "content_intent",
    titleKey: "finding.content_coverage",
    titleArgs: { cluster: "onboarding" },
    summary: "A traced content coverage finding.",
    summaryLocale: "en",
    subjectRefs: ["keyword_cluster:onboarding"],
    severity: "high",
    confidence: "high",
    reviewState: "confirmed",
    runId: diagnosticRunId,
    seenAt: capturedAt,
  });
  await linkFindingEvidence(db, base, finding.id, diagnostic);

  const action = await new ActionsRepository(db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    sourceFindingId: finding.id,
    sourceDiagnosticRunId: diagnosticRunId,
    actionKey: contentHash({ fixtureId: randomUUID() }),
    templateId: `content_brief.${randomUUID()}`,
    templateVersion: 1,
    title: "Draft the content brief",
    description: "Produce a content brief for the confirmed coverage gap.",
    contentLocale: "en",
    priorityBand: "high",
    roadmapLane: "now",
    status: "planned",
    effort: "medium",
    risk: "low",
    expectedOutcome: "The coverage gap is briefed.",
    evidenceRefs: [],
    createdBy: actorId,
  });

  const briefArtifactId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.execution_artifacts (
       id, workspace_id, project_id, action_id, artifact_type, status,
       generation_mode, output_locale, current_revision, validation_state,
       content_hash, created_by
     ) VALUES ($1,$2,$3,$4,'content_brief','ready','template','en',1,'valid',$5,$6)`,
    [
      briefArtifactId,
      scope.workspaceId,
      scope.projectId,
      action.id,
      contentHash({ briefArtifactId }),
      actorId,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.artifact_revisions (
       id, workspace_id, project_id, artifact_id, revision, output_locale,
       content_format, content_text, content_hash, generated_by
     ) VALUES ($1,$2,$3,$4,1,'en','markdown',$5,$6,'template')`,
    [
      randomUUID(),
      scope.workspaceId,
      scope.projectId,
      briefArtifactId,
      options.briefMarkdown ?? BRIEF_MARKDOWN,
      contentHash({ briefArtifactId, revision: 1 }),
    ],
  );

  // A real frozen SearchQuery cluster member: the worker re-reads it live and
  // re-derives the outline from it, so its mapping decision is a drift source.
  const keywordId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.keyword_entities (
       id, workspace_id, project_id, display_keyword, normalized_keyword,
       market, language_tag, query_kind, cluster_key, mapping_decision,
       mapping_review_state, first_seen_at, last_seen_at
     ) VALUES ($1,$2,$3,$4,$5,'US','en','search_query',$6,'new_asset','confirmed',$7,$7)`,
    [
      keywordId,
      scope.workspaceId,
      scope.projectId,
      "onboarding checklist",
      "onboarding checklist",
      CLUSTER_KEY,
      capturedAt,
    ],
  );
  const firstPartyPageCount = options.firstPartyPageCount ?? 1;
  const pageSnapshots: Array<{
    readonly pageSnapshotId: string;
    readonly url: string;
    readonly urlHash: string;
    readonly contentHash: string;
  }> = [];
  for (let index = 0; index < firstPartyPageCount; index += 1) {
    const url = firstPartyPageUrl(scope.projectId, index);
    const projection = firstPartyProjection(scope.projectId, index);
    const extract = {
      schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
      subjectUrl: url,
      depth: 0,
      projection,
    } as const;
    const sitePage = await new SitePagesRepository(db).upsertNormalizedUrl({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId,
      normalizedUrl: url,
      templateKey: "checklist",
    });
    const pageSnapshot = await new PageSnapshotsRepository(db).create({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      sitePageId: sitePage.id,
      dataSnapshotId: diagnostic.snapshotId,
      contentHash: contentHash(extract as unknown as CanonicalValue),
      extract,
      capturedAt,
    });
    pageSnapshots.push({
      pageSnapshotId: pageSnapshot.id,
      url,
      urlHash: sitePage.normalized_url_hash,
      contentHash: pageSnapshot.content_hash,
    });
  }

  const asyncRunId = randomUUID();
  await db.insert(asyncRuns).values({
    id: asyncRunId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "content_shadow",
    status: "queued",
    active_key: `content_shadow:${action.id}`,
    initiated_by: actorId,
  });
  await new CapabilityRunsRepository(db).create({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    asyncRunId,
    capabilityId: "content-shadow",
    capabilityVersion: "0.3.0",
    inputManifestHash: contentHash({ asyncRunId }),
    mode: "shadow",
    sideEffectClass: "internal_write",
  });

  const manifest = buildContentShadowInputManifest({
    primaryFindingId: finding.id,
    sourceActionId: action.id,
    sourceDiagnosticRunId: diagnosticRunId,
    contentBriefArtifactId: briefArtifactId,
    contentBriefRevision: 1,
    competitorEntityIds: [],
    searchCluster: {
      clusterKey: CLUSTER_KEY,
      keywordEntityIds: [keywordId],
    },
    generativeQueryEntityIds: [],
    firstParty: {
      siteOrigin: `https://${scope.projectId}.example.test`,
      // The fixture ICP carries no `primaryConversion`, so the frozen tuple
      // records its absence rather than a placeholder.
      icpPrimaryConversionUrl: null,
    },
    contentBriefOutline: extractContentBriefOutline({
      briefMarkdown: options.briefMarkdown ?? BRIEF_MARKDOWN,
      keywords: [
        {
          id: keywordId,
          displayKeyword: "onboarding checklist",
          normalizedKeyword: "onboarding checklist",
          mappingDecision: "new_asset",
          mappingReviewState: "confirmed",
        },
      ],
    }).outline,
    researchContext: {
      firstPartyPageSnapshots: [
        ...pageSnapshots.map((page) => ({
          pageSnapshotId: page.pageSnapshotId,
          dataSnapshotId: diagnostic.snapshotId,
          url: page.url,
          urlHash: page.urlHash,
          contentHash: page.contentHash,
          capturedAt,
        })),
      ],
      searchKeywordFacts: [
        {
          id: keywordId,
          display: "onboarding checklist",
          market: "US",
          language: "en",
          intent: null,
          buyerStage: null,
          cluster: CLUSTER_KEY,
          mapping: {
            decision: "new_asset",
            mappedSitePageId: null,
            reviewState: "confirmed",
            revision: 0,
          },
          lastSeen: capturedAt,
          evidenceRefs: [],
        },
      ],
      generativeKeywordFacts: [],
      competitorFacts: [],
      externalTargets: extractContentBriefExternalTargets({
        briefMarkdown: options.briefMarkdown ?? BRIEF_MARKDOWN,
        firstPartyOrigins: [`https://${scope.projectId}.example.test`],
        maxTargets: CONTENT_SHADOW_RESEARCH_CONTEXT_LIMITS.externalTargets,
      }),
      contentPolicy: {
        brandConstraints: ["Use precise operational language."],
        complianceConstraints: ["Do not promise guaranteed time savings."],
        prohibitedTerms: ["best-in-class"],
        claimRestrictions: [
          "no_guarantees",
          "no_unsupported_quantified_claims",
          "no_unverified_superlatives",
          "Do not cite unsupported benchmarks.",
        ],
      },
    },
    flowAdapterVersion,
    promptSetVersion:
      options.promptSetVersion ?? CONTENT_SHADOW_PROMPT_SET_VERSION,
    projectionVersion,
    outputLocale: "en",
  });
  const frozenHash = contentHash(manifest as unknown as CanonicalValue);
  const shadowRun = await new FlowShadowRunsRepository(db).create({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    capabilityRunId: asyncRunId,
    sourceFindingId: finding.id,
    sourceActionId: action.id,
    contentBriefArtifactId: briefArtifactId,
    contentBriefRevision: 1,
    flowAdapterVersion,
    frozenInputManifest: manifest as unknown as Record<string, unknown>,
    contentHash: frozenHash,
    projectionVersion,
  });

  return {
    base,
    scope,
    actorId,
    siteId,
    findingId: finding.id,
    actionId: action.id,
    briefArtifactId,
    diagnosticRunId,
    asyncRunId,
    flowShadowRunId: shadowRun.id,
    keywordId,
    crawlSnapshotId: diagnostic.snapshotId,
    crawlCapturedAt: diagnostic.capturedAt,
  };
}

describeDb("runContentShadow", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
    ctx = {
      db: handle.db,
      boss: {} as WorkerContext["boss"],
      blobStore: {} as WorkerContext["blobStore"],
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "id", clientSecret: "secret" },
      openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
      findingSummariesEnabled: false,
      logger: testLogger,
    };
  });
  afterAll(async () => {
    await handle?.end();
  });

  beforeEach(() => {
    generateArtifact.mockReset();
    generateArtifact.mockResolvedValue({
      content: { contentFormat: "markdown", content: DRAFT_MARKDOWN },
      invocation: {
        task: "artifact_generation",
        provider: "openai",
        model: "gpt-4o-mini",
        promptSetVersion: PROMPT_SET_VERSION,
        inputHash: contentHash({ prompt: "fixture" }),
        outputHash: contentHash({ output: "fixture" }),
        status: "succeeded",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: null,
        latencyMs: 5,
        errorCode: null,
      },
    });
    retrievePublicWebResearch.mockReset();
    retrievePublicWebResearch.mockResolvedValue({
      adapterVersion: "public_web_research.v1",
      sources: [
        {
          requestedUrl: EXTERNAL_RESEARCH_URL,
          finalUrl: EXTERNAL_RESEARCH_URL,
          urlHash: contentHash({ url: EXTERNAL_RESEARCH_URL }),
          contentHash: contentHash({ text: "External analyst source." }),
          capturedAt: "2026-07-27T08:09:10.000Z",
          title: "External analyst source",
          excerpt: "External analyst source.",
          contentText: "External analyst source.",
          status: 200,
          contentType: "text/html; charset=utf-8",
          bodyBytes: 512,
          wordCount: 3,
          contentTruncated: false,
          excerptTruncated: false,
          responseMs: 8,
          redirectChain: [],
          availability: "available",
          limitation: null,
        },
      ],
      availability: "available",
      limitation: null,
      stopReason: null,
      usage: {
        targetCount: 1,
        attemptedTargets: 1,
        availableTargets: 1,
        partialTargets: 0,
        unavailableTargets: 0,
        bodyBytes: 512,
        redirectsFollowed: 0,
        elapsedMs: 8,
      },
    });
  });

  it("appends research, draft and QA children then completes the canonical run", async () => {
    const fixture = await seedShadowChain(handle);

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const pack = await new FlowShadowResearchPacksRepository(
      handle.db,
    ).findByRun(fixture.scope, fixture.flowShadowRunId);
    expect(pack?.content_hash).toBe(
      contentHash(pack?.pack as unknown as CanonicalValue),
    );
    // Invariant 8: the persisted pack keeps the two observations separate.
    expect(pack?.pack["searchObservation"]).toBeDefined();
    expect(pack?.pack["generativeObservation"]).toBeDefined();
    expect(
      (pack?.pack["sources"] as ReadonlyArray<Record<string, unknown>>).some(
        (source) => source["kind"] === "first_party_page",
      ),
    ).toBe(true);
    expect(
      (pack?.pack["sources"] as ReadonlyArray<Record<string, unknown>>).some(
        (source) =>
          source["kind"] === "external_page" &&
          source["url"] === EXTERNAL_RESEARCH_URL,
      ),
    ).toBe(true);
    expect(retrievePublicWebResearch).toHaveBeenCalledOnce();

    const artifacts = new ExecutionArtifactsRepository(handle.db);
    const draft = await artifacts.findLiveByActionType(
      fixture.scope,
      fixture.actionId,
      "english_blog_draft",
    );
    expect(draft).toMatchObject({ status: "draft", current_revision: 1 });
    const revision = await artifacts.findRevision(fixture.scope, draft!.id, 1);
    expect(revision?.content_text).toBe(DRAFT_MARKDOWN);
    expect(revision?.generated_by).toBe("llm");
    expect(revision?.analysis_invocation_id).not.toBeNull();
    const promptInput = generateArtifact.mock.calls[0]?.[0] as {
      readonly researchContext: {
        readonly sources: readonly Record<string, unknown>[];
        readonly policy: Record<string, unknown>;
      } | null;
    };
    expect(promptInput.researchContext?.sources).toHaveLength(2);
    expect(
      promptInput.researchContext?.sources.map((source) => source["kind"]),
    ).toEqual(["external_page", "first_party_page"]);
    expect(promptInput.researchContext?.policy).toMatchObject({
      brandConstraints: ["Use precise operational language."],
      complianceConstraints: ["Do not promise guaranteed time savings."],
      prohibitedTerms: ["best-in-class"],
    });

    // The model call is recorded under the shadow pipeline's own closed task.
    const invocations = await handle.pool.query(
      "SELECT task FROM app.analysis_invocations WHERE async_run_id = $1",
      [fixture.asyncRunId],
    );
    expect(invocations.rows).toEqual([{ task: "content_shadow_draft" }]);

    const gates = await new FlowShadowQaGatesRepository(handle.db).findByRun(
      fixture.scope,
      fixture.flowShadowRunId,
    );
    expect(gates).toHaveLength(1);
    // Task 4 records an honest needs_review skeleton, never a fake pass.
    expect(gates[0]).toMatchObject({
      verdict: "needs_review",
      evaluated_revision: 1,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "completed",
      result_type: "flow_shadow_run",
      result_id: fixture.flowShadowRunId,
    });

    // Red line B/D: no second confirmation object and no publish state.
    const actionRows = await handle.pool.query(
      "SELECT id FROM app.actions WHERE project_id = $1",
      [fixture.scope.projectId],
    );
    expect(actionRows.rows).toHaveLength(1);
    const findingRow = await new FindingsRepository(handle.db).findById(
      fixture.scope,
      fixture.findingId,
    );
    expect(findingRow?.review_state).toBe("confirmed");
    expect(draft!.status).not.toBe("ready");
  });

  it("converges instead of duplicating when a crashed attempt is re-delivered", async () => {
    const fixture = await seedShadowChain(handle);
    const payload = {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    };

    // First attempt crashes after RESEARCH, inside the model call. A transient
    // failure returns the canonical run to `queued` for the queue retry.
    const succeeding = generateArtifact.getMockImplementation();
    generateArtifact.mockRejectedValueOnce(
      new LLMError("RATE_LIMITED", "rate limited"),
    );
    await expect(runContentShadow(ctx, payload)).rejects.toThrow(LLMError);

    const afterCrash = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(afterCrash?.status).toBe("queued");
    void succeeding;

    // The retry re-runs every step; each child insert converges (decision D2).
    await runContentShadow(ctx, payload);

    const packs = await handle.pool.query(
      "SELECT count(*)::int AS count FROM app.flow_shadow_research_packs WHERE flow_shadow_run_id = $1",
      [fixture.flowShadowRunId],
    );
    expect(packs.rows[0].count).toBe(1);
    expect(retrievePublicWebResearch).toHaveBeenCalledTimes(1);

    const gates = await new FlowShadowQaGatesRepository(handle.db).findByRun(
      fixture.scope,
      fixture.flowShadowRunId,
    );
    expect(gates).toHaveLength(1);

    const drafts = await handle.pool.query(
      "SELECT count(*)::int AS count, max(current_revision)::int AS revision FROM app.execution_artifacts WHERE action_id = $1 AND artifact_type = 'english_blog_draft'",
      [fixture.actionId],
    );
    expect(drafts.rows[0].count).toBe(1);
    expect(drafts.rows[0].revision).toBe(1);

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run?.status).toBe("completed");
  });

  it("fails with input drift when the frozen first-party snapshot set changes", async () => {
    const fixture = await seedShadowChain(handle);
    const addedUrl = firstPartyPageUrl(fixture.scope.projectId, 99);
    const addedProjection = firstPartyProjection(
      fixture.scope.projectId,
      99,
    );
    const addedExtract = {
      schemaVersion: CRAWL_PAGE_EXTRACT_SCHEMA_VERSION,
      subjectUrl: addedUrl,
      depth: 0,
      projection: addedProjection,
    } as const;
    const addedSitePage = await new SitePagesRepository(
      handle.db,
    ).upsertNormalizedUrl({
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      siteId: fixture.siteId,
      normalizedUrl: addedUrl,
      templateKey: "checklist",
    });
    await new PageSnapshotsRepository(handle.db).create({
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      sitePageId: addedSitePage.id,
      dataSnapshotId: fixture.crawlSnapshotId,
      contentHash: contentHash(addedExtract as unknown as CanonicalValue),
      extract: addedExtract,
      capturedAt: fixture.crawlCapturedAt,
    });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "CONTENT_SHADOW_INPUT_DRIFT",
    });
    expect(retrievePublicWebResearch).not.toHaveBeenCalled();
  });

  /**
   * The one failure this pipeline defines its own error code for must survive
   * to the run record.
   *
   * `FLOW_SHADOW_QA_GATE_REPLAY_CONFLICT` means the same frozen run was judged
   * differently on re-delivery — an input that must be immutable moved, or the
   * gate is not the pure function red line C claims. `permanentFailureCode`
   * recognised only `ContentShadowPermanentError` and `LLMError`, so it landed
   * as `UNAVAILABLE`: the same code a dead database gets, with the field naming
   * WHICH half diverged thrown away. Recording it is the whole point of having
   * defined it.
   *
   * The divergence itself cannot be staged through SQL — gate rows carry an
   * append-only trigger — so the repository is made to report it, using the real
   * error type rather than a stand-in.
   */
  it("records a gate replay divergence under its own code, with the field that diverged", async () => {
    const fixture = await seedShadowChain(handle);
    const insert = vi
      .spyOn(FlowShadowQaGatesRepository.prototype, "insert")
      .mockRejectedValueOnce(new FlowShadowQaGateReplayConflictError("claims"));

    try {
      await runContentShadow(ctx, {
        runId: fixture.asyncRunId,
        workspaceId: fixture.scope.workspaceId,
        projectId: fixture.scope.projectId,
      });
    } finally {
      insert.mockRestore();
    }

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "FLOW_SHADOW_QA_GATE_REPLAY_CONFLICT",
    });
    // Not "content shadow run failed": the summary names which half diverged,
    // which is the difference between "something broke" and "the verdict and
    // the claims disagree with what we already stored".
    expect(run?.last_error_summary).toContain("claims");
  });

  it("fails with input drift when the source Finding moves past its frozen diagnosis", async () => {
    const fixture = await seedShadowChain(handle);
    // A later diagnosis re-observes the Finding, so it no longer belongs to the
    // diagnosis the Action (and this shadow run) froze.
    const laterRun = await seedDiagnosticRun(handle.db, fixture.base);
    await linkFindingEvidence(
      handle.db,
      fixture.base,
      fixture.findingId,
      laterRun,
    );
    await new FindingsRepository(handle.db).touchSeen(fixture.findingId, {
      ruleVersion: 1,
      severity: "high",
      confidence: "high",
      titleArgs: { cluster: "onboarding" },
      summary: "The content finding was observed again.",
      summaryLocale: "en",
      subjectRefs: ["keyword_cluster:onboarding"],
      runId: laterRun.runId,
      seenAt: new Date().toISOString(),
      regressed: false,
    });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "CONTENT_SHADOW_INPUT_DRIFT",
    });
    expect(generateArtifact).not.toHaveBeenCalled();
    const packs = await handle.pool.query(
      "SELECT count(*)::int AS count FROM app.flow_shadow_research_packs WHERE flow_shadow_run_id = $1",
      [fixture.flowShadowRunId],
    );
    expect(packs.rows[0].count).toBe(0);
  });

  it("fails with input drift when the pinned Flow adapter advances past the frozen run", async () => {
    // The run was frozen under an older adapter; the worker recomputes the
    // tuple with the currently pinned version, so the hash can no longer agree.
    const fixture = await seedShadowChain(handle, {
      flowAdapterVersion: "content-shadow-adapter.0.2.0",
    });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "CONTENT_SHADOW_INPUT_DRIFT",
    });
    expect(generateArtifact).not.toHaveBeenCalled();
    const packs = await handle.pool.query(
      "SELECT count(*)::int AS count FROM app.flow_shadow_research_packs WHERE flow_shadow_run_id = $1",
      [fixture.flowShadowRunId],
    );
    expect(packs.rows[0].count).toBe(0);
  });

  it("fails with input drift when the pinned projection version advances past the frozen run", async () => {
    // The run was frozen and enqueued under the previous projection version.
    // The replay guard must rebuild the tuple from the CURRENTLY pinned
    // constant, so an already queued run can never be silently re-rendered by
    // the newer projection.
    const fixture = await seedShadowChain(handle, {
      projectionVersion: "content-shadow.0.2.0",
    });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "CONTENT_SHADOW_INPUT_DRIFT",
    });
    expect(generateArtifact).not.toHaveBeenCalled();
    const packs = await handle.pool.query(
      "SELECT count(*)::int AS count FROM app.flow_shadow_research_packs WHERE flow_shadow_run_id = $1",
      [fixture.flowShadowRunId],
    );
    expect(packs.rows[0].count).toBe(0);
  });

  it("hands back the claimed draft artifact when the run fails permanently", async () => {
    const fixture = await seedShadowChain(handle);
    generateArtifact.mockRejectedValueOnce(
      new LLMError("SAFETY_VIOLATION", "refused"),
    );

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "SAFETY_VIOLATION",
    });

    // A terminal run must not leave an artifact generating forever: nothing is
    // left to finish it, and the read side would report a `generating` draft
    // under a failed run with no live generation Run at all.
    const draft = await new ExecutionArtifactsRepository(
      handle.db,
    ).findLiveByActionType(
      fixture.scope,
      fixture.actionId,
      "english_blog_draft",
    );
    expect(draft).toMatchObject({
      status: "failed",
      latest_generation_run_id: fixture.asyncRunId,
    });
  });

  it("hands back the claimed draft artifact when queue recovery terminalizes the run", async () => {
    const fixture = await seedShadowChain(handle);
    const artifacts = new ExecutionArtifactsRepository(handle.db);
    const recoveryNow = new Date("2026-07-28T21:00:00.000Z");
    const staleStartedAt = new Date("2026-07-28T20:59:59.999Z");
    // The worker claimed the draft and then the process died: no queue job
    // survives, so the recovery sweep — not the runner — owns the compensation.
    const claimed = await artifacts.insert({
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      actionId: fixture.actionId,
      artifactType: "english_blog_draft",
      generationMode: "structured_llm",
      outputLocale: "en",
      latestGenerationRunId: fixture.asyncRunId,
      createdBy: fixture.actorId,
    });
    expect(claimed.status).toBe("generating");
    await handle.pool.query(
      "UPDATE app.async_runs SET status = 'running', started_at = $1, attempt_count = 1 WHERE id = $2",
      [staleStartedAt, fixture.asyncRunId],
    );

    await reconcileActiveRuns(
      { ...ctx, boss: RECOVERY_BOSS as unknown as WorkerContext["boss"] },
      {
        scope: fixture.scope,
        now: recoveryNow,
        missingAfterMs: 0,
      },
    );

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "QUEUE_JOB_MISSING",
    });
    expect(await artifacts.findById(fixture.scope, claimed.id)).toMatchObject({
      status: "failed",
    });
  });

  it("carries the brief outline into the prompt and the persisted research pack", async () => {
    const fixture = await seedShadowChain(handle);

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    // The draft prompt is a FUNCTION of the confirmed brief, not a sibling of
    // it: this is the Task 4b defect closed end to end.
    const promptInput = generateArtifact.mock.calls[0]?.[0] as {
      readonly contentBriefOutline: {
        readonly briefSections: readonly string[];
        readonly targetKeywords: readonly string[];
        readonly pageAssignment: string;
      } | null;
    };
    expect(promptInput.contentBriefOutline).toEqual({
      briefSections: ["Objective", "Audience", "Outline"],
      targetKeywords: ["onboarding checklist"],
      pageAssignment: "new_asset",
    });

    const pack = await new FlowShadowResearchPacksRepository(
      handle.db,
    ).findByRun(fixture.scope, fixture.flowShadowRunId);
    expect(pack?.pack["briefOutline"]).toEqual({
      briefSections: ["Objective", "Audience", "Outline"],
      targetKeywords: ["onboarding checklist"],
      pageAssignment: "new_asset",
    });
    expect(
      (generateArtifact.mock.calls[0]?.[0] as {
        readonly researchContext: { readonly sources: readonly unknown[] } | null;
      }).researchContext?.sources,
    ).toHaveLength(2);
  });

  it("prioritizes usable external research sources when the pack has more than eight first-party pages", async () => {
    const fixture = await seedShadowChain(handle, { firstPartyPageCount: 10 });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const promptInput = generateArtifact.mock.calls.at(-1)?.[0] as {
      readonly researchContext: {
        readonly sources: ReadonlyArray<Record<string, unknown>>;
      } | null;
    };
    const kinds = promptInput.researchContext?.sources.map(
      (source) => source["kind"],
    );
    expect(promptInput.researchContext?.sources).toHaveLength(8);
    expect(kinds?.[0]).toBe("external_page");
    expect(kinds).toContain("external_page");
  });

  it("persists an unavailable external research snapshot deterministically", async () => {
    retrievePublicWebResearch.mockResolvedValueOnce({
      adapterVersion: "public_web_research.v1",
      sources: [
        {
          requestedUrl: EXTERNAL_RESEARCH_URL,
          finalUrl: null,
          urlHash: null,
          contentHash: null,
          capturedAt: "2026-07-27T08:09:10.000Z",
          title: null,
          excerpt: null,
          contentText: null,
          status: null,
          contentType: null,
          bodyBytes: 0,
          wordCount: 0,
          contentTruncated: false,
          excerptTruncated: false,
          responseMs: 15,
          redirectChain: [],
          availability: "unavailable",
          limitation: "Public-web research rejected the target.",
        },
      ],
      availability: "unavailable",
      limitation: "Public-web research rejected the target.",
      stopReason: null,
      usage: {
        targetCount: 1,
        attemptedTargets: 1,
        availableTargets: 0,
        partialTargets: 0,
        unavailableTargets: 1,
        bodyBytes: 0,
        redirectsFollowed: 0,
        elapsedMs: 15,
      },
    });
    const fixture = await seedShadowChain(handle);

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const pack = await new FlowShadowResearchPacksRepository(
      handle.db,
    ).findByRun(fixture.scope, fixture.flowShadowRunId);
    const unavailable = (
      pack?.pack["sources"] as ReadonlyArray<Record<string, unknown>>
    ).find((source) => source["kind"] === "external_page");
    expect(unavailable).toMatchObject({
      availability: "unavailable",
      limitation: "Public-web research rejected the target.",
    });
  });

  it("degrades loudly when the pinned brief has no machine-readable outline", async () => {
    const fixture = await seedShadowChain(handle, {
      briefMarkdown: "# Content brief revision 1",
    });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    // Decision O-4: the research pack states it, the QA verdict is not a pass,
    // and the run still completes rather than punishing the operator.
    const pack = await new FlowShadowResearchPacksRepository(
      handle.db,
    ).findByRun(fixture.scope, fixture.flowShadowRunId);
    expect(JSON.stringify(pack?.pack["limitations"])).toMatch(
      /outline extraction FAILED/,
    );
    const gates = await new FlowShadowQaGatesRepository(handle.db).findByRun(
      fixture.scope,
      fixture.flowShadowRunId,
    );
    expect(gates[0]?.verdict).not.toBe("passed");
    expect(
      (gates[0]?.claims as ReadonlyArray<Record<string, unknown>>).some(
        (claim) =>
          claim["claimId"] === "content-shadow.qa.brief-outline" &&
          claim["status"] === "failed",
      ),
    ).toBe(true);
  });

  /**
   * `blocked` is a judgement about the CONTENT, not about the run. The draft
   * revision is the evidence a reviewer needs in order to judge the block, so it
   * is still minted; the run still completes, because re-running a deterministic
   * gate only ever reproduces the same verdict; and nothing is marked ready,
   * published or exported.
   */
  it("blocks a fabricated citation without failing the run or publishing anything", async () => {
    const fixture = await seedShadowChain(handle);
    generateArtifact.mockResolvedValue({
      content: {
        contentFormat: "markdown",
        content:
          "# Onboarding checklist\n\n## Why it matters\n\nAccording to the 2024 Forrester Digital Experience Report, teams cut onboarding time by 40%.\n",
      },
      invocation: {
        task: "artifact_generation",
        provider: "openai",
        model: "gpt-4o-mini",
        promptSetVersion: PROMPT_SET_VERSION,
        inputHash: contentHash({ prompt: "fixture" }),
        outputHash: contentHash({ output: "blocked" }),
        status: "succeeded",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: null,
        latencyMs: 5,
        errorCode: null,
      },
    });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const gates = await new FlowShadowQaGatesRepository(handle.db).findByRun(
      fixture.scope,
      fixture.flowShadowRunId,
    );
    expect(gates).toHaveLength(1);
    expect(gates[0]?.verdict).toBe("blocked");
    expect(
      (gates[0]?.claims as ReadonlyArray<Record<string, unknown>>).some(
        (claim) =>
          claim["claimId"] === "content-shadow.qa.rl8_unsupported_claim" &&
          claim["status"] === "failed",
      ),
    ).toBe(true);

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run?.status).toBe("completed");

    const draft = await new ExecutionArtifactsRepository(
      handle.db,
    ).findLiveByActionType(
      fixture.scope,
      fixture.actionId,
      "english_blog_draft",
    );
    expect(draft).toMatchObject({ status: "draft", current_revision: 1 });

    const exports = await handle.pool.query(
      "SELECT id FROM app.export_bundles WHERE project_id = $1",
      [fixture.scope.projectId],
    );
    expect(exports.rows).toHaveLength(0);
  });

  /**
   * `jsonb` REJECTS an unpaired surrogate. The excerpt truncation sliced UTF-16
   * code units, so a draft whose emoji happened to straddle the excerpt bound
   * produced a claim detail containing a lone `\ud83d`, and this insert threw —
   * killing a run whose verdict had been computed correctly. Only a real
   * Postgres write proves the fix, because a pure-function assertion cannot see
   * what the column will accept.
   */
  it("stores a claim whose excerpt is cut mid-emoji", async () => {
    const fixture = await seedShadowChain(handle);
    const entry = `${"Forrester Digital Experience Report on onboarding activation ".padEnd(118, "x")}\u{1F680} trailing text after the cut`;
    generateArtifact.mockResolvedValue({
      content: {
        contentFormat: "markdown",
        content: `# Onboarding checklist\n\n## Why it matters\n\n**Activation** is the first milestone.\n\n## Sources\n\n- ${entry}\n`,
      },
      invocation: {
        task: "artifact_generation",
        provider: "openai",
        model: "gpt-4o-mini",
        promptSetVersion: PROMPT_SET_VERSION,
        inputHash: contentHash({ prompt: "fixture" }),
        outputHash: contentHash({ output: "emoji" }),
        status: "succeeded",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: null,
        latencyMs: 5,
        errorCode: null,
      },
    });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run?.status).toBe("completed");

    const gates = await new FlowShadowQaGatesRepository(handle.db).findByRun(
      fixture.scope,
      fixture.flowShadowRunId,
    );
    expect(gates).toHaveLength(1);
    expect(gates[0]?.verdict).toBe("blocked");
    const serialized = JSON.stringify(gates[0]?.claims);
    for (const unit of serialized) {
      const code = unit.codePointAt(0) ?? 0;
      expect(code < 0xd800 || code > 0xdfff).toBe(true);
    }
  });

  it("fails with input drift when a frozen keyword's mapping decision moves", async () => {
    const fixture = await seedShadowChain(handle);
    await handle.pool.query(
      `UPDATE app.keyword_entities
       SET mapping_decision = 'unassigned',
           mapped_site_page_id = NULL,
           mapping_revision = mapping_revision + 1,
           updated_at = updated_at + interval '1 second'
       WHERE id = $1`,
      [fixture.keywordId],
    );

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "CONTENT_SHADOW_INPUT_DRIFT",
    });
    expect(generateArtifact).not.toHaveBeenCalled();
    const packs = await handle.pool.query(
      "SELECT count(*)::int AS count FROM app.flow_shadow_research_packs WHERE flow_shadow_run_id = $1",
      [fixture.flowShadowRunId],
    );
    expect(packs.rows[0].count).toBe(0);
  });

  it("fails with input drift when a frozen keyword leaves the frozen cluster", async () => {
    const fixture = await seedShadowChain(handle);
    await handle.pool.query(
      `UPDATE app.keyword_entities
       SET cluster_key = 'other-cluster',
           mapping_revision = mapping_revision + 1,
           updated_at = updated_at + interval '1 second'
       WHERE id = $1`,
      [fixture.keywordId],
    );

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "CONTENT_SHADOW_INPUT_DRIFT",
    });
    expect(generateArtifact).not.toHaveBeenCalled();
  });

  /**
   * Red line C for the first-party identity (Task 6b). `sites.origin` is a
   * MUTABLE row and the QA gate now resolves the draft's links against it, so an
   * origin that moves inside the accept -> claim window must fail the run rather
   * than judge the draft against an identity its content address never named.
   */
  it("fails with input drift when the frozen site origin moves", async () => {
    const fixture = await seedShadowChain(handle);
    await handle.pool.query(
      "UPDATE app.sites SET origin = 'https://rebranded.example.test', host = 'rebranded.example.test' WHERE id = $1",
      [fixture.siteId],
    );

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "CONTENT_SHADOW_INPUT_DRIFT",
    });
    expect(generateArtifact).not.toHaveBeenCalled();
  });

  it("projects the frozen first-party identity into the persisted research pack", async () => {
    const fixture = await seedShadowChain(handle);

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const pack = await handle.pool.query(
      "SELECT pack FROM app.flow_shadow_research_packs WHERE flow_shadow_run_id = $1",
      [fixture.flowShadowRunId],
    );
    const sources = pack.rows[0].pack.sources as readonly {
      readonly kind: string;
      readonly ref: string;
      readonly authorityTier: string;
    }[];
    const site = sources.find((source) => source.kind === "first_party_site");

    expect(site).toMatchObject({
      ref: `https://${fixture.scope.projectId}.example.test`,
      authorityTier: "A",
    });
    // The fixture ICP carries no conversion target, so the pack states its
    // absence by omitting the source rather than inventing a destination.
    expect(
      sources.some((source) => source.kind === "first_party_conversion"),
    ).toBe(false);
  });

  it("fails with input drift when the pinned Content Shadow prompt set advances", async () => {
    // Freezing under the previous prompt set and executing under the new one is
    // a DIFFERENT computation; the run fails loudly instead of silently drafting
    // from a prompt its content address never named (decision O-1/O-8).
    const fixture = await seedShadowChain(handle, {
      promptSetVersion: "mvp.prompts.0.2.0",
    });

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run).toMatchObject({
      status: "failed",
      last_error_code: "CONTENT_SHADOW_INPUT_DRIFT",
    });
  });

  it("cannot claim a run whose canonical scope does not match the delivery", async () => {
    // The claim itself is project-scoped, so a foreign-scope delivery updates
    // nothing and returns before any shadow work. The RUN_SCOPE_MISMATCH branch
    // inside the runner is unreachable-by-construction defence in depth mirrored
    // from `runArtifact`; this test pins the reachable behaviour instead of
    // pretending to cover that branch.
    const fixture = await seedShadowChain(handle);

    await runContentShadow(ctx, {
      runId: fixture.asyncRunId,
      workspaceId: fixture.scope.workspaceId,
      projectId: randomUUID(),
    });

    const run = await new AsyncRunsRepository(handle.db).findById(
      fixture.scope,
      fixture.asyncRunId,
    );
    expect(run?.status).toBe("queued");
    expect(generateArtifact).not.toHaveBeenCalled();
  });
});
