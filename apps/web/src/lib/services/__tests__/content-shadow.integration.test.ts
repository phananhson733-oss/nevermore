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
  CollectionRunsRepository,
  contentHash,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
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
import { CONTENT_SHADOW_ADAPTER_VERSION } from "@sf/flow-shadow";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";
import { ProblemError } from "@sf/observability";
import {
  createContentShadowRun,
  getContentShadowRun,
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
    expect(projection.source).toMatchObject({
      findingId: fixture.findingId,
      actionId: fixture.actionId,
      contentBriefArtifactId: fixture.briefArtifactId,
      contentBriefRevision: 1,
    });
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
