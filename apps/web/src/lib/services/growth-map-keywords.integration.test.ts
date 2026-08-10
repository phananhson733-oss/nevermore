import { randomUUID } from "node:crypto";
import { ConfirmedProductProfile } from "@sf/contracts";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import {
  AsyncRunsRepository,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  KeywordGovernanceRepository,
  KeywordGovernanceSuggestionGenerationRunsRepository,
  KeywordGovernanceSuggestionInvocationAttemptsRepository,
  KeywordOccurrencesRepository,
  KeywordReviewSuggestionsRepository,
  ProjectsRepository,
  SitePagesRepository,
  TopicModelsRepository,
  contentHash,
  createDbHandle,
  normalizeKeywordIdentity,
  toRunAttempt,
  type CanonicalValue,
  type DbHandle,
  type DbTx,
} from "@sf/db";
import { freezeKeywordGovernanceSuggestionInput } from "@sf/db/keyword-governance-suggestion-freezer";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  icpProfiles,
  normalizedObservations,
  sites,
  sourceConnections,
  workspaces,
} from "@sf/db/schema";
import {
  GOVERNANCE_PROJECTION_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import {
  CRAWL_METHOD_VERSION,
  createDataForSeoSearchLandscapeV2Scope,
} from "@sf/sources";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDiagnosticFrozenInput } from "./diagnostics.ts";
import {
  getProjectAuditKeyword,
  getProjectAuditKeywordReviewDetail,
  listProjectAuditKeywords,
  approveProjectAuditKeywordReviewSuggestion,
  reviewProjectAuditKeyword,
} from "./growth-map-keywords.ts";
import { publishDiagnosticGeneration } from "./__tests__/published-growth-map-fixture.ts";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const CAPTURED_AT = "2026-07-22T08:00:00.000Z";

interface KeywordFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly keywordId: string;
  readonly occurrenceId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly privateRawObjectKey: string;
  readonly privateTaskId: string;
  readonly privateObservationPayload: string;
}

const CONFIRMED_PROFILE_PATHS = [
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
] as const;

function confirmedProductProfile(siteId: string) {
  return ConfirmedProductProfile.parse({
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: siteId,
    sourcePageUrl: "https://example.com/product",
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    businessHint: "B2B customer onboarding software",
    productName: "RelayOps",
    oneLiner: "Evidence-grounded customer onboarding operations",
    category: "Customer onboarding",
    productType: "B2B SaaS",
    businessModels: ["subscription"],
    valueProposition: "Help teams standardize customer onboarding.",
    coreFeatures: ["Workflow automation", "Implementation tracking"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        candidateId: randomUUID(),
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize customer onboarding"],
        triggers: ["Onboarding volume increased"],
        pains: ["Manual handoffs"],
        jtbd: ["Reduce time to value"],
        outcomes: ["A repeatable onboarding process"],
        barriers: ["Fragmented tooling"],
        qualificationSignals: ["Owns onboarding operations"],
        disqualifiers: ["No onboarding workflow"],
      },
    ],
    competitorCandidates: [],
    fieldProvenance: CONFIRMED_PROFILE_PATHS.map((path) => ({
      path,
      derivation: "declared",
      confidence: "medium",
      evidenceRefs: [{ evidenceRefId: randomUUID(), kind: "userEdit" }],
      limitation: "Declared disposable Web integration authority.",
      observedAt: null,
    })),
    missingFields: ["/competitorCandidates"],
    conflictingFields: [],
  });
}

