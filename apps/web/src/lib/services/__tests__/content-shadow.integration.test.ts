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
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  FlowShadowQaGatesRepository,
  FlowShadowResearchPacksRepository,
  FlowShadowRunsRepository,
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
  const shadowRun = await new FlowShadowRunsRepository(handle.db).findById(
    fixture.scope,
    flowShadowRunId,
  );
  await new FlowShadowResearchPacksRepository(handle.db).insert({
    workspaceId: fixture.scope.workspaceId,
    projectId: fixture.scope.projectId,
    flowShadowRunId,
    analysisInvocationId: null,
    contentHash: shadowRun!.content_hash,
    pack: { sources: [], limitations: [] },
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
    await createContentShadowRun(
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
    ).rejects.toMatchObject({ code: "RUN_ALREADY_ACTIVE", status: 409 });
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
    const shadowRun = await new FlowShadowRunsRepository(handle.db).findById(
      fixture.scope,
      run.flowShadowRunId,
    );
    const failureLimitation =
      "Content brief outline extraction FAILED: the pinned brief revision carried no machine-readable `## ` section heading, so this draft was NOT guided by the brief. Review the draft against the brief by hand.";
    await new FlowShadowResearchPacksRepository(handle.db).insert({
      workspaceId: fixture.scope.workspaceId,
      projectId: fixture.scope.projectId,
      flowShadowRunId: run.flowShadowRunId,
      analysisInvocationId: null,
      contentHash: shadowRun!.content_hash,
      pack: { sources: [], limitations: [failureLimitation] },
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

describeDb("QA claim severity is reported, never re-derived by the reader", () => {
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
});

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

  it("pages newest first through the shared cursor convention", async () => {
    const fixture = await seedShadowFixture(handle);
    const first = await startShadowRun(fixture);
    const second = await seedShadowFixture(handle);
    const secondRun = await startShadowRun(second);

    const firstPage = await listContentShadowRuns(
      { workspaceId: fixture.scope.workspaceId },
      fixture.scope.projectId,
      { limit: 1, cursor: null },
    );
    expect(firstPage.data.map((row) => row.flowShadowRunId)).toEqual([
      first.flowShadowRunId,
    ]);
    expect(firstPage.nextCursor).toBeNull();

    // A second project's run never leaks into the first project's index.
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
