import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDbHandle, type Db, type DbHandle } from "@sf/db/client";
import {
  ActionsRepository,
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  FlowShadowQaGatesRepository,
  FlowShadowResearchPacksRepository,
  SourceConnectionsRepository,
  type ProjectScope,
} from "@sf/db";
import {
  asyncRuns,
  capabilityRuns,
  clientProjects,
  flowShadowRuns,
  icpProfiles,
  sites,
  workspaces,
} from "@sf/db/schema";
import {
  CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
  type CreateContentShadowRunRequest,
} from "@sf/contracts";
import {
  claimIdForRule,
  qaRuleKind,
  CONTENT_SHADOW_ADAPTER_VERSION,
  QA_BRIEF_OUTLINE_CLAIM_ID,
  QA_RULE_ORDER,
  QA_RULE_SEVERITY,
} from "@sf/flow-shadow";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import { ProblemError } from "@sf/observability";
import {
  createContentShadowRun,
  getContentShadowRun,
  listContentShadowRuns,
} from "@/lib/services/content-shadow";
import { reviewContentShadowRevision } from "@/lib/services/content-shadow-review";
import { updateProjectArtifact } from "@/lib/services/artifact-update";
import { listProjectArtifacts } from "@/lib/services/artifacts";

/**
 * `createContentShadowRun` / `getContentShadowRun` against a real local
 * Postgres. The assertions target the Slice 2 contract rather than the happy
 * path alone: the provenance write order, the anti-second-confirmation refusals
 * (red line B), and 404-not-403 cross-tenant isolation.
 */

const queueFixture = vi.hoisted(() => ({
  // Typed with the queue name so the enqueue target itself is assertable.
  send: vi.fn(async (_queue: string, ..._rest: unknown[]) => randomUUID()),
}));
vi.mock("@/lib/boss", () => ({ getBoss: async () => queueFixture }));

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CRAWL_METHOD_VERSION = "crawl.site_graph.v2";
const CRAWL_DATASET_KEY = "crawl.site_graph.v1";
const CLUSTER_KEY = "onboarding";

interface ShadowFixture {
  readonly scope: ProjectScope;
  readonly actorId: string;
  readonly siteId: string;
  readonly findingId: string;
  readonly actionId: string;
  readonly briefArtifactId: string;
  readonly diagnosticRunId: string;
  readonly keywordId: string;
  readonly generativeKeywordId: string;
}