async function inRolledBackFixture(
  handle: DbHandle,
  test: (tx: DbTx) => Promise<void>,
): Promise<void> {
  const rollback = new Error(`rollback-keyword-fixture-${randomUUID()}`);
  try {
    await handle.db.transaction(async (tx) => {
      await test(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function seedDataForSeoKeyword(
  tx: DbTx,
  input: {
    readonly workspaceId: string;
    readonly label: string;
    readonly displayKeyword: string;
  },
): Promise<KeywordFixture> {
  const actorId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const sourceConnectionId = randomUUID();
  const crawlSourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const observationId = randomUUID();
  const normalizedKeyword = normalizeKeywordIdentity(input.displayKeyword);
  const target = `${input.label.toLowerCase()}-${projectId}.example.com`;
  const privateTaskId = `private-task-${randomUUID()}`;
  const privateObservationPayload = `private-observation-${randomUUID()}`;
  const privateRawObjectKey = `private/dataforseo/${randomUUID()}.json`;
  const collectionScope = createDataForSeoSearchLandscapeV2Scope({
    target,
    marketCode: "US",
    languageTag: "en-US",
    locationCode: 2840,
    rankedKeywordsLimit: 200,
    competitorsDomainLimit: 100,
    serpCompetitorsLimit: 100,
    seeds: [],
  });

  await tx.insert(clientProjects).values({
    id: projectId,
    workspace_id: input.workspaceId,
    client_name: `${input.label} client`,
    project_name: `${input.label} project`,
    default_delivery_locale: "en-US",
    created_by: actorId,
  });
  await tx.insert(sites).values({
    id: siteId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    origin: `https://${target}`,
    host: target,
    market_codes: ["US"],
    language_codes: ["en-US"],
    is_primary: true,
  });
  const profile = confirmedProductProfile(siteId);
  const [icp] = await tx
    .insert(icpProfiles)
    .values({
      workspace_id: input.workspaceId,
      project_id: projectId,
      version: 1,
      status: "complete",
      profile,
      content_hash: contentHash(
        { status: "complete", profile } as unknown as CanonicalValue,
      ),
      created_by: actorId,
    })
    .returning();
  const projects = new ProjectsRepository(tx);
  if (
    !(await projects.setCurrentIcpProfile(
      { workspaceId: input.workspaceId },
      projectId,
      icp!.id,
    )) ||
    !(await projects.setConfirmedIcpProfile(
      { workspaceId: input.workspaceId },
      projectId,
      icp!.id,
    ))
  ) {
    throw new Error("Keyword fixture could not confirm its Product Profile");
  }
  await tx.insert(sourceConnections).values({
    id: sourceConnectionId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    provider: "dataforseo",
    connection_type: "api_key_stub",
    state: "available",
    external_ref: target,
    limitation: "Disposable canonical DataForSEO integration fixture.",
    connected_at: CAPTURED_AT,
    created_by: actorId,
  });
  await tx.insert(sourceConnections).values({
    id: crawlSourceConnectionId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    provider: "crawl",
    connection_type: "public",
    state: "available",
    external_ref: `https://${target}`,
    limitation: "Deterministic public Crawl integration fixture.",
    connected_at: CAPTURED_AT,
    created_by: actorId,
  });
  await tx.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    kind: "collection",
    status: "completed",
    result_type: "collection_run",
    result_id: collectionRunId,
    initiated_by: actorId,
    started_at: CAPTURED_AT,
    completed_at: CAPTURED_AT,
  });
  await tx.insert(collectionRuns).values({
    id: collectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    source_connection_id: sourceConnectionId,
    provider: "dataforseo",
    operation: "search_landscape",
    method_version: "dataforseo.search_landscape.v2",
    parameters_hash: contentHash({
      projectId,
      collectionScope: collectionScope as unknown as CanonicalValue,
    }),
  });
  const dataForSeoSnapshot = await new DataSnapshotsRepository(tx).insert({
    workspaceId: input.workspaceId,
    projectId,
    siteId,
    collectionRunId,
    sourceConnectionId,
    provider: "dataforseo",
    datasetKey: "dataforseo.search_landscape.v2",
    schemaVersion: "dataforseo.search_landscape.v2",
    methodVersion: "dataforseo.search_landscape.v2",
    capturedAt: CAPTURED_AT,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Rows are bounded by the frozen provider collection scope.",
    rawObjectKey: privateRawObjectKey,
    rowCount: 1,
    checksum: contentHash({ collectionRunId, observationId }),
    summary: {
      collectionScope,
      timing: {
        collectedAt: CAPTURED_AT,
        dataAsOf: null,
        observedAt: null,
        freshness: "unknown",
      },
      privateRawTaskId: privateTaskId,
    },
  });
  await tx.insert(normalizedObservations).values({
    id: observationId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    snapshot_id: dataForSeoSnapshot.id,
    site_page_id: null,
    provider: "dataforseo",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: normalizedKeyword.replaceAll(" ", "-"),
    observed_at: CAPTURED_AT,
    availability: "available",
    value_json: {
      keyword: input.displayKeyword,
      clusterKey: normalizedKeyword.replaceAll(" ", "-"),
      searchVolume: 0,
      keywordDifficulty: 0,
      providerSearchIntent: "commercial",
      currentRank: 12.5,
      currentUrl: `https://${target}/customer-onboarding/`,
      competitorDomain: "confirmed-competitor.example",
      competitorRank: 3,
      marketCode: "US",
      languageCode: "en",
      privateProviderPayload: privateObservationPayload,
    },
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "context",
    limitation: "Rows are bounded by the frozen provider collection scope.",
  });

  const created = await new KeywordOccurrencesRepository(tx).upsertIntoLibrary(
    { workspaceId: input.workspaceId, projectId },
    {
      manualEntryId: null,
      dataSnapshotId: dataForSeoSnapshot.id,
      normalizedObservationId: observationId,
      displayKeyword: input.displayKeyword,
      normalizedKeyword,
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "dataforseo_ranked",
      scopeBasis: "provider_collection_scope",
      sourcePointer: "/valueJson/keyword",
      sourceRef: `observation:${observationId}#/valueJson/keyword`,
      collectedAt: CAPTURED_AT,
      providerDataAsOf: null,
    },
  );

  const crawlCollectionRunId = randomUUID();
  await tx.insert(asyncRuns).values({
    id: crawlCollectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    kind: "collection",
    status: "completed",
    result_type: "collection_run",
    result_id: crawlCollectionRunId,
    initiated_by: actorId,
    started_at: CAPTURED_AT,
    completed_at: CAPTURED_AT,
  });
  await tx.insert(collectionRuns).values({
    id: crawlCollectionRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    site_id: siteId,
    source_connection_id: crawlSourceConnectionId,
    provider: "crawl",
    operation: "site_graph",
    method_version: CRAWL_METHOD_VERSION,
    parameters_hash: contentHash({ projectId, crawlCollectionRunId }),
  });
  const crawlSnapshot = await new DataSnapshotsRepository(tx).insert({
    workspaceId: input.workspaceId,
    projectId,
    siteId,
    collectionRunId: crawlCollectionRunId,
    sourceConnectionId: crawlSourceConnectionId,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.3.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt: CAPTURED_AT,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Deterministic public Crawl integration fixture.",
    rawObjectKey: null,
    rowCount: 0,
    checksum: contentHash({ projectId, crawlCollectionRunId, rows: 0 }),
  });

  const frozen = buildDiagnosticFrozenInput({
    projectId,
    siteId,
    icp: {
      id: icp!.id,
      version: icp!.version,
      contentHash: icp!.content_hash,
      profile: icp!.profile,
    },
    siteLanguageCodes: ["en-US"],
    snapshots: [crawlSnapshot, dataForSeoSnapshot],
    deliveryLocale: "en-US",
    governance: {
      projectionVersion: GOVERNANCE_PROJECTION_VERSION,
      keywordClusters: [
        {
          clusterKey: normalizedKeyword,
          keywords: [
            {
              keywordEntityId: created.entityId,
              displayKeyword: input.displayKeyword,
              normalizedKeyword,
              marketCode: "US",
              languageTag: "en-US",
              revision: 0,
              status: "candidate",
              queryKind: "search_query",
              intent: null,
              buyerStage: null,
              clusterKey: null,
              mappingDecision: "unassigned",
              mappedSitePageId: null,
              mappingReviewState: "unreviewed",
              lastSeenAt: CAPTURED_AT,
              occurrenceRefs: [
                {
                  occurrenceId: created.occurrenceId,
                  snapshotId: dataForSeoSnapshot.id,
                  observationId,
                },
              ],
              metricRefs: [],
            },
          ],
        },
      ],
      competitors: [],
    },
  });
  const diagnosticRunId = randomUUID();
  await tx.insert(asyncRuns).values({
    id: diagnosticRunId,
    workspace_id: input.workspaceId,
    project_id: projectId,
    kind: "diagnostic",
    status: "completed",
    result_type: "diagnostic_run",
    result_id: diagnosticRunId,
    initiated_by: actorId,
    started_at: CAPTURED_AT,
    completed_at: CAPTURED_AT,
  });
  await new DiagnosticRunsRepository(tx).insert({
    runId: diagnosticRunId,
    workspaceId: input.workspaceId,
    projectId,
    siteId,
    icpProfileId: icp!.id,
    icpProfileVersion: icp!.version,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: "en-US",
    inputManifest: frozen.manifest,
    inputHash: frozen.inputHash,
  });
  await publishDiagnosticGeneration(tx, {
    scope: { workspaceId: input.workspaceId, projectId },
    diagnosticRunId,
    actorId,
    completedAt: CAPTURED_AT,
  });

  return {
    actorId,
    workspaceId: input.workspaceId,
    projectId,
    siteId,
    keywordId: created.entityId,
    occurrenceId: created.occurrenceId,
    snapshotId: dataForSeoSnapshot.id,
    observationId,
    displayKeyword: input.displayKeyword,
    normalizedKeyword,
    privateRawObjectKey,
    privateTaskId,
    privateObservationPayload,
  };
}

async function createConfirmedTopic(
  tx: DbTx,
  fixture: KeywordFixture,
): Promise<{
  readonly topicNodeId: string;
  readonly topicModelRevision: number;
}> {
  const scope = {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
  };
  const topics = new TopicModelsRepository(tx);
  const draft = await topics.beginDraftFromLatestConfirmed(
    scope,
    fixture.actorId,
    {
      expectedLatestConfirmedRevision: 0,
      reason: "Create the reviewed Topic for the Web service fixture.",
    },
  );
  const edited = await topics.patchDraft(scope, fixture.actorId, {
    topicModelRevision: draft.topicModelRevision,
    expectedEditRevision: draft.editRevision,
    reason: "Add the canonical Keyword governance Topic.",
    intents: [
      {
        kind: "create",
        parentTopicNodeId: null,
        label: "Customer Onboarding",
        description: "Confirmed Topic for Web service integration.",
        intentEnvelope: ["commercial"],
      },
    ],
  });
  const confirmed = await topics.confirmDraft(scope, fixture.actorId, {
    topicModelRevision: edited.topicModelRevision,
    expectedEditRevision: edited.editRevision,
    reason: "Confirm the Topic before reviewing the Keyword.",
  });
  if (confirmed.rootTopicNodeId === null) {
    throw new Error("Web service fixture did not produce a Topic root");
  }
  return {
    topicNodeId: confirmed.rootTopicNodeId,
    topicModelRevision: confirmed.topicModelRevision,
  };
}

async function createPendingSuggestion(
  tx: DbTx,
  fixture: KeywordFixture,
  topic: {
    readonly topicNodeId: string;
    readonly topicModelRevision: number;
  },
) {
  const scope = {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
  };
  const generationRuns =
    new KeywordGovernanceSuggestionGenerationRunsRepository(tx);
  const authority = await generationRuns.readPrimaryFreezeAuthority(scope);
  if (authority.kind !== "ready") {
    throw new Error("Web approval fixture has no current freeze authority");
  }
  const frozen = freezeKeywordGovernanceSuggestionInput(authority.authority);
  const candidate = frozen.manifest.candidates.find(
    (item) => item.keywordId === fixture.keywordId,
  );
  if (candidate === undefined || frozen.manifest.candidates.length !== 1) {
    throw new Error("Web approval fixture did not freeze exactly one Keyword");
  }

  const runId = randomUUID();
  const asyncRunRepository = new AsyncRunsRepository(tx);
  await asyncRunRepository.insertQueued({
    runId,
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    kind: "keyword_governance_suggestion_generation",
    activeKey: `web-keyword-suggestion:${runId}`,
    initiatedBy: fixture.actorId,
    contractVersion: "2026-08-10",
    resultType: "keyword_governance_suggestion_generation_run",
    resultId: runId,
  });
  await generationRuns.insertPlaceholder({
    runId,
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    inputManifest: frozen.manifest,
    inputHash: frozen.inputHash,
  });
  const claimed = await asyncRunRepository.claim(scope, runId);
  if (claimed === null) {
    throw new Error("Web approval fixture could not claim its generation run");
  }
  const attempt = toRunAttempt(claimed);
  const outputHash = contentHash({ runId, output: "approved suggestion" });
  const promptInputHash = contentHash({ runId, prompt: "bounded fixture" });
  const invocationAttempts =
    new KeywordGovernanceSuggestionInvocationAttemptsRepository(tx);
  const preflight = {
    provider: "openai",
    model: "gpt-5-mini",
    promptSetVersion: "keyword-governance-suggestion.prompt.v1",
    inputHash: promptInputHash,
  } as const;
  const reserved = await invocationAttempts.reserve(attempt, preflight);
  if (reserved.kind !== "reserved") {
    throw new Error("Web approval fixture could not reserve its invocation");
  }
  const finalized = await invocationAttempts.finalizeWithInvocation(
    attempt,
    reserved.reservation.id,
    {
      ...preflight,
      outputHash,
      status: "succeeded",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
      latencyMs: 25,
      errorCode: null,
    },
  );
  if (finalized.kind !== "finalized") {
    throw new Error("Web approval fixture could not finalize its invocation");
  }

  const providerIntent =
    candidate.deterministicEvidence.providerSearchIntent;
  const inserted = await new KeywordReviewSuggestionsRepository(tx).insertBatch(
    scope,
    {
      generationRunId: runId,
      inputHash: frozen.inputHash,
      outputHash,
      analysisInvocationId: finalized.invocationId,
      suggestions: [
        {
          suggestionId: randomUUID(),
          ordinal: candidate.ordinal,
          keywordId: candidate.keywordId,
          expectedGovernanceRevision:
            candidate.expectedGovernanceRevision,
          suggestionVersion: "keyword-governance-suggestion.v1",
          status: "approved",
          intent: providerIntent?.value ?? "commercial",
          buyerStage: "consideration",
          topicNodeId: topic.topicNodeId,
          topicModelRevision: topic.topicModelRevision,
          mappingDecision: "new_asset",
          mappedSitePageId: null,
          reason:
            "Confirmed authority supports this governed recommendation.",
          intentAuthority:
            providerIntent === null ? "llm_generated" : "provider_observed",
          intentSnapshotId: providerIntent?.snapshotId ?? null,
          intentObservationId: providerIntent?.observationId ?? null,
          intentObservedAt: providerIntent?.observedAt ?? null,
        },
      ],
    },
  );
  if (inserted.kind !== "inserted" || inserted.suggestions.length !== 1) {
    throw new Error("Web approval fixture did not persist one suggestion");
  }
  const terminal = await generationRuns.terminalize(attempt, {
    status: "completed",
    resultOutputHash: outputHash,
    lastErrorCode: null,
    lastErrorSummary: null,
  });
  if (terminal.kind !== "terminalized") {
    throw new Error("Web approval fixture did not complete its generation run");
  }
  return inserted.suggestions[0]!;
}

describeDb("Growth Map Keyword Library real Postgres projection", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("returns exact DataForSEO lineage and observed zeros without leaking foreign or private raw data", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        plan_tier: "internal",
        id: workspaceId,
        name: `Keyword read integration ${workspaceId}`,
      });
      const local = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "Local",
        displayKeyword: "Customer Onboarding Software",
      });
      const foreign = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "Foreign",
        displayKeyword: "Foreign Only Keyword",
      });
      const scope = { workspaceId };

      const list = await listProjectAuditKeywords(
        scope,
        local.projectId,
        {
          limit: 50,
          cursor: null,
          now: new Date("2026-07-22T09:00:00.000Z"),
        },
        tx,
      );
      expect(list.projectId).toBe(local.projectId);
      expect(list.data).toHaveLength(1);
      const item = list.data[0]!;
      expect(item).toMatchObject({
        projectId: local.projectId,
        keywordId: local.keywordId,
        displayKeyword: local.displayKeyword,
        normalizedKeyword: local.normalizedKeyword,
        marketCode: "US",
        languageTag: "en-US",
        queryKind: "search_query",
        // Read at the EXACT frozen revision: ingestion wrote the r0 baseline
        // decision, and no human has touched this keyword.
        reviewOrigin: "system_suggestion",
        searchIntent: {
          value: "commercial",
          authority: "provider_observed",
          snapshotId: local.snapshotId,
          observationId: local.observationId,
          analysisInvocationId: null,
          observedAt: CAPTURED_AT,
          limitation: expect.any(String),
        },
        sourceOccurrences: [
          {
            occurrenceId: local.occurrenceId,
            sourceKind: "dataforseo_ranked",
            snapshotId: local.snapshotId,
            sourceObservationId: local.observationId,
            sourcePointer: "/valueJson/keyword",
            collectedAt: CAPTURED_AT,
            providerDataAsOf: null,
            freshness: "unknown",
            limitation: expect.stringMatching(/bounded.*collection scope/i),
            scopeBasis: "provider_collection_scope",
            scopeLimitation: expect.stringMatching(
              /market US.*language en-US.*location code 2840.*200 ranked-keyword rows/is,
            ),
            marketCode: "US",
            languageTag: "en-US",
          },
        ],
        metrics: {
          volume: {
            snapshotId: local.snapshotId,
            observationId: local.observationId,
            valuePointer: "/valueJson/searchVolume",
            value: 0,
            observedAt: CAPTURED_AT,
            freshness: "unknown",
            limitation: expect.any(String),
          },
          kd: {
            snapshotId: local.snapshotId,
            observationId: local.observationId,
            valuePointer: "/valueJson/keywordDifficulty",
            value: 0,
            observedAt: CAPTURED_AT,
            freshness: "unknown",
            limitation: expect.any(String),
          },
        },
      });

      const detail = await getProjectAuditKeyword(
        scope,
        local.projectId,
        local.keywordId,
        null,
        tx,
      );
      expect(detail).toEqual({
        projectId: local.projectId,
        diagnosticRunId: null,
        data: {
          ...item,
          mappedTarget: {
            ...item.mappedTarget,
            reason: null,
          },
          pendingSuggestion: null,
        },
      });

      const serialized = JSON.stringify({ list, detail });
      expect(serialized).not.toContain(foreign.projectId);
      expect(serialized).not.toContain(foreign.keywordId);
      expect(serialized).not.toContain(foreign.displayKeyword);
      expect(serialized).not.toContain(local.privateRawObjectKey);
      expect(serialized).not.toContain(local.privateTaskId);
      expect(serialized).not.toContain(local.privateObservationPayload);
      expect(serialized).not.toContain("privateRawTaskId");
      expect(serialized).not.toContain("privateProviderPayload");

      await expect(
        getProjectAuditKeyword(
          scope,
          local.projectId,
          foreign.keywordId,
          null,
          tx,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });

  it("keeps the manual review service path atomic while advancing a confirmed new-asset decision", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        plan_tier: "internal",
        id: workspaceId,
        name: `Keyword review integration ${workspaceId}`,
      });
      const fixture = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "Review",
        displayKeyword: "Customer Onboarding Platform",
      });
      const topic = await createConfirmedTopic(tx, fixture);

      const reviewed = await reviewProjectAuditKeyword(
        { workspaceId, actorId: fixture.actorId },
        fixture.projectId,
        fixture.keywordId,
        {
          expectedGovernanceRevision: 0,
          status: "approved",
          intent: "commercial",
          buyerStage: "consideration",
          topicNodeId: topic.topicNodeId,
          topicModelRevision: topic.topicModelRevision,
          mappingDecision: "new_asset",
          mappedSitePageId: null,
          reason:
            "Approve the generated Topic and create a dedicated content asset.",
        },
        tx,
      );
      const current = await getProjectAuditKeywordReviewDetail(
        { workspaceId },
        fixture.projectId,
        fixture.keywordId,
        tx,
      );

      expect(reviewed).toEqual(current);
      expect(reviewed).toMatchObject({
        projectId: fixture.projectId,
        diagnosticRunId: null,
        data: {
          keywordId: fixture.keywordId,
          revision: 1,
          status: "approved",
          reviewOrigin: "user",
          cluster: {
            clusterId: topic.topicNodeId,
            topicModelRevision: topic.topicModelRevision,
            name: "Customer Onboarding",
          },
          mappedTarget: {
            kind: "new_asset",
            revision: 1,
            reviewState: "approved",
          },
          pendingSuggestion: null,
        },
      });
    });
  });

  it("maps real PostgreSQL page and Topic authority failures without advancing governance", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        plan_tier: "internal",
        id: workspaceId,
        name: `Keyword page constraint integration ${workspaceId}`,
      });
      const fixture = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "PageConstraint",
        displayKeyword: "Customer Onboarding Page",
      });
      const topic = await createConfirmedTopic(tx, fixture);
      const page = await new SitePagesRepository(tx).upsertNormalizedUrl({
        workspaceId,
        projectId: fixture.projectId,
        siteId: fixture.siteId,
        normalizedUrl: `https://${fixture.projectId}.example.com/onboarding`,
        templateKey: null,
      });
      await tx.execute(sql`
        create function pg_temp.web_test_drop_keyword_page()
        returns trigger
        language plpgsql
        as $function$
        begin
          delete from app.site_pages
          where id = new.mapped_site_page_id;
          return new;
        end;
        $function$
      `);
      await tx.execute(sql`
        create trigger web_test_drop_keyword_page
        before update of mapped_site_page_id on app.keyword_entities
        for each row
        when (new.mapped_site_page_id is not null)
        execute function pg_temp.web_test_drop_keyword_page()
      `);

      await expect(
        reviewProjectAuditKeyword(
          { workspaceId, actorId: fixture.actorId },
          fixture.projectId,
          fixture.keywordId,
          {
            expectedGovernanceRevision: 0,
            status: "approved",
            intent: "commercial",
            buyerStage: "consideration",
            topicNodeId: topic.topicNodeId,
            topicModelRevision: topic.topicModelRevision,
            mappingDecision: "existing_page",
            mappedSitePageId: page.id,
            reason: "Exercise the real mapped-page foreign-key boundary.",
          },
          tx,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      await expect(
        new KeywordGovernanceRepository(tx).findCurrent(
          { workspaceId, projectId: fixture.projectId },
          fixture.keywordId,
        ),
      ).resolves.toMatchObject({
        decision: { governanceRevision: 0 },
      });
    });

    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        plan_tier: "internal",
        id: workspaceId,
        name: `Keyword Topic constraint integration ${workspaceId}`,
      });
      const fixture = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "TopicConstraint",
        displayKeyword: "Customer Onboarding Topic",
      });
      const topic = await createConfirmedTopic(tx, fixture);
      await tx.execute(sql`
        create function pg_temp.web_test_corrupt_keyword_topic()
        returns trigger
        language plpgsql
        as $function$
        begin
          new.topic_node_id := 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid;
          return new;
        end;
        $function$
      `);
      await tx.execute(sql`
        create trigger web_test_corrupt_keyword_topic
        before insert on app.keyword_review_decisions
        for each row
        when (
          new.decision_origin = 'user'
          and new.topic_node_id is not null
        )
        execute function pg_temp.web_test_corrupt_keyword_topic()
      `);

      await expect(
        reviewProjectAuditKeyword(
          { workspaceId, actorId: fixture.actorId },
          fixture.projectId,
          fixture.keywordId,
          {
            expectedGovernanceRevision: 0,
            status: "approved",
            intent: "commercial",
            buyerStage: "consideration",
            topicNodeId: topic.topicNodeId,
            topicModelRevision: topic.topicModelRevision,
            mappingDecision: "new_asset",
            mappedSitePageId: null,
            reason: "Exercise the real Topic foreign-key boundary.",
          },
          tx,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
      await expect(
        new KeywordGovernanceRepository(tx).findCurrent(
          { workspaceId, projectId: fixture.projectId },
          fixture.keywordId,
        ),
      ).resolves.toMatchObject({
        decision: { governanceRevision: 0 },
      });
    });
  });

  it("approves one durable suggestion and returns the user-owned r+1 detail in the same transaction", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        plan_tier: "internal",
        id: workspaceId,
        name: `Keyword approval integration ${workspaceId}`,
      });
      const fixture = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "Approve",
        displayKeyword: "Customer Onboarding Automation",
      });
      const topic = await createConfirmedTopic(tx, fixture);
      const pending = await createPendingSuggestion(tx, fixture, topic);
      const scope = { workspaceId, projectId: fixture.projectId };

      const before = await getProjectAuditKeywordReviewDetail(
        { workspaceId },
        fixture.projectId,
        fixture.keywordId,
        tx,
      );
      expect(before.data.pendingSuggestion).toMatchObject({
        suggestionId: pending.id,
        state: "pending_ready",
        expectedGovernanceRevision: 0,
      });

      const approved = await approveProjectAuditKeywordReviewSuggestion(
        { workspaceId, actorId: fixture.actorId },
        fixture.projectId,
        fixture.keywordId,
        pending.id,
        {
          expectedGovernanceRevision: pending.expected_governance_revision,
          suggestionVersion: pending.suggestion_version,
        },
        tx,
      );
      const storedSuggestion =
        await new KeywordReviewSuggestionsRepository(tx).findById(
          scope,
          pending.id,
        );
      const current = await new KeywordGovernanceRepository(tx).findCurrent(
        scope,
        fixture.keywordId,
      );

      expect(storedSuggestion).toMatchObject({
        id: pending.id,
        status: "approved",
        resolution_mode: "accepted",
        keyword_review_decision_id: current?.decision.decisionId,
      });
      expect(current?.decision).toMatchObject({
        governanceRevision: 1,
        decisionOrigin: "user",
        decidedBy: fixture.actorId,
      });
      expect(approved).toMatchObject({
        projectId: fixture.projectId,
        diagnosticRunId: null,
        data: {
          keywordId: fixture.keywordId,
          revision: 1,
          status: "approved",
          reviewOrigin: "user",
          cluster: {
            clusterId: topic.topicNodeId,
            topicModelRevision: topic.topicModelRevision,
          },
          mappedTarget: {
            kind: "new_asset",
            revision: 1,
            reviewState: "approved",
          },
          pendingSuggestion: null,
        },
      });
    });
  });

  it("maps a concurrent human edit to 409 without applying the stale suggestion", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        plan_tier: "internal",
        id: workspaceId,
        name: `Keyword stale approval integration ${workspaceId}`,
      });
      const fixture = await seedDataForSeoKeyword(tx, {
        workspaceId,
        label: "Stale",
        displayKeyword: "Customer Onboarding Workflow",
      });
      const topic = await createConfirmedTopic(tx, fixture);
      const pending = await createPendingSuggestion(tx, fixture, topic);
      const scope = { workspaceId, projectId: fixture.projectId };

      await reviewProjectAuditKeyword(
        { workspaceId, actorId: fixture.actorId },
        fixture.projectId,
        fixture.keywordId,
        {
          expectedGovernanceRevision: 0,
          status: "approved",
          intent: "commercial",
          buyerStage: "consideration",
          topicNodeId: topic.topicNodeId,
          topicModelRevision: topic.topicModelRevision,
          mappingDecision: "new_asset",
          mappedSitePageId: null,
          reason: "The operator edited and approved this Keyword manually.",
        },
        tx,
      );
      await expect(
        approveProjectAuditKeywordReviewSuggestion(
          { workspaceId, actorId: fixture.actorId },
          fixture.projectId,
          fixture.keywordId,
          pending.id,
          {
            expectedGovernanceRevision: pending.expected_governance_revision,
            suggestionVersion: pending.suggestion_version,
          },
          tx,
        ),
      ).rejects.toMatchObject({ code: "STALE_REVISION", status: 409 });

      const storedSuggestion =
        await new KeywordReviewSuggestionsRepository(tx).findById(
          scope,
          pending.id,
        );
      const current = await new KeywordGovernanceRepository(tx).findCurrent(
        scope,
        fixture.keywordId,
      );
      expect(storedSuggestion).toMatchObject({
        status: "approved",
        resolution_mode: "edited",
      });
      expect(current?.decision).toMatchObject({
        governanceRevision: 1,
        decisionOrigin: "user",
        decidedBy: fixture.actorId,
      });
    });
  });
});
