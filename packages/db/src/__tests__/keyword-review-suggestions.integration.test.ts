import { randomBytes, randomUUID } from "node:crypto";
import {
  KeywordGovernanceSuggestionInputManifest,
  type KeywordGovernanceSuggestionInputManifest as SuggestionManifest,
} from "@sf/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash, type CanonicalValue } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import {
  AsyncRunsRepository,
  toRunAttempt,
  type RunAttempt,
} from "../repositories/async-runs.ts";
import {
  KeywordGovernanceConflictError,
  KeywordGovernanceRepository,
} from "../repositories/keyword-governance.ts";
import { KeywordGovernanceSuggestionGenerationRunsRepository } from "../repositories/keyword-governance-suggestion-generation-runs.ts";
import { KeywordGovernanceSuggestionInvocationAttemptsRepository } from "../repositories/keyword-governance-suggestion-invocation-attempts.ts";
import {
  KeywordOccurrencesRepository,
  type ManualKeywordOccurrenceInput,
} from "../repositories/keyword-occurrences.ts";
import {
  KeywordReviewSuggestionsRepository,
  type KeywordReviewSuggestionBatchItem,
} from "../repositories/keyword-review-suggestions.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import { TopicModelsRepository } from "../repositories/topic-models.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CSV_CAPTURED_AT = "2026-08-10T00:00:00.000Z";

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly siteId: string;
  readonly sitePageId: string;
  readonly pageUrl: string;
  readonly profileId: string;
}

interface TopicFixture {
  readonly revisionId: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly topicNodeId: string;
  readonly label: string;
}

interface GenerationFixture {
  readonly runId: string;
  readonly attempt: RunAttempt;
  readonly manifest: SuggestionManifest;
  readonly inputHash: string;
}

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as {
      readonly code?: unknown;
      readonly cause?: unknown;
    };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

function pgConstraint(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as {
      readonly constraint?: unknown;
      readonly cause?: unknown;
    };
    if (typeof wrapped.constraint === "string") return wrapped.constraint;
    candidate = wrapped.cause;
  }
  return undefined;
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