async function insertKeyword(
  handle: DbHandle,
  scope: ProjectScope,
  opts: {
    queryKind: "search_query" | "generative_query";
    clusterKey: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  const keyword = `kw-${id.slice(0, 8)}`;
  await handle.pool.query(
    `INSERT INTO app.keyword_entities (
       id, workspace_id, project_id, display_keyword, normalized_keyword,
       market, language_tag, query_kind, cluster_key, first_seen_at, last_seen_at
     ) VALUES ($1,$2,$3,$4,$5,'US','en',$6,$7, now(), now())`,
    [
      id,
      scope.workspaceId,
      scope.projectId,
      keyword,
      keyword,
      opts.queryKind,
      opts.clusterKey,
    ],
  );
  return id;
}

async function seedShadowFixture(handle: DbHandle): Promise<ShadowFixture> {
  const db: Db = handle.db;
  const actorId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const icpProfileId = randomUUID();
  const icpProfile = {
    productName: "Shadow service fixture",
    siteLanguageCodes: ["en"],
  };
  const icpContentHash = contentHash(icpProfile);
  const scope: ProjectScope = { workspaceId, projectId };
  const capturedAt = new Date().toISOString();
  const sourceWindow = { start: null, end: null };

  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: `Shadow-svc ${workspaceId}` });
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

  const collectionRunId = randomUUID();
  await db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: workspaceId,
    project_id: projectId,
    kind: "collection",
    status: "completed",
    initiated_by: actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const collectionRuns = new CollectionRunsRepository(db);
  await collectionRuns.insertPlaceholder({
    runId: collectionRunId,
    workspaceId,
    projectId,
    siteId,
    sourceConnectionId: crawlSource.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(db).insert({
    workspaceId,
    projectId,
    siteId,
    collectionRunId,
    sourceConnectionId: crawlSource.id,
    provider: "crawl",
    datasetKey: CRAWL_DATASET_KEY,
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow,
    availability: "available",
    limitation: "Content shadow service fixture.",
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

  const diagnosticRunId = randomUUID();
  await db.insert(asyncRuns).values({
    id: diagnosticRunId,
    workspace_id: workspaceId,
    project_id: projectId,
    kind: "diagnostic",
    status: "completed",
    initiated_by: actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const inputManifest = {
    projectId,
    siteId,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en",
    icp: { id: icpProfileId, version: 1, contentHash: icpContentHash },
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
    runId: diagnosticRunId,
    workspaceId,
    projectId,
    siteId,
    icpProfileId,
    icpProfileVersion: 1,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    outputLocale: "en",
    inputManifest,
    inputHash: contentHash(inputManifest),
  });

  const finding = await new FindingsRepository(db).insert({
    workspaceId,
    projectId,
    findingKey: contentHash({ fixtureId: randomUUID() }),
    ruleId: "CONTENT-COVERAGE-001",
    ruleVersion: 1,
    ruleFamily: "content-coverage",
    intent: "improve_coverage",
    domain: "content_intent",
    titleKey: "finding.content_coverage",
    titleArgs: { cluster: CLUSTER_KEY },
    summary: "A traced content coverage finding.",
    summaryLocale: "en",
    subjectRefs: [`keyword_cluster:${CLUSTER_KEY}`],
    severity: "high",
    confidence: "high",
    reviewState: "confirmed",
    runId: diagnosticRunId,
    seenAt: capturedAt,
  });
  const evidenceRepo = new EvidenceRepository(db);
  const evidenceScope = { workspaceId, projectId, diagnosticRunId };
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
      observedAt: capturedAt,
      limitation: "Disposable service fixture.",
      snapshotId: snapshot.id,
      collectionRunId,
    },
  ]);
  await evidenceRepo.linkObservations(evidenceScope, [
    { findingId: finding.id, evidenceId: evidenceId!, role: "primary" },
  ]);

  const action = await new ActionsRepository(db).insert({
    workspaceId,
    projectId,
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
      workspaceId,
      projectId,
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
      workspaceId,
      projectId,
      briefArtifactId,
      "# Content brief revision 1",
      contentHash({ briefArtifactId, revision: 1 }),
    ],
  );

  return {
    scope,
    actorId,
    siteId,
    findingId: finding.id,
    actionId: action.id,
    briefArtifactId,
    diagnosticRunId,
    keywordId: await insertKeyword(handle, scope, {
      queryKind: "search_query",
      clusterKey: CLUSTER_KEY,
    }),
    generativeKeywordId: await insertKeyword(handle, scope, {
      queryKind: "generative_query",
      clusterKey: null,
    }),
  };
}

/**
 * Install the draft revision a given shadow run produced, exactly the way the
 * worker does it: through an `analysis_invocations` row bound to that run, so
 * the revision carries append-only run lineage.
 */
async function seedRunScopedDraft(
  handle: DbHandle,
  fixture: ShadowFixture,
  asyncRunId: string,
  options: { readonly contentText: string; readonly artifactId?: string },
): Promise<{ artifactId: string; revision: number }> {
  const artifacts = new ExecutionArtifactsRepository(handle.db);
  const artifact = options.artifactId
    ? await artifacts.findById(fixture.scope, options.artifactId)
    : await artifacts.insert({
        workspaceId: fixture.scope.workspaceId,
        projectId: fixture.scope.projectId,
        actionId: fixture.actionId,
        artifactType: "english_blog_draft",
        generationMode: "structured_llm",
        outputLocale: "en",
        latestGenerationRunId: asyncRunId,
        createdBy: fixture.actorId,
      });
  if (!artifact) throw new Error("draft fixture artifact is missing");
  if (options.artifactId) {
    await artifacts.startRegenerationIfLive(
      fixture.scope,
      artifact.id,
      asyncRunId,
      { generationMode: "structured_llm", outputLocale: "en" },
    );
  }
  const invocationId = await new AnalysisInvocationsRepository(
    handle.db,
  ).insert({
    workspaceId: fixture.scope.workspaceId,
    projectId: fixture.scope.projectId,
    asyncRunId,
    task: "content_shadow_draft",
    provider: "openai",
    model: "gpt-4o-mini",
    promptSetVersion: PROMPT_SET_VERSION,
    inputHash: contentHash({ asyncRunId }),
    outputHash: contentHash({ asyncRunId, out: true }),
    status: "succeeded",
    inputTokens: 1,
    outputTokens: 1,
    costUsd: null,
    latencyMs: 1,
    errorCode: null,
  });
  const revision = artifact.current_revision + 1;
  await new ExecutionArtifactsRepository(
    handle.db,
  ).setGeneratedForGenerationRun(fixture.scope, artifact.id, asyncRunId, {
    status: "draft",
    currentRevision: revision,
    expectedRevision: artifact.current_revision,
    validationState: "valid",
    contentHash: contentHash({ text: options.contentText }),
  });
  await new ExecutionArtifactsRepository(handle.db).insertRevision({
    workspaceId: fixture.scope.workspaceId,
    projectId: fixture.scope.projectId,
    artifactId: artifact.id,
    revision,
    outputLocale: "en",
    contentFormat: "markdown",
    contentText: options.contentText,
    contentJson: null,
    contentHash: contentHash({ text: options.contentText }),
    generatedBy: "llm",
    editorId: null,
    analysisInvocationId: invocationId,
    note: null,
    validationErrors: [],
  });
  return { artifactId: artifact.id, revision };
}

async function seedResearchPack(
  handle: DbHandle,
  fixture: ShadowFixture,
  flowShadowRunId: string,
): Promise<void> {
  const pack = { sources: [], limitations: [] };
  await new FlowShadowResearchPacksRepository(handle.db).insert({
    workspaceId: fixture.scope.workspaceId,
    projectId: fixture.scope.projectId,
    flowShadowRunId,
    analysisInvocationId: null,
    contentHash: contentHash(pack),
    pack,
  });
}

async function seedQaGate(
  handle: DbHandle,
  fixture: ShadowFixture,
  flowShadowRunId: string,
  draft: { artifactId: string; revision: number },
): Promise<void> {
  await new FlowShadowQaGatesRepository(handle.db).insert({
    workspaceId: fixture.scope.workspaceId,
    projectId: fixture.scope.projectId,
    flowShadowRunId,
    evaluatedArtifactId: draft.artifactId,
    evaluatedRevision: draft.revision,
    analysisInvocationId: null,
    verdict: "needs_review",
    claims: [],
  });
}

async function setRunStatus(
  handle: DbHandle,
  asyncRunId: string,
  status: string,
): Promise<void> {
  await handle.pool.query(
    "UPDATE app.async_runs SET status = $2, started_at = now(), completed_at = CASE WHEN $2 IN ('completed','failed','cancelled','partial') THEN now() ELSE null END WHERE id = $1",
    [asyncRunId, status],
  );
}

function requestBody(
  fixture: ShadowFixture,
  overrides: Partial<CreateContentShadowRunRequest> = {},
): CreateContentShadowRunRequest {
  return {
    actionId: fixture.actionId,
    competitorEntityIds: [],
    searchCluster: {
      clusterKey: CLUSTER_KEY,
      keywordEntityIds: [fixture.keywordId],
    },
    generativeQueryEntityIds: [fixture.generativeKeywordId],
    outputLocale: "en",
    capabilityContractVersion: CONTENT_SHADOW_CAPABILITY_CONTRACT_VERSION,
    ...overrides,
  } as CreateContentShadowRunRequest;
}

describeDb("createContentShadowRun", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("writes async_run, capability_run and flow_shadow_run through the provenance guard", async () => {
    queueFixture.send.mockClear();
    const fixture = await seedShadowFixture(handle);

    const accepted = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      requestBody(fixture),
    );

    expect(accepted.status).toBe(202);
    expect(accepted.resourceRef.type).toBe("flow_shadow_run");
    expect(accepted.replayed).toBe(false);
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
    expect(queueFixture.send.mock.calls[0]?.[0]).toBe("content-shadow");

    const runId = accepted.run.id;
    const asyncRow = await handle.db
      .select({ kind: asyncRuns.kind, activeKey: asyncRuns.active_key })
      .from(asyncRuns)
      .where(eq(asyncRuns.id, runId));
    expect(asyncRow[0]).toEqual({
      kind: "content_shadow",
      activeKey: `content_shadow:${fixture.actionId}`,
    });

    const capabilityRow = await handle.db
      .select({
        capabilityId: capabilityRuns.capability_id,
        mode: capabilityRuns.mode,
        sideEffectClass: capabilityRuns.side_effect_class,
      })
      .from(capabilityRuns)
      .where(eq(capabilityRuns.async_run_id, runId));
    expect(capabilityRow[0]).toEqual({
      capabilityId: "content-shadow",
      mode: "shadow",
      sideEffectClass: "internal_write",
    });

    const shadowRow = await handle.db
      .select({
        id: flowShadowRuns.id,
        siteId: flowShadowRuns.site_id,
        sourceFindingId: flowShadowRuns.source_finding_id,
        sourceActionId: flowShadowRuns.source_action_id,
        briefArtifactId: flowShadowRuns.content_brief_artifact_id,
        briefRevision: flowShadowRuns.content_brief_revision,
        adapterVersion: flowShadowRuns.flow_adapter_version,
        contentHash: flowShadowRuns.content_hash,
      })
      .from(flowShadowRuns)
      .where(eq(flowShadowRuns.capability_run_id, runId));
    expect(shadowRow[0]).toMatchObject({
      id: accepted.resourceRef.id,
      siteId: fixture.siteId,
      sourceFindingId: fixture.findingId,
      sourceActionId: fixture.actionId,
      briefArtifactId: fixture.briefArtifactId,
      briefRevision: 1,
      adapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    });
    expect(shadowRow[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);

    // Red line B: no Action was created and no Finding review state moved.
    const actionCount = await handle.pool.query(
      "SELECT count(*)::int AS count FROM app.actions WHERE project_id = $1",
      [fixture.scope.projectId],
    );
    expect(actionCount.rows[0].count).toBe(1);
    const finding = await new FindingsRepository(handle.db).findById(
      fixture.scope,
      fixture.findingId,
    );
    expect(finding).toMatchObject({
      review_state: "confirmed",
      review_revision: 0,
    });
  });

  it("replays the same Idempotency-Key without queueing a second run", async () => {
    queueFixture.send.mockClear();
    const fixture = await seedShadowFixture(handle);
    const key = randomUUID();
    const body = requestBody(fixture);

    const first = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      key,
      body,
    );
    const second = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      key,
      body,
    );

    expect(second.replayed).toBe(true);
    expect(second.resourceRef.id).toBe(first.resourceRef.id);
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
  });

  it("conflicts when a Content Shadow run is already active for the Action", async () => {
    queueFixture.send.mockClear();
    const fixture = await seedShadowFixture(handle);
    const first = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      requestBody(fixture),
    );

    await expect(
      createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture),
      ),
    ).rejects.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
      // Read out of the FIRST call's response, so this asserts that the
      // conflict points at the run that actually won -- not merely that some
      // identifier is present. `Location` is a header; a body-only client
      // would otherwise have nothing to follow.
      current: {
        runId: first.run.id,
        statusUrl: expect.stringContaining(first.run.id),
      },
    });
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
  });

  it("does not claim an active run when the unique race leaves no winner", async () => {
    queueFixture.send.mockClear();
    const fixture = await seedShadowFixture(handle);
    await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      requestBody(fixture),
    );

    // A real run IS active, so the real unique index aborts the second insert.
    // Blinding `findActive` on both reads reproduces the race the branch is
    // for: the index fires only when a run WAS active, and `findActive` sees
    // only `queued`/`running`, so the winner can leave both states in between.
    const blinded = vi
      .spyOn(AsyncRunsRepository.prototype, "findActive")
      .mockResolvedValue(null);
    try {
      // A different output locale is a different content address, which red
      // line C explicitly permits, so the request gets past the dedup guard
      // and reaches the per-Action active-key index that the live run holds.
      const body = requestBody(fixture, { outputLocale: "zh-CN" });
      const error = await createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        body,
      ).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: "RUN_ALREADY_ACTIVE",
        status: 409,
        current: {
          runId: null,
          statusUrl: null,
          activeKey: expect.stringContaining(body.actionId),
        },
        extraHeaders: undefined,
      });
      expect((error as Error).message).not.toContain("is already active");
    } finally {
      blinded.mockRestore();
    }
    expect(queueFixture.send).toHaveBeenCalledTimes(1);
  });

  it("refuses to run for a Finding that was never confirmed (red line B)", async () => {
    queueFixture.send.mockClear();
    const fixture = await seedShadowFixture(handle);
    await handle.pool.query(
      "UPDATE app.findings SET review_state = 'unreviewed' WHERE id = $1",
      [fixture.findingId],
    );

    await expect(
      createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture),
      ),
    ).rejects.toMatchObject({ code: "CONTEXT_INCOMPLETE", status: 422 });
    // It refuses; it never confirms on the caller's behalf.
    const finding = await new FindingsRepository(handle.db).findById(
      fixture.scope,
      fixture.findingId,
    );
    expect(finding?.review_state).toBe("unreviewed");
    expect(queueFixture.send).not.toHaveBeenCalled();
  });

  it("refuses a dismissed Action", async () => {
    const fixture = await seedShadowFixture(handle);
    await handle.pool.query(
      "UPDATE app.actions SET status = 'dismissed' WHERE id = $1",
      [fixture.actionId],
    );

    await expect(
      createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture),
      ),
    ).rejects.toMatchObject({ code: "ACTION_NOT_EXECUTABLE", status: 422 });
  });

  it("rejects a search keyword outside the frozen cluster", async () => {
    const fixture = await seedShadowFixture(handle);
    const foreign = await insertKeyword(handle, fixture.scope, {
      queryKind: "search_query",
      clusterKey: "other-cluster",
    });

    await expect(
      createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture, {
          searchCluster: {
            clusterKey: CLUSTER_KEY,
            keywordEntityIds: [fixture.keywordId, foreign],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("rejects a generative entity smuggled into the search cluster (invariant 8)", async () => {
    const fixture = await seedShadowFixture(handle);

    await expect(
      createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture, {
          searchCluster: {
            clusterKey: CLUSTER_KEY,
            keywordEntityIds: [fixture.generativeKeywordId],
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });

  it("refuses a byte-identical rerun once the first run is terminal and points at it", async () => {
    // Natural operator path: the first run finished (its active key is already
    // released), and the operator resubmits the same parameters under a fresh
    // Idempotency-Key. `flow_shadow_runs` is content-addressed, so this is a
    // request for a run that already exists — it must be a clean conflict that
    // names it, never an unreadable repository fault.
    queueFixture.send.mockClear();
    const fixture = await seedShadowFixture(handle);
    const first = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      requestBody(fixture),
    );
    await setRunStatus(handle, first.run.id, "completed");

    await expect(
      createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture),
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect(queueFixture.send).toHaveBeenCalledTimes(1);

    // The refused attempt left nothing behind: no orphan canonical run and no
    // second shadow row.
    const rows = await handle.pool.query(
      "SELECT (SELECT count(*)::int FROM app.async_runs WHERE project_id = $1 AND kind = 'content_shadow') AS runs, (SELECT count(*)::int FROM app.flow_shadow_runs WHERE project_id = $1) AS shadows",
      [fixture.scope.projectId],
    );
    expect(rows.rows[0]).toEqual({ runs: 1, shadows: 1 });

    // The forward path decision D2 approves stays open: vary any frozen input
    // and the tuple has a different content address.
    const varied = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      requestBody(fixture, { generativeQueryEntityIds: [] }),
    );
    expect(varied.status).toBe(202);
    expect(varied.resourceRef.id).not.toBe(first.resourceRef.id);
  });

  it("refuses a Finding that owns a second live Action (red line B)", async () => {
    const fixture = await seedShadowFixture(handle);
    // A second canonical Action for one confirmed Finding would mean a second
    // confirmation path exists.
    await new ActionsRepository(handle.db).insert({
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      sourceFindingId: fixture.findingId,
      sourceDiagnosticRunId: fixture.diagnosticRunId,
      actionKey: contentHash({ fixtureId: randomUUID() }),
      templateId: `content_brief.${randomUUID()}`,
      templateVersion: 1,
      title: "A competing Action",
      description: "A second Action for the same confirmed Finding.",
      contentLocale: "en",
      priorityBand: "high",
      roadmapLane: "now",
      status: "planned",
      effort: "medium",
      risk: "low",
      expectedOutcome: "Never reached.",
      evidenceRefs: [],
      createdBy: fixture.actorId,
    });

    await expect(
      createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture),
      ),
    ).rejects.toMatchObject({ code: "FINDING_ACTION_ACTIVE", status: 409 });
  });

  it("rejects a competitor from another project", async () => {
    const fixture = await seedShadowFixture(handle);
    const other = await seedShadowFixture(handle);
    const foreignCompetitorId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.competitor_entities (id, workspace_id, project_id, domain)
       VALUES ($1,$2,$3,$4)`,
      [
        foreignCompetitorId,
        other.scope.workspaceId,
        other.scope.projectId,
        "competitor.example",
      ],
    );

    await expect(
      createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture, {
          competitorEntityIds: [foreignCompetitorId],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
  });
});

describeDb("getContentShadowRun", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("projects a queued run with derived phase and no child rows yet", async () => {
    const fixture = await seedShadowFixture(handle);
    const accepted = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      requestBody(fixture),
    );

    const projection = await getContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      accepted.resourceRef.id,
    );

    expect(projection).toMatchObject({
      flowShadowRunId: accepted.resourceRef.id,
      siteId: fixture.siteId,
      status: "queued",
      phase: "queued",
      flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
      research: null,
      draft: null,
      qa: null,
    });
    expect(projection.frozenInputs.searchCluster).toEqual({
      clusterKey: CLUSTER_KEY,
      keywordEntityIds: [fixture.keywordId],
    });
    expect(projection.frozenInputs.generativeQueryEntityIds).toEqual([
      fixture.generativeKeywordId,
    ]);
    // Task 6b: the frozen first-party identity is reported because the QA
    // gate's link judgement resolves against it, and the research pack that
    // also carries it does not exist until the run reaches its research phase.
    expect(projection.frozenInputs.firstParty).toEqual({
      siteOrigin: `https://${fixture.scope.projectId}.example.test`,
      icpPrimaryConversionUrl: null,
    });
    // Task 7's O-4: the brief-derived COVERAGE CHECKLIST, which the
    // side-by-side review has to render as itself.
    expect(projection.frozenInputs.contentBriefOutline).toMatchObject({
      pageAssignment: expect.any(String),
    });
    expect(
      Array.isArray(projection.frozenInputs.contentBriefOutline.briefSections),
    ).toBe(true);
    expect(projection.source).toMatchObject({
      findingId: fixture.findingId,
      actionId: fixture.actionId,
      contentBriefArtifactId: fixture.briefArtifactId,
      contentBriefRevision: 1,
    });
  });

  /** One accepted run plus a handle on both ids the projection is keyed by. */
  async function startRun(
    fixture: ShadowFixture,
    overrides: Partial<CreateContentShadowRunRequest> = {},
  ): Promise<{ asyncRunId: string; flowShadowRunId: string }> {
    const accepted = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      requestBody(fixture, overrides),
    );
    return {
      asyncRunId: accepted.run.id,
      flowShadowRunId: accepted.resourceRef.id,
    };
  }

  const read = (fixture: ShadowFixture, flowShadowRunId: string) =>
    getContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      flowShadowRunId,
    );

  it("derives phase research once the run's pack exists", async () => {
    const fixture = await seedShadowFixture(handle);
    const run = await startRun(fixture);
    await setRunStatus(handle, run.asyncRunId, "running");
    await seedResearchPack(handle, fixture, run.flowShadowRunId);

    const projection = await read(fixture, run.flowShadowRunId);
    expect(projection.phase).toBe("research");
    expect(projection.research).not.toBeNull();
    expect(projection.draft).toBeNull();
  });

  it("surfaces a failed brief-outline extraction verbatim in the read projection", async () => {
    // Decision O-4, third leg: the failure must reach the API, not only the
    // stored pack. `research.limitations` is the contract field that carries it,
    // which is why this needed no OpenAPI change.
    const fixture = await seedShadowFixture(handle);
    const run = await startRun(fixture);
    const failureLimitation =
      "Content brief outline extraction FAILED: the pinned brief revision carried no machine-readable `## ` section heading, so this draft was NOT guided by the brief. Review the draft against the brief by hand.";
    const pack = { sources: [], limitations: [failureLimitation] };
    await new FlowShadowResearchPacksRepository(handle.db).insert({
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      flowShadowRunId: run.flowShadowRunId,
      analysisInvocationId: null,
      contentHash: contentHash(pack),
      pack,
    });

    const projection = await read(fixture, run.flowShadowRunId);

    expect(projection.research?.limitations).toEqual([failureLimitation]);
  });

  it("derives phase draft once the run installs its own revision", async () => {
    const fixture = await seedShadowFixture(handle);
    const run = await startRun(fixture);
    await setRunStatus(handle, run.asyncRunId, "running");
    await seedResearchPack(handle, fixture, run.flowShadowRunId);
    await seedRunScopedDraft(handle, fixture, run.asyncRunId, {
      contentText: "# Draft body",
    });

    const projection = await read(fixture, run.flowShadowRunId);
    expect(projection.phase).toBe("draft");
    expect(projection.draft).toMatchObject({
      currentRevision: 1,
      contentText: "# Draft body",
      status: "draft",
    });
    expect(projection.qa).toBeNull();
  });

  it("derives phase qa while the QA gate exists but the run has not completed", async () => {
    const fixture = await seedShadowFixture(handle);
    const run = await startRun(fixture);
    await setRunStatus(handle, run.asyncRunId, "running");
    await seedResearchPack(handle, fixture, run.flowShadowRunId);
    const draft = await seedRunScopedDraft(handle, fixture, run.asyncRunId, {
      contentText: "# Draft body",
    });
    await seedQaGate(handle, fixture, run.flowShadowRunId, draft);

    const projection = await read(fixture, run.flowShadowRunId);
    expect(projection.phase).toBe("qa");
    expect(projection.status).toBe("running");
  });

  it("derives phase complete only when the canonical run completed", async () => {
    const fixture = await seedShadowFixture(handle);
    const run = await startRun(fixture);
    await seedResearchPack(handle, fixture, run.flowShadowRunId);
    const draft = await seedRunScopedDraft(handle, fixture, run.asyncRunId, {
      contentText: "# Draft body",
    });
    await seedQaGate(handle, fixture, run.flowShadowRunId, draft);
    await setRunStatus(handle, run.asyncRunId, "completed");

    const projection = await read(fixture, run.flowShadowRunId);
    expect(projection.phase).toBe("complete");
    expect(projection.qa).toMatchObject({
      verdict: "needs_review",
      evaluatedRevision: 1,
    });
  });

  it("derives phase failed from the canonical run whatever children exist", async () => {
    const fixture = await seedShadowFixture(handle);
    const failedRun = await startRun(fixture);
    await seedResearchPack(handle, fixture, failedRun.flowShadowRunId);
    await setRunStatus(handle, failedRun.asyncRunId, "failed");
    expect((await read(fixture, failedRun.flowShadowRunId)).phase).toBe(
      "failed",
    );

    const cancelled = await seedShadowFixture(handle);
    const cancelledRun = await startRun(cancelled);
    await setRunStatus(handle, cancelledRun.asyncRunId, "cancelled");
    expect((await read(cancelled, cancelledRun.flowShadowRunId)).phase).toBe(
      "failed",
    );
  });

  it("keeps a finished run bound to its own draft revision after a later run rewrites the artifact", async () => {
    const fixture = await seedShadowFixture(handle);
    const runA = await startRun(fixture);
    await seedResearchPack(handle, fixture, runA.flowShadowRunId);
    const draftA = await seedRunScopedDraft(handle, fixture, runA.asyncRunId, {
      contentText: "# Revision one body",
    });
    await seedQaGate(handle, fixture, runA.flowShadowRunId, draftA);
    await setRunStatus(handle, runA.asyncRunId, "completed");

    // Decision D2 allows a later shadow run for the same Action; it claims the
    // same artifact row through the canonical regeneration edge and installs
    // revision 2.
    const runB = await startRun(fixture, { generativeQueryEntityIds: [] });
    const draftB = await seedRunScopedDraft(handle, fixture, runB.asyncRunId, {
      contentText: "# Revision two body",
      artifactId: draftA.artifactId,
    });
    expect(draftB.revision).toBe(2);

    const projectionA = await read(fixture, runA.flowShadowRunId);
    // The finished run still reports the body its own QA verdict judged.
    expect(projectionA.draft).toMatchObject({
      artifactId: draftA.artifactId,
      currentRevision: 1,
      contentText: "# Revision one body",
    });
    expect(projectionA.qa).toMatchObject({ evaluatedRevision: 1 });
    expect(projectionA.draft?.currentRevision).toBe(
      projectionA.qa?.evaluatedRevision,
    );
    // The run-scoped body stays pinned to revision 1, while the customer can
    // still inspect the artifact's complete immutable ledger newest-first.
    expect(
      projectionA.draft?.revisionHistory.map((revision) => revision.revision),
    ).toEqual([2, 1]);

    const projectionB = await read(fixture, runB.flowShadowRunId);
    expect(projectionB.draft).toMatchObject({
      artifactId: draftA.artifactId,
      currentRevision: 2,
      contentText: "# Revision two body",
    });
  });

  it("reports a queued run as queued even when the Action already has a live draft", async () => {
    const fixture = await seedShadowFixture(handle);
    const runA = await startRun(fixture);
    await seedResearchPack(handle, fixture, runA.flowShadowRunId);
    const draftA = await seedRunScopedDraft(handle, fixture, runA.asyncRunId, {
      contentText: "# Revision one body",
    });
    await seedQaGate(handle, fixture, runA.flowShadowRunId, draftA);
    await setRunStatus(handle, runA.asyncRunId, "completed");

    // A brand new run that the worker has not touched must not inherit the
    // predecessor's draft and skip straight past the research phase.
    const runB = await startRun(fixture, { generativeQueryEntityIds: [] });
    const projectionB = await read(fixture, runB.flowShadowRunId);
    expect(projectionB.status).toBe("queued");
    expect(projectionB.phase).toBe("queued");
    expect(projectionB.draft).toBeNull();
    expect(projectionB.research).toBeNull();
    expect(projectionB.qa).toBeNull();
  });

  it("reports a run from another workspace as absent, never forbidden", async () => {
    const fixture = await seedShadowFixture(handle);
    const other = await seedShadowFixture(handle);
    const accepted = await createContentShadowRun(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      fixture.actorId,
      randomUUID(),
      requestBody(fixture),
    );

    await expect(
      getContentShadowRun(
        { workspaceId: other.scope.workspaceId },
        other.scope.projectId,
        accepted.resourceRef.id,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      getContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ProblemError);
  });
});