function confirmedProfile(siteId: string): Record<string, unknown> {
  const paths = [
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
  return {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: siteId,
    sourcePageUrl: "https://example.com/product",
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    businessHint: "B2B workflow software",
    productName: "RelayOps",
    oneLiner: "Evidence-grounded customer onboarding operations",
    category: "Customer onboarding",
    productType: "B2B SaaS",
    businessModels: ["subscription"],
    valueProposition: "Help teams standardize customer onboarding.",
    coreFeatures: ["Workflow automation", "Implementation tracking"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [{
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
    }],
    competitorCandidates: [],
    fieldProvenance: paths.map((path) => ({
      path,
      derivation: "declared",
      confidence: "medium",
      evidenceRefs: [{ evidenceRefId: randomUUID(), kind: "userEdit" }],
      limitation: "Declared disposable fixture authority.",
      observedAt: null,
    })),
    missingFields: ["/competitorCandidates"],
    conflictingFields: [],
  };
}

function freezeManifest(
  authority: Extract<
    Awaited<
      ReturnType<
        KeywordGovernanceSuggestionGenerationRunsRepository["readPrimaryFreezeAuthority"]
      >
    >,
    { readonly kind: "ready" }
  >["authority"],
): { readonly manifest: SuggestionManifest; readonly inputHash: string } {
  const manifest = KeywordGovernanceSuggestionInputManifest.parse({
    schemaVersion: "keyword-governance-suggestion-input.v1",
    generationVersion: "keyword-governance-suggestion-generation.v1",
    promptSetVersion: "keyword-governance-suggestion.prompt.v1",
    workspaceId: authority.workspaceId,
    projectId: authority.projectId,
    marketCode: authority.marketCode,
    languageTag: authority.languageTag,
    confirmedProductProfile: {
      productProfileId:
        authority.confirmedProductProfile.productProfileId,
      version: authority.confirmedProductProfile.version,
      contentHash: authority.confirmedProductProfile.contentHash,
      facts: authority.confirmedProductProfile.facts,
    },
    confirmedTopicModel: {
      topicModelRevisionId:
        authority.confirmedTopicModel.topicModelRevisionId,
      revision: authority.confirmedTopicModel.revision,
      contentHash: authority.confirmedTopicModel.contentHash,
    },
    topicAllowlist: authority.confirmedTopicModel.topics.map((topic, index) => ({
      topicKey: `topic-${index + 1}`,
      topicNodeId: topic.topicNodeId,
      topicModelRevision: authority.confirmedTopicModel.revision,
      label: topic.label,
    })),
    pageAllowlist: authority.pages.map((page, index) => ({
      pageKey: `page-${index + 1}`,
      sitePageId: page.sitePageId,
      normalizedUrl: page.normalizedUrl,
      title: page.title,
    })),
    candidates: authority.keywords.map((keyword, index) => ({
      ordinal: index + 1,
      keywordKey: `keyword-${index + 1}`,
      keywordId: keyword.keywordId,
      queryKind: "search_query",
      expectedGovernanceRevision: keyword.governanceRevision,
      displayKeyword: keyword.displayKeyword,
      normalizedKeyword: keyword.normalizedKeyword,
      deterministicEvidence: {
        sourceOccurrenceIds: keyword.occurrences.map(
          (occurrence) => occurrence.occurrenceId,
        ),
        providerSearchIntent: [...keyword.occurrences]
          .filter((occurrence) => occurrence.providerSearchIntent !== null)
          .sort((left, right) => {
            const leftIntent = left.providerSearchIntent!;
            const rightIntent = right.providerSearchIntent!;
            return (
              rightIntent.observedAt.localeCompare(leftIntent.observedAt) ||
              leftIntent.observationId.localeCompare(rightIntent.observationId)
            );
          })[0]?.providerSearchIntent ?? null,
        currentTopicKey: null,
        currentPageKey: null,
      },
    })),
  });
  return {
    manifest,
    inputHash: contentHash(manifest as unknown as CanonicalValue),
  };
}

describeDb("Keyword review suggestion durable authority", () => {
  let handle: DbHandle;
  let secondMigrationReplay: readonly string[];

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    await runMigrations(databaseUrl);
    secondMigrationReplay = await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);
  });

  afterAll(async () => {
    await handle?.end();
  });

  function scope(project: ProjectFixture) {
    return {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };
  }

  async function createProject(): Promise<ProjectFixture> {
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const siteId = randomUUID();
    const sitePageId = randomUUID();
    const profileId = randomUUID();
    const host = `${projectId}.keyword-suggestion.example`;
    const pageUrl = `https://${host}/customer-onboarding/`;
    const profile = confirmedProfile(siteId);
    await handle.pool.query(
      "INSERT INTO app.workspaces (id, name) VALUES ($1,$2)",
      [workspaceId, `Keyword suggestions ${workspaceId}`],
    );
    await handle.pool.query(
      `INSERT INTO app.client_projects (
         id, workspace_id, client_name, project_name,
         default_delivery_locale, created_by
       ) VALUES ($1,$2,$3,$4,'en-US',$5)`,
      [projectId, workspaceId, "Client", "Suggestion project", actorId],
    );
    await handle.pool.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES ($1,$2,$3,$4,$5,ARRAY['US'],ARRAY['en-US'],true)`,
      [siteId, workspaceId, projectId, `https://${host}`, host],
    );
    await handle.pool.query(
      `INSERT INTO app.site_pages (
         id, workspace_id, project_id, site_id,
         normalized_url, normalized_url_hash
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        sitePageId,
        workspaceId,
        projectId,
        siteId,
        pageUrl,
        normalizedUrlHash(pageUrl),
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.icp_profiles (
         id, workspace_id, project_id, version, status, profile,
         content_hash, created_by
       ) VALUES ($1,$2,$3,1,'complete',$4::jsonb,$5,$6)`,
      [
        profileId,
        workspaceId,
        projectId,
        JSON.stringify(profile),
        contentHash({ status: "complete", profile } as CanonicalValue),
        actorId,
      ],
    );
    await handle.pool.query(
      `UPDATE app.client_projects
          SET current_icp_profile_id = $1,
              confirmed_icp_profile_id = $1
        WHERE workspace_id = $2 AND id = $3`,
      [profileId, workspaceId, projectId],
    );
    return {
      workspaceId,
      projectId,
      actorId,
      siteId,
      sitePageId,
      pageUrl,
      profileId,
    };
  }

  async function createConfirmedTopic(
    project: ProjectFixture,
  ): Promise<TopicFixture> {
    const topics = new TopicModelsRepository(handle.db);
    const draft = await topics.beginDraftFromLatestConfirmed(
      scope(project),
      project.actorId,
      {
        expectedLatestConfirmedRevision: 0,
        reason: "Create disposable suggestion Topic authority.",
      },
    );
    const label = "Customer onboarding";
    const edited = await topics.patchDraft(scope(project), project.actorId, {
      topicModelRevision: draft.topicModelRevision,
      expectedEditRevision: draft.editRevision,
      reason: "Add the canonical suggestion Topic.",
      intents: [{
        kind: "create",
        parentTopicNodeId: null,
        label,
        description: "Confirmed Topic for suggestion governance.",
        intentEnvelope: ["Commercial"],
      }],
    });
    const confirmed = await topics.confirmDraft(
      scope(project),
      project.actorId,
      {
        topicModelRevision: edited.topicModelRevision,
        expectedEditRevision: edited.editRevision,
        reason: "Confirm the Topic before freezing suggestions.",
      },
    );
    if (confirmed.rootTopicNodeId === null) {
      throw new Error("confirmed Topic fixture has no root");
    }
    const stored = await handle.pool.query<{
      id: string;
      content_hash: string;
    }>(
      `SELECT id, content_hash
         FROM app.topic_model_revisions
        WHERE workspace_id = $1 AND project_id = $2 AND revision = $3`,
      [project.workspaceId, project.projectId, confirmed.topicModelRevision],
    );
    const row = stored.rows[0];
    if (!row) throw new Error("confirmed Topic fixture was not stored");
    return {
      revisionId: row.id,
      revision: confirmed.topicModelRevision,
      contentHash: row.content_hash,
      topicNodeId: confirmed.rootTopicNodeId,
      label,
    };
  }

  async function createCsvOccurrence(
    project: ProjectFixture,
  ): Promise<{ readonly occurrenceId: string; readonly keywordId: string }> {
    const importPreviewId = randomUUID();
    const connectionId = randomUUID();
    const collectionRunId = randomUUID();
    const snapshotId = randomUUID();
    const observationId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.import_previews (
         id, workspace_id, project_id, site_id, created_by,
         token_hash, template_id, raw_object_key, file_checksum,
         row_count, detected_columns, suggested_mapping, preview_rows,
         validation_errors, validation_warnings, status, expires_at, consumed_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'keyword_gap_v1',$7,$8,1,
         '[]'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
         'consumed',$9,$10
       )`,
      [
        importPreviewId,
        project.workspaceId,
        project.projectId,
        project.siteId,
        project.actorId,
        randomBytes(32),
        `raw/${importPreviewId}.csv`,
        contentHash({ importPreviewId }),
        "2026-08-11T00:00:00.000Z",
        CSV_CAPTURED_AT,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.source_connections (
         id, workspace_id, project_id, site_id, provider,
         connection_type, state, external_ref, limitation,
         connected_at, created_by
       ) VALUES (
         $1,$2,$3,$4,'csv','file_import','available',$5,
         'Customer-provided keyword CSV.',$6,$7
       )`,
      [
        connectionId,
        project.workspaceId,
        project.projectId,
        project.siteId,
        importPreviewId,
        CSV_CAPTURED_AT,
        project.actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status, initiated_by, started_at
       ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
      [
        collectionRunId,
        project.workspaceId,
        project.projectId,
        project.actorId,
        CSV_CAPTURED_AT,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.collection_runs (
         id, workspace_id, project_id, site_id, source_connection_id,
         import_preview_id, provider, operation, method_version, parameters_hash
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'csv','keyword_gap_import',
         'csv.keyword_gap.v1',$7
       )`,
      [
        collectionRunId,
        project.workspaceId,
        project.projectId,
        project.siteId,
        connectionId,
        importPreviewId,
        contentHash({ collectionRunId }),
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.data_snapshots (
         id, workspace_id, project_id, site_id, collection_run_id,
         source_connection_id, provider, dataset_key, schema_version,
         method_version, captured_at, source_window, availability,
         limitation, row_count, checksum, summary
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'csv','csv.keyword_gap.v1','0.3.0',
         'csv.keyword_gap.v1',$7,'{"start":null,"end":null}'::jsonb,
         'available','Customer-provided keyword CSV.',1,$8,'{}'::jsonb
       )`,
      [
        snapshotId,
        project.workspaceId,
        project.projectId,
        project.siteId,
        collectionRunId,
        connectionId,
        CSV_CAPTURED_AT,
        contentHash({ snapshotId }),
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.normalized_observations (
         id, workspace_id, project_id, snapshot_id, provider,
         metric_key, subject_type, subject_ref, observed_at,
         availability, value_json, origin, grade, support, limitation
       ) VALUES (
         $1,$2,$3,$4,'csv','csv.keyword_gap.v1','keyword_cluster',
         'keyword-suggestion',$5,'available',$6,'user_provided','C',
         'context','Customer-provided keyword CSV.'
       )`,
      [
        observationId,
        project.workspaceId,
        project.projectId,
        snapshotId,
        CSV_CAPTURED_AT,
        {
          keyword: "customer onboarding software",
          clusterKey: "customer-onboarding",
          searchVolume: 100,
          currentUrl: null,
          currentRank: null,
          competitorDomain: null,
          competitorRank: null,
          marketCode: "US",
          languageCode: "en-US",
        },
      ],
    );
    const created = await new KeywordOccurrencesRepository(
      handle.db,
    ).upsertIntoLibrary(scope(project), {
      manualEntryId: null,
      dataSnapshotId: snapshotId,
      normalizedObservationId: observationId,
      displayKeyword: "Customer Onboarding Software",
      normalizedKeyword: "customer onboarding software",
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "csv_import",
      scopeBasis: "user_provided",
      sourcePointer: "/valueJson/keyword",
      sourceRef: `observation:${observationId}#/valueJson/keyword`,
      collectedAt: CSV_CAPTURED_AT,
      providerDataAsOf: null,
    });
    return { occurrenceId: created.occurrenceId, keywordId: created.entityId };
  }

  async function createDataForSeoOccurrence(
    project: ProjectFixture,
  ): Promise<{
    readonly occurrenceId: string;
    readonly keywordId: string;
    readonly snapshotId: string;
    readonly observationId: string;
    readonly observedAt: string;
  }> {
    const sourceConnectionId = randomUUID();
    const collectionRunId = randomUUID();
    const snapshotId = randomUUID();
    const observationId = randomUUID();
    const observedAt = "2026-08-10T00:15:00.000Z";
    await handle.pool.query(
      `INSERT INTO app.source_connections (
         id, workspace_id, project_id, site_id, provider,
         connection_type, state, external_ref, limitation,
         connected_at, created_by
       ) VALUES (
         $1,$2,$3,$4,'dataforseo','api_key_stub','available',$5,
         'Disposable DataForSEO suggestion authority.',$6,$7
       )`,
      [
        sourceConnectionId,
        project.workspaceId,
        project.projectId,
        project.siteId,
        `suggestion-${sourceConnectionId}`,
        observedAt,
        project.actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status, initiated_by, started_at
       ) VALUES ($1,$2,$3,'collection','running',$4,$5)`,
      [
        collectionRunId,
        project.workspaceId,
        project.projectId,
        project.actorId,
        observedAt,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.collection_runs (
         id, workspace_id, project_id, site_id, source_connection_id,
         provider, operation, method_version, parameters_hash
       ) VALUES (
         $1,$2,$3,$4,$5,'dataforseo','keyword_gap_import',
         'dataforseo.ranked_keywords.v1',$6
       )`,
      [
        collectionRunId,
        project.workspaceId,
        project.projectId,
        project.siteId,
        sourceConnectionId,
        contentHash({ collectionRunId }),
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.data_snapshots (
         id, workspace_id, project_id, site_id, collection_run_id,
         source_connection_id, provider, dataset_key, schema_version,
         method_version, captured_at, source_window, availability,
         limitation, row_count, checksum, summary
       ) VALUES (
         $1,$2,$3,$4,$5,$6,'dataforseo','dataforseo.ranked_keywords.v1',
         'dataforseo.ranked_keywords.v1','dataforseo.ranked_keywords.v1',
         $7,'{"start":null,"end":null}'::jsonb,'available',
         'Disposable provider suggestion authority.',1,$8,$9
       )`,
      [
        snapshotId,
        project.workspaceId,
        project.projectId,
        project.siteId,
        collectionRunId,
        sourceConnectionId,
        observedAt,
        contentHash({ snapshotId }),
        {
          collectionScope: { marketCode: "US", languageTag: "en-US" },
          timing: { dataAsOf: null, freshness: "unknown" },
        },
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.normalized_observations (
         id, workspace_id, project_id, snapshot_id, provider,
         metric_key, subject_type, subject_ref, observed_at,
         availability, value_json, origin, grade, support, limitation
       ) VALUES (
         $1,$2,$3,$4,'dataforseo','csv.keyword_gap.v1','keyword_cluster',
         'keyword-suggestion',$5,'available',$6,'vendor_observation','B',
         'context','Disposable provider suggestion authority.'
       )`,
      [
        observationId,
        project.workspaceId,
        project.projectId,
        snapshotId,
        observedAt,
        {
          keyword: "customer onboarding software",
          clusterKey: "customer-onboarding",
          searchVolume: 2400,
          currentUrl: null,
          currentRank: null,
          competitorDomain: null,
          competitorRank: null,
          marketCode: "US",
          languageCode: "en-US",
          providerSearchIntent: "commercial",
        },
      ],
    );
    const created = await new KeywordOccurrencesRepository(
      handle.db,
    ).upsertIntoLibrary(scope(project), {
      manualEntryId: null,
      dataSnapshotId: snapshotId,
      normalizedObservationId: observationId,
      displayKeyword: "Customer Onboarding Software",
      normalizedKeyword: "customer onboarding software",
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "dataforseo_ranked",
      scopeBasis: "provider_collection_scope",
      sourcePointer: "/valueJson/keyword",
      sourceRef: `observation:${observationId}#/valueJson/keyword`,
      collectedAt: observedAt,
      providerDataAsOf: null,
    });
    return {
      occurrenceId: created.occurrenceId,
      keywordId: created.entityId,
      snapshotId,
      observationId,
      observedAt,
    };
  }

  function manualOccurrence(
    displayKeyword: string,
    collectedAt: string,
  ): ManualKeywordOccurrenceInput {
    const id = randomUUID();
    return {
      manualEntryId: id,
      dataSnapshotId: null,
      normalizedObservationId: null,
      displayKeyword,
      normalizedKeyword: displayKeyword.toLowerCase(),
      market: "US",
      languageTag: "en-US",
      queryKind: "search_query",
      sourceKind: "manual",
      scopeBasis: "manual",
      sourcePointer: null,
      sourceRef: `manual:${id}`,
      collectedAt,
      providerDataAsOf: null,
    };
  }

  async function createGeneration(
    project: ProjectFixture,
    frozen: { readonly manifest: SuggestionManifest; readonly inputHash: string },
    activeKey: string,
  ): Promise<GenerationFixture> {
    const runId = randomUUID();
    const asyncRuns = new AsyncRunsRepository(handle.db);
    await asyncRuns.insertQueued({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      kind: "keyword_governance_suggestion_generation",
      activeKey,
      initiatedBy: project.actorId,
      contractVersion: "2026-08-10",
      resultType: "keyword_governance_suggestion_generation_run",
      resultId: runId,
    });
    await new KeywordGovernanceSuggestionGenerationRunsRepository(
      handle.db,
    ).insertPlaceholder({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      inputManifest: frozen.manifest,
      inputHash: frozen.inputHash,
    });
    const claimed = await asyncRuns.claim(scope(project), runId);
    if (!claimed) throw new Error("suggestion generation claim failed");
    return {
      runId,
      attempt: toRunAttempt(claimed),
      manifest: frozen.manifest,
      inputHash: frozen.inputHash,
    };
  }

  async function successfulInvocation(
    generation: GenerationFixture,
    outputHash: string,
  ): Promise<{ readonly invocationId: string; readonly promptHash: string }> {
    const promptHash = contentHash({
      runId: generation.runId,
      publicProviderProjection: true,
    });
    const attempts = new KeywordGovernanceSuggestionInvocationAttemptsRepository(
      handle.db,
    );
    const preflight = {
      provider: "openai",
      model: "gpt-5-mini",
      promptSetVersion: "keyword-governance-suggestion.prompt.v1",
      inputHash: promptHash,
    } as const;
    const reserved = await attempts.reserve(generation.attempt, preflight);
    expect(reserved.kind).toBe("reserved");
    if (reserved.kind !== "reserved") throw new Error("reservation failed");
    const replay = await attempts.reserve(generation.attempt, preflight);
    expect(replay.kind).toBe("existing");
    const finalized = await attempts.finalizeWithInvocation(
      generation.attempt,
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
    expect(finalized.kind).toBe("finalized");
    if (finalized.kind !== "finalized") throw new Error("finalize failed");
    return { invocationId: finalized.invocationId, promptHash };
  }

  function suggestionsFor(
    generation: GenerationFixture,
    topic: TopicFixture,
    project: ProjectFixture,
  ): KeywordReviewSuggestionBatchItem[] {
    return generation.manifest.candidates.map((candidate, index) => ({
      suggestionId: randomUUID(),
      ordinal: candidate.ordinal,
      keywordId: candidate.keywordId,
      expectedGovernanceRevision: candidate.expectedGovernanceRevision,
      suggestionVersion: "keyword-governance-suggestion.v1",
      status: "approved",
      intent:
        candidate.deterministicEvidence.providerSearchIntent?.value ??
        "commercial",
      buyerStage: "decision",
      topicNodeId: topic.topicNodeId,
      topicModelRevision: topic.revision,
      mappingDecision: index === 0 ? "existing_page" : "new_asset",
      mappedSitePageId: index === 0 ? project.sitePageId : null,
      reason: "Confirmed authority supports this governed recommendation.",
      intentAuthority:
        candidate.deterministicEvidence.providerSearchIntent === null
          ? "llm_generated"
          : "provider_observed",
      intentSnapshotId:
        candidate.deterministicEvidence.providerSearchIntent?.snapshotId ??
        null,
      intentObservationId:
        candidate.deterministicEvidence.providerSearchIntent?.observationId ??
        null,
      intentObservedAt:
        candidate.deterministicEvidence.providerSearchIntent?.observedAt ??
        null,
    }));
  }

  async function rawBatch(
    project: ProjectFixture,
    generation: GenerationFixture,
    outputHash: string,
    invocationId: string,
    suggestions: readonly unknown[],
  ): Promise<Record<string, unknown>> {
    const result = await handle.pool.query<{ result: Record<string, unknown> }>(
      `SELECT app.insert_keyword_review_suggestions_batch(
         $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid,$7::jsonb
       ) AS result`,
      [
        project.workspaceId,
        project.projectId,
        generation.runId,
        generation.inputHash,
        outputHash,
        invocationId,
        JSON.stringify(suggestions),
      ],
    );
    return result.rows[0]!.result;
  }

  it("replays migration and installs exact 0051 authority including actorless system suggestions", async () => {
    expect(secondMigrationReplay).toEqual([]);
    const result = await handle.db.execute<{
      suggestion: string | null;
      generation_run: string | null;
      invocation_attempt: string | null;
      pending_index: string | null;
    }>(
      `SELECT
         to_regclass('app.keyword_review_suggestions')::text AS suggestion,
         to_regclass('app.keyword_governance_suggestion_generation_runs')::text AS generation_run,
         to_regclass('app.keyword_governance_suggestion_invocation_attempts')::text AS invocation_attempt,
         to_regclass('app.keyword_review_suggestions_one_pending_idx')::text AS pending_index`,
    );
    expect(result.rows[0]).toEqual({
      suggestion: "app.keyword_review_suggestions",
      generation_run:
        "app.keyword_governance_suggestion_generation_runs",
      invocation_attempt:
        "app.keyword_governance_suggestion_invocation_attempts",
      pending_index: "app.keyword_review_suggestions_one_pending_idx",
    });
    const definition = await handle.pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'app.keyword_review_decisions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%decision_origin%decided_by%'`,
    );
    expect(definition.rows.some((row) =>
      row.definition.includes("system_suggestion") &&
      row.definition.includes("decided_by IS NULL")
    )).toBe(true);
  });

  it("does not let model output downgrade frozen provider intent authority", async () => {
    const project = await createProject();
    const topic = await createConfirmedTopic(project);
    const occurrence = await createDataForSeoOccurrence(project);
    const generationRuns =
      new KeywordGovernanceSuggestionGenerationRunsRepository(handle.db);
    const authority = await generationRuns.readPrimaryFreezeAuthority(
      scope(project),
    );
    expect(authority.kind).toBe("ready");
    if (authority.kind !== "ready") throw new Error("authority missing");
    expect(authority.authority.keywords).toHaveLength(1);
    expect(authority.authority.keywords[0]).toMatchObject({
      keywordId: occurrence.keywordId,
      occurrences: [{
        occurrenceId: occurrence.occurrenceId,
        providerSearchIntent: {
          value: "commercial",
          snapshotId: occurrence.snapshotId,
          observationId: occurrence.observationId,
        },
      }],
    });
    const frozen = freezeManifest(authority.authority);
    const providerIntent = frozen.manifest.candidates[0]!
      .deterministicEvidence.providerSearchIntent;
    expect(providerIntent).toMatchObject({
      value: "commercial",
      snapshotId: occurrence.snapshotId,
      observationId: occurrence.observationId,
    });
    const generation = await createGeneration(
      project,
      frozen,
      `keyword-suggestion-provider:${randomUUID()}`,
    );
    const outputHash = contentHash({ run: generation.runId, output: 1 });
    const invocation = await successfulInvocation(generation, outputHash);
    const items = suggestionsFor(generation, topic, project);
    expect(items).toHaveLength(1);
    expect((await rawBatch(
      project,
      generation,
      outputHash,
      invocation.invocationId,
      [{
        ...items[0]!,
        intent: null,
        intentAuthority: "unavailable",
        intentSnapshotId: null,
        intentObservationId: null,
        intentObservedAt: null,
      }],
    ))["kind"]).toBe("conflict");
    const storedAfterDowngrade = await handle.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM app.keyword_review_suggestions
        WHERE generation_run_id = $1`,
      [generation.runId],
    );
    expect(storedAfterDowngrade.rows[0]?.count).toBe("0");
    await expect(new KeywordReviewSuggestionsRepository(handle.db).insertBatch(
      scope(project),
      {
        generationRunId: generation.runId,
        inputHash: generation.inputHash,
        outputHash,
        analysisInvocationId: invocation.invocationId,
        suggestions: items,
      },
    )).resolves.toMatchObject({ kind: "inserted" });
  });

  it("rejects insufficient intent and project locale/Site authority drift at approval time", async () => {
    const project = await createProject();
    const topic = await createConfirmedTopic(project);
    await createCsvOccurrence(project);
    const occurrences = new KeywordOccurrencesRepository(handle.db);
    await occurrences.upsertIntoLibrary(
      scope(project),
      manualOccurrence("Onboarding Journey", "2026-08-10T00:20:00.000Z"),
    );
    const generationRuns =
      new KeywordGovernanceSuggestionGenerationRunsRepository(handle.db);
    const authority = await generationRuns.readPrimaryFreezeAuthority(
      scope(project),
    );
    expect(authority.kind).toBe("ready");
    if (authority.kind !== "ready") throw new Error("authority missing");
    expect(authority.authority.keywords).toHaveLength(2);
    const frozen = freezeManifest(authority.authority);
    const generation = await createGeneration(
      project,
      frozen,
      `keyword-suggestion-approval-fence:${randomUUID()}`,
    );
    const outputHash = contentHash({ run: generation.runId, output: 1 });
    const invocation = await successfulInvocation(generation, outputHash);
    const generatedItems = suggestionsFor(generation, topic, project);
    const unavailableItem = {
      ...generatedItems[0]!,
      intent: null,
      intentAuthority: "unavailable" as const,
      intentSnapshotId: null,
      intentObservationId: null,
      intentObservedAt: null,
    };
    const readyItem = generatedItems[1]!;
    const suggestions = new KeywordReviewSuggestionsRepository(handle.db);
    const inserted = await suggestions.insertBatch(scope(project), {
      generationRunId: generation.runId,
      inputHash: generation.inputHash,
      outputHash,
      analysisInvocationId: invocation.invocationId,
      suggestions: [unavailableItem, readyItem],
    });
    expect(inserted.kind).toBe("inserted");
    if (inserted.kind !== "inserted") throw new Error("batch insert failed");
    await expect(generationRuns.terminalize(generation.attempt, {
      status: "completed",
      resultOutputHash: outputHash,
      lastErrorCode: null,
      lastErrorSummary: null,
    })).resolves.toMatchObject({ kind: "terminalized" });
    const unavailableSuggestion = inserted.suggestions.find(
      (row) => row.keyword_entity_id === unavailableItem.keywordId,
    )!;
    const readySuggestion = inserted.suggestions.find(
      (row) => row.keyword_entity_id === readyItem.keywordId,
    )!;
    const governance = new KeywordGovernanceRepository(handle.db);

    const unavailableApproval = await governance.approveSuggestion(
      scope(project),
      unavailableItem.keywordId,
      unavailableSuggestion.id,
      project.actorId,
      {
        expectedGovernanceRevision: 0,
        suggestionVersion: "keyword-governance-suggestion.v1",
      },
    ).catch((error: unknown) => error);
    expect(unavailableApproval).toBeInstanceOf(KeywordGovernanceConflictError);
    expect((unavailableApproval as KeywordGovernanceConflictError).code).toBe(
      "REVISION_CONFLICT",
    );
    const directUnavailable = await handle.pool.query(
      `UPDATE app.keyword_review_suggestions
          SET status = 'approved',
              resolution_mode = 'accepted',
              keyword_review_decision_id = $2,
              resolved_at = clock_timestamp()
        WHERE id = $1`,
      [unavailableSuggestion.id, randomUUID()],
    ).catch((error: unknown) => error);
    expect(pgCode(directUnavailable)).toBe("23514");
    expect(pgConstraint(directUnavailable)).toBe(
      "keyword_review_suggestion_accepted_authority_current",
    );

    await handle.pool.query(
      `UPDATE app.client_projects
          SET default_delivery_locale = 'fr-CA'
        WHERE workspace_id = $1 AND id = $2`,
      [project.workspaceId, project.projectId],
    );
    await expect(suggestions.findCurrentPendingReadiness(
      scope(project),
      readyItem.keywordId,
    )).resolves.toMatchObject({ kind: "stale" });
    const localeDriftApproval = await governance.approveSuggestion(
      scope(project),
      readyItem.keywordId,
      readySuggestion.id,
      project.actorId,
      {
        expectedGovernanceRevision: 0,
        suggestionVersion: "keyword-governance-suggestion.v1",
      },
    ).catch((error: unknown) => error);
    expect(localeDriftApproval).toBeInstanceOf(
      KeywordGovernanceConflictError,
    );
    expect((localeDriftApproval as KeywordGovernanceConflictError).code).toBe(
      "REVISION_CONFLICT",
    );
    await handle.pool.query(
      `UPDATE app.client_projects
          SET default_delivery_locale = 'en-US'
        WHERE workspace_id = $1 AND id = $2`,
      [project.workspaceId, project.projectId],
    );

    await handle.pool.query(
      `UPDATE app.sites
          SET market_codes = ARRAY['CA'], language_codes = ARRAY['fr-CA']
        WHERE workspace_id = $1 AND project_id = $2 AND is_primary`,
      [project.workspaceId, project.projectId],
    );
    await expect(suggestions.findCurrentPendingReadiness(
      scope(project),
      readyItem.keywordId,
    )).resolves.toMatchObject({ kind: "stale" });
    const siteDriftApproval = await governance.approveSuggestion(
      scope(project),
      readyItem.keywordId,
      readySuggestion.id,
      project.actorId,
      {
        expectedGovernanceRevision: 0,
        suggestionVersion: "keyword-governance-suggestion.v1",
      },
    ).catch((error: unknown) => error);
    expect(siteDriftApproval).toBeInstanceOf(KeywordGovernanceConflictError);
    expect((siteDriftApproval as KeywordGovernanceConflictError).code).toBe(
      "REVISION_CONFLICT",
    );
    await handle.pool.query(
      `UPDATE app.sites
          SET market_codes = ARRAY['US'], language_codes = ARRAY['en-US']
        WHERE workspace_id = $1 AND project_id = $2 AND is_primary`,
      [project.workspaceId, project.projectId],
    );
    await expect(suggestions.findCurrentPendingReadiness(
      scope(project),
      readyItem.keywordId,
    )).resolves.toMatchObject({ kind: "ready" });

    const state = await handle.pool.query<{
      mapping_revision: number;
      suggestion_status: string;
      user_decisions: string;
    }>(
      `SELECT keyword.mapping_revision,
              suggestion.status AS suggestion_status,
              (SELECT count(*)::text
                 FROM app.keyword_review_decisions decision
                WHERE decision.keyword_entity_id = keyword.id
                  AND decision.decision_origin = 'user') AS user_decisions
         FROM app.keyword_entities keyword
         JOIN app.keyword_review_suggestions suggestion
           ON suggestion.keyword_entity_id = keyword.id
        WHERE keyword.id = $1 AND suggestion.id = $2`,
      [readyItem.keywordId, readySuggestion.id],
    );
    expect(state.rows[0]).toEqual({
      mapping_revision: 0,
      suggestion_status: "pending",
      user_decisions: "0",
    });
  });

  it("enforces the complete real-PG generation, paid-call, batch, and human resolution lifecycle", async () => {
    const project = await createProject();
    const topic = await createConfirmedTopic(project);
    const csv = await createCsvOccurrence(project);
    const generationRuns = new KeywordGovernanceSuggestionGenerationRunsRepository(
      handle.db,
    );
    const suggestions = new KeywordReviewSuggestionsRepository(handle.db);
    const occurrences = new KeywordOccurrencesRepository(handle.db);
    const generativeOccurrence = manualOccurrence(
      "How can AI improve onboarding?",
      "2026-08-10T00:30:00.000Z",
    );
    const generative = await occurrences.upsertIntoLibrary(scope(project), {
      ...generativeOccurrence,
      queryKind: "generative_query",
    });

    const initialAuthority = await generationRuns.readPrimaryFreezeAuthority(
      scope(project),
    );
    expect(initialAuthority.kind).toBe("ready");
    if (initialAuthority.kind !== "ready") throw new Error("authority missing");
    expect(initialAuthority.authority.keywords).toHaveLength(1);
    expect(initialAuthority.authority.keywords.some(
      (keyword) => keyword.keywordId === generative.entityId,
    )).toBe(false);
    expect(initialAuthority.authority.keywords[0]?.occurrences).toMatchObject([
      { occurrenceId: csv.occurrenceId, sourceKind: "csv_import" },
    ]);
    const invalidQueryManifest = structuredClone(
      freezeManifest(initialAuthority.authority).manifest,
    );
    invalidQueryManifest.candidates[0] = {
      ...invalidQueryManifest.candidates[0]!,
      keywordId: generative.entityId,
      displayKeyword: generativeOccurrence.displayKeyword,
      normalizedKeyword: generativeOccurrence.normalizedKeyword,
      deterministicEvidence: {
        sourceOccurrenceIds: [generative.occurrenceId],
        providerSearchIntent: null,
        currentTopicKey: null,
        currentPageKey: null,
      },
    };
    const invalidQueryRunId = randomUUID();
    await expectPgCode(handle.db.transaction(async (tx) => {
      await new AsyncRunsRepository(tx).insertQueued({
        runId: invalidQueryRunId,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        kind: "keyword_governance_suggestion_generation",
        activeKey: `keyword-suggestion-generative:${randomUUID()}`,
        initiatedBy: project.actorId,
        contractVersion: "2026-08-10",
        resultType: "keyword_governance_suggestion_generation_run",
        resultId: invalidQueryRunId,
      });
      await new KeywordGovernanceSuggestionGenerationRunsRepository(
        tx,
      ).insertPlaceholder({
        runId: invalidQueryRunId,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        inputManifest: invalidQueryManifest,
        inputHash: contentHash(
          invalidQueryManifest as unknown as CanonicalValue,
        ),
      });
    }), "23514");
    const invalidQueryRows = await handle.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.async_runs WHERE id = $1",
      [invalidQueryRunId],
    );
    expect(invalidQueryRows.rows[0]?.count).toBe("0");

    const history = Array.from({ length: 100 }, (_, index) =>
      manualOccurrence(
        "Customer Onboarding Software",
        new Date(Date.UTC(2026, 7, 10, 1, 0, index)).toISOString(),
      ));
    await occurrences.upsertManyIntoLibrary(scope(project), history);
    const windowAuthority = await generationRuns.readPrimaryFreezeAuthority(
      scope(project),
    );
    expect(windowAuthority.kind).toBe("ready");
    if (windowAuthority.kind !== "ready") throw new Error("window missing");
    const windowKeyword = windowAuthority.authority.keywords.find(
      (keyword) => keyword.keywordId === csv.keywordId,
    );
    expect(windowKeyword?.occurrences).toHaveLength(100);
    expect(windowKeyword?.occurrences.some(
      (occurrence) => occurrence.occurrenceId === csv.occurrenceId,
    )).toBe(false);
    const expectedWindow = await handle.pool.query<{ id: string }>(
      `SELECT occurrence.id
         FROM app.keyword_entity_sources source
         JOIN app.keyword_occurrences occurrence
           ON occurrence.id = source.keyword_occurrence_id
        WHERE source.workspace_id = $1
          AND source.project_id = $2
          AND source.keyword_entity_id = $3
        ORDER BY occurrence.collected_at DESC, occurrence.id DESC
        LIMIT 100`,
      [project.workspaceId, project.projectId, csv.keywordId],
    );
    expect(windowKeyword?.occurrences.map((row) => row.occurrenceId)).toEqual(
      expectedWindow.rows.map((row) => row.id).sort(),
    );

    const staleFrozen = freezeManifest(windowAuthority.authority);
    const staleRun = await createGeneration(
      project,
      staleFrozen,
      `keyword-suggestion:${project.projectId}:US:en-US`,
    );
    const duplicateActiveKeyRunId = randomUUID();
    await expectPgCode(
      new AsyncRunsRepository(handle.db).insertQueued({
        runId: duplicateActiveKeyRunId,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        kind: "keyword_governance_suggestion_generation",
        activeKey: `keyword-suggestion:${project.projectId}:US:en-US`,
        initiatedBy: project.actorId,
        contractVersion: "2026-08-10",
        resultType: "keyword_governance_suggestion_generation_run",
        resultId: duplicateActiveKeyRunId,
      }),
      "23505",
    );
    await expectPgCode(
      handle.pool.query(
        `UPDATE app.keyword_governance_suggestion_generation_runs
            SET input_manifest = input_manifest || '{"drift":true}'::jsonb
          WHERE id = $1`,
        [staleRun.runId],
      ),
      "23514",
    );
    const staleOutputHash = contentHash({ run: staleRun.runId, output: 1 });
    const staleInvocation = await successfulInvocation(
      staleRun,
      staleOutputHash,
    );
    await occurrences.upsertIntoLibrary(
      scope(project),
      manualOccurrence(
        "Customer Onboarding Software",
        "2026-08-10T03:00:00.000Z",
      ),
    );
    const staleItems = suggestionsFor(staleRun, topic, project);
    await expect(suggestions.insertBatch(scope(project), {
      generationRunId: staleRun.runId,
      inputHash: staleRun.inputHash,
      outputHash: staleOutputHash,
      analysisInvocationId: staleInvocation.invocationId,
      suggestions: staleItems,
    })).resolves.toEqual({ kind: "stale_authority" });
    const staleCount = await handle.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.keyword_review_suggestions WHERE generation_run_id = $1",
      [staleRun.runId],
    );
    expect(staleCount.rows[0]?.count).toBe("0");
    await expect(generationRuns.terminalize(staleRun.attempt, {
      status: "cancelled",
      resultOutputHash: null,
      lastErrorCode: "KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE",
      lastErrorSummary: "Frozen authority changed before persistence.",
    })).resolves.toMatchObject({ kind: "terminalized" });

    const afterStaleAuthority = await generationRuns.readPrimaryFreezeAuthority(
      scope(project),
    );
    if (afterStaleAuthority.kind !== "ready") {
      throw new Error("current authority missing");
    }
    const unknownRun = await createGeneration(
      project,
      freezeManifest(afterStaleAuthority.authority),
      `keyword-suggestion-unknown:${randomUUID()}`,
    );
    const unknownAttempts = new KeywordGovernanceSuggestionInvocationAttemptsRepository(
      handle.db,
    );
    const unknownPreflight = {
      provider: "openai",
      model: "gpt-5-mini",
      promptSetVersion: "keyword-governance-suggestion.prompt.v1",
      inputHash: contentHash({ run: unknownRun.runId, prompt: true }),
    } as const;
    const unknownReservation = await unknownAttempts.reserve(
      unknownRun.attempt,
      unknownPreflight,
    );
    expect(unknownReservation.kind).toBe("reserved");
    if (unknownReservation.kind !== "reserved") {
      throw new Error("unknown reservation missing");
    }
    await expect(unknownAttempts.markOutcomeUnknown(
      unknownRun.attempt,
      unknownReservation.reservation.id,
      "NETWORK_OUTCOME_UNKNOWN",
    )).resolves.toMatchObject({ kind: "marked" });
    await expect(unknownAttempts.reserve(
      unknownRun.attempt,
      unknownPreflight,
    )).resolves.toMatchObject({
      kind: "existing",
      reservation: { status: "outcome_unknown" },
    });
    await expect(generationRuns.terminalize(unknownRun.attempt, {
      status: "failed",
      resultOutputHash: null,
      lastErrorCode:
        "KEYWORD_GOVERNANCE_SUGGESTION_INVOCATION_OUTCOME_UNKNOWN",
      lastErrorSummary: "Provider outcome could not be proven.",
    })).resolves.toMatchObject({ kind: "terminalized" });

    const secondOccurrence = await occurrences.upsertIntoLibrary(
      scope(project),
      manualOccurrence("Onboarding Automation", "2026-08-10T04:00:00.000Z"),
    );
    const currentAuthority = await generationRuns.readPrimaryFreezeAuthority(
      scope(project),
    );
    if (currentAuthority.kind !== "ready") {
      throw new Error("two-candidate authority missing");
    }
    expect(currentAuthority.authority.keywords).toHaveLength(2);
    const currentFrozen = freezeManifest(currentAuthority.authority);
    let activeRun = await createGeneration(
      project,
      currentFrozen,
      `keyword-suggestion-happy:${randomUUID()}`,
    );
    const duplicateActive = await createGeneration(
      project,
      currentFrozen,
      `keyword-suggestion-duplicate:${randomUUID()}`,
    );
    await expect(generationRuns.findCurrentGenerationForKeyword(
      scope(project),
      csv.keywordId,
    )).rejects.toThrow(/multiple active/u);
    await expect(generationRuns.terminalize(duplicateActive.attempt, {
      status: "cancelled",
      resultOutputHash: null,
      lastErrorCode: "KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT",
      lastErrorSummary: "Duplicate active generation was cancelled.",
    })).resolves.toMatchObject({ kind: "terminalized" });
    await expect(generationRuns.findCurrentGenerationForKeyword(
      scope(project),
      activeRun.manifest.candidates[0]!.keywordId,
    )).resolves.toMatchObject({
      generationRunId: activeRun.runId,
      status: "running",
      authorityCurrent: true,
      safeTerminalCode: null,
    });
    await expect(generationRuns.findLatestGenerationForKeyword(
      { workspaceId: project.workspaceId, projectId: randomUUID() },
      csv.keywordId,
    )).resolves.toBeNull();

    await expect(generationRuns.terminalize(activeRun.attempt, {
      status: "cancelled",
      resultOutputHash: null,
      lastErrorCode: "KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT",
      lastErrorSummary: "Duplicate-run guard fixture was retired.",
    })).resolves.toMatchObject({ kind: "terminalized" });
    activeRun = await createGeneration(
      project,
      currentFrozen,
      `keyword-suggestion-final:${randomUUID()}`,
    );

    const outputHash = contentHash({ run: activeRun.runId, output: 1 });
    const invocation = await successfulInvocation(activeRun, outputHash);
    const items = suggestionsFor(activeRun, topic, project);
    expect(items).toHaveLength(2);
    await expect(suggestions.insertBatch(scope(project), {
      generationRunId: activeRun.runId,
      inputHash: activeRun.inputHash,
      outputHash,
      analysisInvocationId: invocation.invocationId,
      suggestions: items.slice(0, 1),
    })).resolves.toEqual({ kind: "conflict" });
    await expect(suggestions.insertBatch(scope(project), {
      generationRunId: activeRun.runId,
      inputHash: activeRun.inputHash,
      outputHash,
      analysisInvocationId: randomUUID(),
      suggestions: items,
    })).resolves.toEqual({ kind: "conflict" });
    await expect(suggestions.insertBatch(scope(project), {
      generationRunId: activeRun.runId,
      inputHash: activeRun.inputHash,
      outputHash,
      analysisInvocationId: invocation.invocationId,
      suggestions: items.map((item, index) =>
        index === 0
          ? { ...item, mappedSitePageId: randomUUID() }
          : item),
    })).resolves.toEqual({ kind: "stale_authority" });
    await expectPgCode(rawBatch(
      project,
      activeRun,
      outputHash,
      invocation.invocationId,
      items.map((item, index) =>
        index === 0 ? { ...item, intent: "local" } : item),
    ), "23514");
    expect((await rawBatch(
      project,
      activeRun,
      outputHash,
      invocation.invocationId,
      items.map((item, index) =>
        index === 0 ? { ...item, buyerStage: "research" } : item),
    ))["kind"]).toBe("conflict");
    const beforeValid = await handle.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.keyword_review_suggestions WHERE generation_run_id = $1",
      [activeRun.runId],
    );
    expect(beforeValid.rows[0]?.count).toBe("0");

    const inserted = await suggestions.insertBatch(scope(project), {
      generationRunId: activeRun.runId,
      inputHash: activeRun.inputHash,
      outputHash,
      analysisInvocationId: invocation.invocationId,
      suggestions: items,
    });
    expect(inserted.kind).toBe("inserted");
    if (inserted.kind !== "inserted") throw new Error("batch insert failed");
    await expect(suggestions.insertBatch(scope(project), {
      generationRunId: activeRun.runId,
      inputHash: activeRun.inputHash,
      outputHash,
      analysisInvocationId: invocation.invocationId,
      suggestions: items,
    })).resolves.toMatchObject({ kind: "replayed" });
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.keyword_review_suggestions SET suggested_reason = 'Changed' WHERE id = $1",
        [inserted.suggestions[0]!.id],
      ),
      "23514",
    );
    await expect(generationRuns.terminalize(activeRun.attempt, {
      status: "completed",
      resultOutputHash: outputHash,
      lastErrorCode: null,
      lastErrorSummary: null,
    })).resolves.toMatchObject({ kind: "terminalized" });

    await expect(suggestions.findReusableCompletedBatch(
      scope(project),
      activeRun.inputHash,
    )).resolves.toMatchObject({
      kind: "reusable",
      generationRunId: activeRun.runId,
    });
    await expect(suggestions.findCurrentReusableCompletedBatch(
      scope(project),
    )).resolves.toMatchObject({
      kind: "reusable",
      generationRunId: activeRun.runId,
    });
    const firstCandidate = activeRun.manifest.candidates[0]!;
    const secondCandidate = activeRun.manifest.candidates[1]!;
    const firstSuggestion = inserted.suggestions.find(
      (row) => row.keyword_entity_id === firstCandidate.keywordId,
    )!;
    const secondSuggestion = inserted.suggestions.find(
      (row) => row.keyword_entity_id === secondCandidate.keywordId,
    )!;
    await expect(suggestions.findCurrentPendingReadiness(
      scope(project),
      firstCandidate.keywordId,
    )).resolves.toMatchObject({
      kind: "ready",
      suggestion: { id: firstSuggestion.id },
      topicLabel: topic.label,
      mappedSitePageTitle: project.pageUrl,
    });
    await expect(generationRuns.findLatestGenerationForKeyword(
      scope(project),
      firstCandidate.keywordId,
    )).resolves.toMatchObject({
      generationRunId: activeRun.runId,
      status: "completed",
      safeTerminalCode: null,
      authorityCurrent: true,
      hasSuggestion: true,
    });
    await expect(generationRuns.readPrimaryFreezeAuthority(
      scope(project),
    )).resolves.toEqual({ kind: "no_candidates" });

    const governance = new KeywordGovernanceRepository(handle.db);
    const approved = await governance.approveSuggestion(
      scope(project),
      firstCandidate.keywordId,
      firstSuggestion.id,
      project.actorId,
      {
        expectedGovernanceRevision: 0,
        suggestionVersion: "keyword-governance-suggestion.v1",
      },
    );
    expect(approved).toMatchObject({
      replayed: false,
      decision: {
        governanceRevision: 1,
        decisionOrigin: "user",
        decidedBy: project.actorId,
      },
    });
    await expect(governance.approveSuggestion(
      scope(project),
      firstCandidate.keywordId,
      firstSuggestion.id,
      project.actorId,
      {
        expectedGovernanceRevision: 0,
        suggestionVersion: "keyword-governance-suggestion.v1",
      },
    )).resolves.toMatchObject({ replayed: true });

    await occurrences.upsertIntoLibrary(
      scope(project),
      manualOccurrence(
        secondCandidate.displayKeyword,
        "2026-08-10T05:00:00.000Z",
      ),
    );
    const staleApproval = await governance.approveSuggestion(
      scope(project),
      secondCandidate.keywordId,
      secondSuggestion.id,
      project.actorId,
      {
        expectedGovernanceRevision: 0,
        suggestionVersion: "keyword-governance-suggestion.v1",
      },
    ).catch((error: unknown) => error);
    expect(staleApproval).toBeInstanceOf(KeywordGovernanceConflictError);
    expect((staleApproval as KeywordGovernanceConflictError).code).toBe(
      "REVISION_CONFLICT",
    );
    const rolledBack = await handle.pool.query<{
      mapping_revision: number;
      decision_count: string;
      suggestion_status: string;
    }>(
      `SELECT keyword.mapping_revision,
              (SELECT count(*)::text
                 FROM app.keyword_review_decisions decision
                WHERE decision.keyword_entity_id = keyword.id) AS decision_count,
              suggestion.status AS suggestion_status
         FROM app.keyword_entities keyword
         JOIN app.keyword_review_suggestions suggestion
           ON suggestion.keyword_entity_id = keyword.id
        WHERE keyword.id = $1 AND suggestion.id = $2`,
      [secondCandidate.keywordId, secondSuggestion.id],
    );
    expect(rolledBack.rows[0]).toEqual({
      mapping_revision: 0,
      decision_count: "1",
      suggestion_status: "pending",
    });
    await expect(governance.reviewKeyword(
      scope(project),
      secondCandidate.keywordId,
      project.actorId,
      {
        expectedGovernanceRevision: 0,
        status: "approved",
        intent: "commercial",
        buyerStage: "decision",
        topicNodeId: topic.topicNodeId,
        topicModelRevision: topic.revision,
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        reason: "Human edited the stale recommendation before approval.",
      },
    )).resolves.toMatchObject({ replayed: false });
    const resolutions = await handle.pool.query<{
      id: string;
      status: string;
      resolution_mode: string | null;
    }>(
      `SELECT id, status, resolution_mode
         FROM app.keyword_review_suggestions
        WHERE generation_run_id = $1
        ORDER BY output_ordinal`,
      [activeRun.runId],
    );
    expect(resolutions.rows).toEqual(expect.arrayContaining([
      { id: firstSuggestion.id, status: "approved", resolution_mode: "accepted" },
      { id: secondSuggestion.id, status: "approved", resolution_mode: "edited" },
    ]));
    await expect(suggestions.findCurrentReusableCompletedBatch(
      scope(project),
    )).resolves.toEqual({ kind: "not_found" });
    await expect(generationRuns.findLatestGenerationForKeyword(
      scope(project),
      firstCandidate.keywordId,
    )).resolves.toMatchObject({
      status: "completed",
      authorityCurrent: false,
      hasSuggestion: true,
    });

    const initialDecision = await handle.pool.query<{
      decision_origin: string;
      decided_by: string | null;
    }>(
      `SELECT decision_origin, decided_by
         FROM app.keyword_review_decisions
        WHERE keyword_entity_id = $1 AND governance_revision = 0`,
      [secondOccurrence.entityId],
    );
    expect(initialDecision.rows[0]).toEqual({
      decision_origin: "system_suggestion",
      decided_by: null,
    });
  }, 120_000);
});