async function startShadowRun(
  fixture: ShadowFixture,
): Promise<{ asyncRunId: string; flowShadowRunId: string }> {
  const accepted = await createContentShadowRun(
    { workspaceId: fixture.scope.workspaceId },
    fixture.scope.projectId,
    fixture.actorId,
    randomUUID(),
    requestBody(fixture),
  );
  return {
    asyncRunId: accepted.run.id,
    flowShadowRunId: accepted.resourceRef.id,
  };
}

describeDb(
  "QA claim severity is reported, never re-derived by the reader",
  () => {
    let handle: DbHandle;

    beforeAll(() => {
      handle = createDbHandle(DATABASE_URL!);
    });
    afterAll(async () => {
      await handle?.end();
    });

    it("reports the gate package's severity for every claim, one by one", async () => {
      const fixture = await seedShadowFixture(handle);
      const run = await startShadowRun(fixture);
      const draft = await seedRunScopedDraft(handle, fixture, run.asyncRunId, {
        contentText: "# Draft body",
      });
      // Every rule the gate can emit, plus the coverage claim that is not a rule.
      const claims = [
        ...QA_RULE_ORDER.map((ruleId) => ({
          claimId: claimIdForRule(ruleId),
          kind: qaRuleKind(ruleId),
          status: "passed" as const,
          detail: `stored detail for ${ruleId}`,
        })),
        {
          claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
          kind: "coverage" as const,
          status: "unevaluated" as const,
          detail: "stored coverage detail",
        },
      ];
      await new FlowShadowQaGatesRepository(handle.db).insert({
        workspaceId: fixture.scope.workspaceId,
        projectId: fixture.scope.projectId,
        flowShadowRunId: run.flowShadowRunId,
        evaluatedArtifactId: draft.artifactId,
        evaluatedRevision: draft.revision,
        analysisInvocationId: null,
        verdict: "needs_review",
        claims,
      });

      const projection = await getContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        run.flowShadowRunId,
      );

      const wire = new Map(
        (projection.qa?.claims ?? []).map((claim) => [
          claim.claimId,
          claim.severity,
        ]),
      );
      expect(wire.size).toBe(QA_RULE_ORDER.length + 1);
      for (const ruleId of QA_RULE_ORDER) {
        // Rule by rule, against the gate's own table: a copy of this mapping
        // anywhere downstream drifts, and it drifts towards showing a blocking
        // check as a style note.
        expect(wire.get(claimIdForRule(ruleId))).toBe(QA_RULE_SEVERITY[ruleId]);
      }
      expect(wire.get(QA_BRIEF_OUTLINE_CLAIM_ID)).toBe("review");
      expect(
        [...wire.entries()]
          .filter(([, severity]) => severity === "blocking")
          .map(([claimId]) => claimId)
          .sort(),
      ).toEqual(
        [
          "content-shadow.qa.rl8_unsupported_claim",
          "content-shadow.qa.rl12_citation_integrity",
          "content-shadow.qa.sc9b_sources_resolve_to_pack",
        ].sort(),
      );
    });

    it("fails the read rather than reporting no findings when a gate row is unreadable", async () => {
      const fixture = await seedShadowFixture(handle);
      const run = await startShadowRun(fixture);
      const draft = await seedRunScopedDraft(handle, fixture, run.asyncRunId, {
        contentText: "# Draft body",
      });
      await new FlowShadowQaGatesRepository(handle.db).insert({
        workspaceId: fixture.scope.workspaceId,
        projectId: fixture.scope.projectId,
        flowShadowRunId: run.flowShadowRunId,
        evaluatedArtifactId: draft.artifactId,
        evaluatedRevision: draft.revision,
        analysisInvocationId: null,
        verdict: "needs_review",
        claims: [{ nonsense: true }],
      });

      // "We could not read the findings" must never render as "there are none".
      await expect(
        getContentShadowRun(
          { workspaceId: fixture.scope.workspaceId },
          fixture.scope.projectId,
          run.flowShadowRunId,
        ),
      ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    });
  },
);

describeDb("listContentShadowRuns", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("makes a run reachable by id after the 202 that created it is gone", async () => {
    const fixture = await seedShadowFixture(handle);
    const run = await startShadowRun(fixture);

    const page = await listContentShadowRuns(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      { limit: 50, cursor: null },
    );

    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      flowShadowRunId: run.flowShadowRunId,
      asyncRunId: run.asyncRunId,
      projectId: fixture.scope.projectId,
      outputLocale: "en",
      source: { actionId: fixture.actionId },
    });
    expect(page.nextCursor).toBeNull();
  });

  it("carries no run state at all — phase, verdict and pack stay on the detail read", async () => {
    const fixture = await seedShadowFixture(handle);
    const run = await startShadowRun(fixture);
    await seedResearchPack(handle, fixture, run.flowShadowRunId);
    const draft = await seedRunScopedDraft(handle, fixture, run.asyncRunId, {
      contentText: "# Draft body",
    });
    await seedQaGate(handle, fixture, run.flowShadowRunId, draft);
    await setRunStatus(handle, run.asyncRunId, "completed");

    const page = await listContentShadowRuns(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      { limit: 50, cursor: null },
    );

    const row = page.data[0] as Record<string, unknown>;
    for (const absent of ["phase", "status", "qa", "research", "draft"]) {
      expect(row).not.toHaveProperty(absent);
    }
  });

  /**
   * Seed `count` distinct shadow runs inside ONE project, newest last.
   *
   * Each run needs its own frozen search cluster so the content-addressed
   * tuple hashes differently (otherwise `findByContentHash` returns the first
   * run again), and each must reach a terminal status before the next starts
   * because the activeKey is per Action.
   */
  async function seedRunSequence(
    fixture: ShadowFixture,
    count: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const keywordId =
        index === 0
          ? fixture.keywordId
          : await insertKeyword(handle, fixture.scope, {
              queryKind: "search_query",
              clusterKey: CLUSTER_KEY,
            });
      const accepted = await createContentShadowRun(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        fixture.actorId,
        randomUUID(),
        requestBody(fixture, {
          searchCluster: {
            clusterKey: CLUSTER_KEY,
            keywordEntityIds: [keywordId],
          },
        }),
      );
      ids.push(accepted.resourceRef.id);
      await setRunStatus(handle, accepted.run.id, "completed");
    }
    return ids;
  }

  /**
   * The point of this test is that the cursor is actually spent: the previous
   * version of it built two runs in two DIFFERENT projects, read one row with
   * `limit: 1`, asserted `nextCursor` was null, and never passed a cursor back.
   * The whole keyset predicate — `hasNext`, `encodeCursor`, `decodeCursor`, the
   * `or(lt, and(eq, lt))` seek — ran zero times under a name that claimed it
   * paged. Three rows and a limit below the total is the smallest shape that
   * forces a second read through the cursor.
   *
   * Still uncovered, stated rather than faked: the `and(eq(created_at),
   * lt(id))` arm of the seek, which only fires when two rows share a
   * `created_at`. Rows here get their timestamp from the service's own
   * transaction, and `flow_shadow_runs` carries a BEFORE UPDATE OR DELETE
   * append-only trigger (`0020:181-183`), so a test cannot collapse the two
   * timestamps without disabling a production guard. Doing that would buy one
   * branch by weakening the thing the branch protects.
   */
  it("pages newest first through the shared cursor convention", async () => {
    const fixture = await seedShadowFixture(handle);
    const created = await seedRunSequence(fixture, 3);

    // Ground truth: one unpaged read of the same index.
    const whole = await listContentShadowRuns(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      { limit: 50, cursor: null },
    );
    const expected = whole.data.map((row) => row.flowShadowRunId);
    expect(whole.nextCursor).toBeNull();
    expect(expected).toEqual([...created].reverse());
    const stamps = whole.data.map((row) => Date.parse(row.createdAt));
    expect(stamps).toEqual([...stamps].sort((left, right) => right - left));

    // Walk the same index two at a time, feeding `nextCursor` back in.
    const walked: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof listContentShadowRuns>> =
        await listContentShadowRuns(
          { workspaceId: fixture.scope.workspaceId },
          fixture.scope.projectId,
          { limit: 2, cursor },
        );
      pages += 1;
      // A cursor that never advances would loop forever; fail instead.
      expect(pages).toBeLessThanOrEqual(3);
      expect(page.data.length).toBeGreaterThan(0);
      expect(page.data.length).toBeLessThanOrEqual(2);
      walked.push(...page.data.map((row) => row.flowShadowRunId));
      cursor = page.nextCursor;
    } while (cursor);

    expect(pages).toBe(2);
    // Same rows, same order, each exactly once: nothing repeated, nothing lost.
    expect(walked).toEqual(expected);
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("keeps another project's runs out of this project's index", async () => {
    const fixture = await seedShadowFixture(handle);
    const first = await startShadowRun(fixture);
    const second = await seedShadowFixture(handle);
    const secondRun = await startShadowRun(second);

    const firstPage = await listContentShadowRuns(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      { limit: 50, cursor: null },
    );
    expect(firstPage.data.map((row) => row.flowShadowRunId)).toEqual([
      first.flowShadowRunId,
    ]);

    const otherPage = await listContentShadowRuns(
      { workspaceId: second.scope.workspaceId },
      second.scope.projectId,
      { limit: 50, cursor: null },
    );
    expect(otherPage.data.map((row) => row.flowShadowRunId)).toEqual([
      secondRun.flowShadowRunId,
    ]);
  });

  it("reports a project in another workspace as absent, never forbidden", async () => {
    const fixture = await seedShadowFixture(handle);
    const other = await seedShadowFixture(handle);

    await expect(
      listContentShadowRuns(
        { workspaceId: other.scope.workspaceId },
        fixture.scope.projectId,
        { limit: 50, cursor: null },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("refuses a malformed cursor before reading anything", async () => {
    const fixture = await seedShadowFixture(handle);

    await expect(
      listContentShadowRuns(
        { workspaceId: fixture.scope.workspaceId },
        fixture.scope.projectId,
        { limit: 50, cursor: "not-a-cursor" },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

/**
 * A human review is a review of one revision, and it publishes nothing.
 *
 * These assertions are about refusals rather than the happy path, because the
 * refusals are where a shortcut would be invisible: a review recorded against
 * text nobody read, or a blocked draft passed because the caller asked nicely,
 * both leave a perfectly normal-looking `ready` row behind.
 */
/** The gate claims `seedReviewableRun` writes unless a test needs others. */
const DEFAULT_GATE_CLAIMS: readonly Record<string, unknown>[] = [
  {
    claimId: "content-shadow.qa.rl13_banned_jargon",
    kind: "red_line",
    status: "passed",
    detail: "No banned jargon was found.",
  },
  {
    claimId: QA_BRIEF_OUTLINE_CLAIM_ID,
    kind: "coverage",
    status: "unevaluated",
    detail: "Coverage was NOT judged.",
  },
];

async function seedReviewableRun(
  handle: DbHandle,
  verdict: "passed" | "needs_review" | "blocked",
  claims: readonly Record<string, unknown>[] = DEFAULT_GATE_CLAIMS,
): Promise<{
  fixture: ShadowFixture;
  flowShadowRunId: string;
  artifactId: string;
  revision: number;
}> {
  const fixture = await seedShadowFixture(handle);
  const run = await startShadowRun(fixture);
  const draft = await seedRunScopedDraft(handle, fixture, run.asyncRunId, {
    contentText: "# Draft body",
  });
  await new FlowShadowQaGatesRepository(handle.db).insert({
    workspaceId: fixture.scope.workspaceId,
    projectId: fixture.scope.projectId,
    flowShadowRunId: run.flowShadowRunId,
    evaluatedArtifactId: draft.artifactId,
    evaluatedRevision: draft.revision,
    analysisInvocationId: null,
    verdict,
    claims,
  });
  return {
    fixture,
    flowShadowRunId: run.flowShadowRunId,
    artifactId: draft.artifactId,
    revision: draft.revision,
  };
}

describeDb("reviewContentShadowRevision", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL!);
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("marks the reviewed revision, and reports that nothing was published", async () => {
    const seeded = await seedReviewableRun(handle, "passed");

    const receipt = await reviewContentShadowRevision(
      { workspaceId: seeded.fixture.scope.workspaceId },
      seeded.fixture.scope.projectId,
      seeded.flowShadowRunId,
      { baseRevision: seeded.revision, acknowledgeFindings: false },
    );

    expect(receipt).toMatchObject({
      artifactId: seeded.artifactId,
      reviewedRevision: seeded.revision,
      artifactStatus: "ready",
      verdict: "passed",
      // Three-way, never folded into two, and carried into the record.
      claimCounts: { passed: 1, failed: 0, unevaluated: 1 },
      externalPublishingWrite: "none",
    });

    const artifact = await new ExecutionArtifactsRepository(handle.db).findById(
      seeded.fixture.scope,
      seeded.artifactId,
    );
    expect(artifact?.status).toBe("ready");
    // The single write. No approval, checkpoint or review-event row is invented,
    // and no revision is appended: a review is not an edit.
    expect(artifact?.current_revision).toBe(seeded.revision);
  });

  it("is a true no-op when the same review is submitted twice", async () => {
    const seeded = await seedReviewableRun(handle, "passed");
    const body = { baseRevision: seeded.revision, acknowledgeFindings: false };
    const scope = { workspaceId: seeded.fixture.scope.workspaceId };

    await reviewContentShadowRevision(
      scope,
      seeded.fixture.scope.projectId,
      seeded.flowShadowRunId,
      body,
    );
    const second = await reviewContentShadowRevision(
      scope,
      seeded.fixture.scope.projectId,
      seeded.flowShadowRunId,
      body,
    );

    expect(second.artifactStatus).toBe("ready");
  });

  it("refuses a blocked draft even when the caller asks for it directly", async () => {
    const seeded = await seedReviewableRun(handle, "blocked");

    await expect(
      reviewContentShadowRevision(
        { workspaceId: seeded.fixture.scope.workspaceId },
        seeded.fixture.scope.projectId,
        seeded.flowShadowRunId,
        { baseRevision: seeded.revision, acknowledgeFindings: true },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    const artifact = await new ExecutionArtifactsRepository(handle.db).findById(
      seeded.fixture.scope,
      seeded.artifactId,
    );
    expect(artifact?.status).toBe("draft");
  });

  /**
   * The same refusal, through the OTHER door into `ready`.
   *
   * `blocked` is worth exactly as much as the weakest write that can reach
   * `ready`, and there are two: this endpoint, and the generic artifact status
   * PATCH the workspace editor uses — an editor Execution renders on the same
   * screen, directly below the quality rail that is saying the citations cannot
   * be verified. A guard on one of them is not a guard.
   *
   * The assertion is deliberately a COMPARISON of the two refusals rather than
   * two independent expectations: the failure this is written against is the
   * two paths drifting apart, which two separate assertions would not see.
   */
  it("refuses a blocked draft identically through the generic artifact status PATCH", async () => {
    const seeded = await seedReviewableRun(handle, "blocked");
    const scope = { workspaceId: seeded.fixture.scope.workspaceId };

    const viaReview = await reviewContentShadowRevision(
      scope,
      seeded.fixture.scope.projectId,
      seeded.flowShadowRunId,
      { baseRevision: seeded.revision, acknowledgeFindings: true },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    const viaPatch = await updateProjectArtifact(
      scope,
      seeded.fixture.scope.projectId,
      seeded.artifactId,
      seeded.fixture.actorId,
      { baseRevision: seeded.revision, status: "ready" },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(viaReview).toBeInstanceOf(ProblemError);
    expect(viaPatch).toBeInstanceOf(ProblemError);
    const review = viaReview as ProblemError;
    const patch = viaPatch as ProblemError;
    expect(patch.code).toBe(review.code);
    expect(patch.status).toBe(review.status);
    expect(patch.message).toBe(review.message);
    expect(patch.fieldErrors?.[0]?.code).toBe("verdict_blocked");
    expect(review.fieldErrors?.[0]?.code).toBe("verdict_blocked");

    // And neither attempt moved the deliverable.
    const artifact = await new ExecutionArtifactsRepository(handle.db).findById(
      seeded.fixture.scope,
      seeded.artifactId,
    );
    expect(artifact?.status).toBe("draft");
    expect(artifact?.current_revision).toBe(seeded.revision);
  });

  /**
   * The guard reads the verdict, not the artifact type.
   *
   * A blanket refusal on `english_blog_draft` would pass the test above while
   * breaking every draft the gate did NOT block — which is the shape of fix
   * that looks safe in a diff and removes a working path in production.
   */
  it("still lets the status PATCH mark a draft the gate did not block", async () => {
    const seeded = await seedReviewableRun(handle, "needs_review");

    const updated = await updateProjectArtifact(
      { workspaceId: seeded.fixture.scope.workspaceId },
      seeded.fixture.scope.projectId,
      seeded.artifactId,
      seeded.fixture.actorId,
      { baseRevision: seeded.revision, status: "ready" },
    );

    expect(updated.status).toBe("ready");
  });

  /**
   * The third consumer of the one judgement: the artifacts read model.
   *
   * H1 shut the second write path, which made the refusal correct. It did not
   * make it visible: the Studio "Mark ready" control renders from the artifacts
   * list, the list carried no verdict, and so an operator learned the refusal
   * by being refused. The list now carries the answer the write path would
   * give.
   *
   * The assertion COMPARES the read model against both write paths rather than
   * asserting three facts independently. Three independent expectations pass
   * happily while the three answers drift apart, and drift between copies of
   * one rule is the defect this slice produced repeatedly.
   */
  it("gives the read model and both write paths the same answer on a blocked draft", async () => {
    const seeded = await seedReviewableRun(handle, "blocked", [
      {
        claimId: "content-shadow.qa.rl12_citation_integrity",
        kind: "red_line",
        status: "failed",
        detail: "A citation resolves to nothing in the frozen pack.",
      },
      {
        // `review` severity, so it is a reason a human looks — never a reason
        // adoption is refused. It must not appear in the reasons the control
        // shows, or the screen would attribute the refusal to a check that
        // cannot cause one.
        claimId: "content-shadow.qa.rl12b_unresolved_link",
        kind: "red_line",
        status: "failed",
        detail: "A link points somewhere the frozen pack cannot confirm.",
      },
      {
        claimId: "content-shadow.qa.rl8_unsupported_claim",
        kind: "red_line",
        status: "failed",
        detail: "A statement carries no traceable source.",
      },
      {
        claimId: "content-shadow.qa.rl13_banned_jargon",
        kind: "red_line",
        status: "passed",
        detail: "No banned jargon was found.",
      },
    ]);
    const scope = { workspaceId: seeded.fixture.scope.workspaceId };

    const listed = await listProjectArtifacts(
      scope,
      seeded.fixture.scope.projectId,
      { limit: 50, cursor: null },
    );
    const draft = listed.data.find((row) => row.id === seeded.artifactId);
    expect(draft?.adoption).toEqual({
      blocked: true,
      blockingClaimIds: [
        "content-shadow.qa.rl12_citation_integrity",
        "content-shadow.qa.rl8_unsupported_claim",
      ],
    });
    // The content brief in the same list is judged by no gate at all, which is
    // not the same statement as "cleared".
    const brief = listed.data.find((row) => row.id !== seeded.artifactId);
    expect(brief?.artifactType).not.toBe("english_blog_draft");
    expect(brief?.adoption).toBeNull();

    const viaPatch = await updateProjectArtifact(
      scope,
      seeded.fixture.scope.projectId,
      seeded.artifactId,
      seeded.fixture.actorId,
      { baseRevision: seeded.revision, status: "ready" },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    const viaReview = await reviewContentShadowRevision(
      scope,
      seeded.fixture.scope.projectId,
      seeded.flowShadowRunId,
      { baseRevision: seeded.revision, acknowledgeFindings: true },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    // One conclusion, three surfaces.
    expect(draft?.adoption?.blocked).toBe(viaPatch !== null);
    expect(draft?.adoption?.blocked).toBe(viaReview !== null);
    expect((viaPatch as ProblemError).fieldErrors?.[0]?.code).toBe(
      "verdict_blocked",
    );
    expect((viaReview as ProblemError).fieldErrors?.[0]?.code).toBe(
      "verdict_blocked",
    );
  });

  /**
   * The same comparison on the other side of the judgement.
   *
   * A read model that reported `blocked` for everything would satisfy the test
   * above and disable a control the server would have accepted — the failure
   * that costs an operator a working path rather than a bad record, and the
   * one a single-sided test never sees.
   */
  it("gives the read model and the write path the same answer on a draft the gate cleared", async () => {
    const seeded = await seedReviewableRun(handle, "needs_review");
    const scope = { workspaceId: seeded.fixture.scope.workspaceId };

    const listed = await listProjectArtifacts(
      scope,
      seeded.fixture.scope.projectId,
      { limit: 50, cursor: null },
    );
    const draft = listed.data.find((row) => row.id === seeded.artifactId);
    expect(draft?.adoption).toEqual({ blocked: false, blockingClaimIds: [] });

    const updated = await updateProjectArtifact(
      scope,
      seeded.fixture.scope.projectId,
      seeded.artifactId,
      seeded.fixture.actorId,
      { baseRevision: seeded.revision, status: "ready" },
    );
    expect(updated.status).toBe("ready");
    expect(draft?.adoption?.blocked).toBe(false);
  });

  it("refuses a needs_review verdict without an explicit acknowledgement", async () => {
    const seeded = await seedReviewableRun(handle, "needs_review");
    const scope = { workspaceId: seeded.fixture.scope.workspaceId };

    await expect(
      reviewContentShadowRevision(
        scope,
        seeded.fixture.scope.projectId,
        seeded.flowShadowRunId,
        { baseRevision: seeded.revision, acknowledgeFindings: false },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    const granted = await reviewContentShadowRevision(
      scope,
      seeded.fixture.scope.projectId,
      seeded.flowShadowRunId,
      { baseRevision: seeded.revision, acknowledgeFindings: true },
    );
    expect(granted.artifactStatus).toBe("ready");
  });

  it("refuses a review aimed at a revision that is no longer current", async () => {
    const seeded = await seedReviewableRun(handle, "passed");

    await expect(
      reviewContentShadowRevision(
        { workspaceId: seeded.fixture.scope.workspaceId },
        seeded.fixture.scope.projectId,
        seeded.flowShadowRunId,
        { baseRevision: seeded.revision + 1, acknowledgeFindings: false },
      ),
    ).rejects.toMatchObject({ code: "STALE_REVISION", status: 409 });

    const artifact = await new ExecutionArtifactsRepository(handle.db).findById(
      seeded.fixture.scope,
      seeded.artifactId,
    );
    expect(artifact?.status).toBe("draft");
  });

  it("refuses when the verdict describes an earlier revision than the current one", async () => {
    const seeded = await seedReviewableRun(handle, "passed");
    // An edit lands: a new immutable revision, and the deliverable is a draft
    // again. The verdict still describes the revision before it.
    const artifacts = new ExecutionArtifactsRepository(handle.db);
    const next = seeded.revision + 1;
    await artifacts.setGeneratedIfRevision(
      seeded.fixture.scope,
      seeded.artifactId,
      {
        status: "draft",
        currentRevision: next,
        expectedRevision: seeded.revision,
        expectedStatus: "draft",
        validationState: "valid",
        contentHash: contentHash({ text: "# Edited body" }),
      },
    );
    await artifacts.insertRevision({
      workspaceId: seeded.fixture.scope.workspaceId,
      projectId: seeded.fixture.scope.projectId,
      artifactId: seeded.artifactId,
      revision: next,
      outputLocale: "en",
      contentFormat: "markdown",
      contentText: "# Edited body",
      contentJson: null,
      contentHash: contentHash({ text: "# Edited body" }),
      generatedBy: "operator",
      editorId: seeded.fixture.actorId,
      analysisInvocationId: null,
      note: null,
      validationErrors: [],
    });

    await expect(
      reviewContentShadowRevision(
        { workspaceId: seeded.fixture.scope.workspaceId },
        seeded.fixture.scope.projectId,
        seeded.flowShadowRunId,
        { baseRevision: next, acknowledgeFindings: true },
      ),
    ).rejects.toMatchObject({ code: "STALE_REVISION", status: 409 });

    const artifact = await artifacts.findById(
      seeded.fixture.scope,
      seeded.artifactId,
    );
    expect(artifact?.status).toBe("draft");
  });

  it("reports a run in another workspace as absent, never forbidden", async () => {
    const seeded = await seedReviewableRun(handle, "passed");
    const other = await seedShadowFixture(handle);

    await expect(
      reviewContentShadowRevision(
        { workspaceId: other.scope.workspaceId },
        other.scope.projectId,
        seeded.flowShadowRunId,
        { baseRevision: seeded.revision, acknowledgeFindings: false },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
