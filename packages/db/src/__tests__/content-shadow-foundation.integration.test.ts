import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type Db, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import { ActionsRepository } from "../repositories/actions.ts";
import { CapabilityRunsRepository } from "../repositories/capability-runs.ts";
import { CollectionRunsRepository } from "../repositories/collection-runs.ts";
import { DataSnapshotsRepository } from "../repositories/data-snapshots.ts";
import { DiagnosticRunsRepository } from "../repositories/diagnostic-runs.ts";
import { EvidenceRepository } from "../repositories/evidence.ts";
import { FindingsRepository } from "../repositories/findings.ts";
import {
  CONTENT_SHADOW_PROJECTION_VERSION,
  FlowShadowQaGateReplayConflictError,
  FlowShadowQaGatesRepository,
  FlowShadowResearchPacksRepository,
  FlowShadowRunsRepository,
} from "../repositories/flow-shadow-runs.ts";
import { SourceConnectionsRepository } from "../repositories/source-connections.ts";
import {
  asyncRuns,
  clientProjects,
  icpProfiles,
  sites,
  workspaces,
} from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const CRAWL_METHOD_VERSION = "crawl.site_graph.v2";
const CRAWL_DATASET_KEY = "crawl.site_graph.v1";
const RULE_SET_VERSION = "mvp.rules.0.2.0";
const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";
const CONTENT_RULE_ID = "CONTENT-COVERAGE-001";
const FLOW_ADAPTER_VERSION = "content-shadow-adapter.0.4.0";

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string") return wrapped.code;
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

interface ProjectFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
  readonly icpContentHash: string;
  readonly crawlSourceConnectionId: string;
}

interface DiagnosticFixture {
  readonly runId: string;
  readonly collectionRunId: string;
  readonly snapshotId: string;
  readonly capturedAt: string;
}

async function createProjectFixture(db: Db): Promise<ProjectFixture> {
  const actorId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const icpProfileId = randomUUID();
  const icpProfile = { fixtureId: randomUUID() };
  const icpContentHash = contentHash(icpProfile);

  await db.insert(workspaces).values({
    id: workspaceId,
    name: `Content shadow ${workspaceId}`,
  });
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
    actorId,
    workspaceId,
    projectId,
    siteId,
    icpProfileId,
    icpContentHash,
    crawlSourceConnectionId: crawlSource.id,
  };
}

async function createDiagnosticRun(
  db: Db,
  fixture: ProjectFixture,
): Promise<DiagnosticFixture> {
  const collectionRunId = randomUUID();
  const runId = randomUUID();
  const capturedAt = new Date().toISOString();
  const sourceWindow = { start: null, end: null };

  await db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "collection",
    status: "completed",
    initiated_by: fixture.actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const collectionRuns = new CollectionRunsRepository(db);
  await collectionRuns.insertPlaceholder({
    runId: collectionRunId,
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    sourceConnectionId: fixture.crawlSourceConnectionId,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: CRAWL_METHOD_VERSION,
    parametersHash: contentHash({ collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(db).insert({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    collectionRunId,
    sourceConnectionId: fixture.crawlSourceConnectionId,
    provider: "crawl",
    datasetKey: CRAWL_DATASET_KEY,
    schemaVersion: "0.2.0",
    methodVersion: CRAWL_METHOD_VERSION,
    capturedAt,
    sourceWindow,
    availability: "available",
    limitation: "Deterministic content-shadow integration fixture.",
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

  await db.insert(asyncRuns).values({
    id: runId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "diagnostic",
    status: "completed",
    initiated_by: fixture.actorId,
    started_at: capturedAt,
    completed_at: capturedAt,
  });
  const inputManifest = {
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    ruleSetVersion: RULE_SET_VERSION,
    promptSetVersion: PROMPT_SET_VERSION,
    deliveryLocale: "en",
    icp: {
      id: fixture.icpProfileId,
      version: 1,
      contentHash: fixture.icpContentHash,
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
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    siteId: fixture.siteId,
    icpProfileId: fixture.icpProfileId,
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

async function linkFindingObservation(
  db: Db,
  fixture: ProjectFixture,
  findingId: string,
  diagnostic: DiagnosticFixture,
): Promise<void> {
  const [evidenceId] = await new EvidenceRepository(db).insertMany(
    {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      diagnosticRunId: diagnostic.runId,
    },
    [
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
        limitation: "Disposable integration fixture.",
        snapshotId: diagnostic.snapshotId,
        collectionRunId: diagnostic.collectionRunId,
      },
    ],
  );
  await new EvidenceRepository(db).linkObservations(
    {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      diagnosticRunId: diagnostic.runId,
    },
    [{ findingId, evidenceId: evidenceId!, role: "primary" }],
  );
}

async function createFinding(
  db: Db,
  fixture: ProjectFixture,
  diagnostic: DiagnosticFixture,
  opts: { ruleId: string; reviewState: "unreviewed" | "confirmed" },
): Promise<string> {
  const finding = await new FindingsRepository(db).insert({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    findingKey: contentHash({ fixtureId: randomUUID() }),
    ruleId: opts.ruleId,
    ruleVersion: 1,
    ruleFamily: "content-coverage",
    intent: "improve_coverage",
    domain: "content_intent",
    titleKey: "finding.content_coverage",
    titleArgs: { cluster: "onboarding" },
    summary: "A traced content integration finding.",
    summaryLocale: "en",
    subjectRefs: ["keyword_cluster:onboarding"],
    severity: "high",
    confidence: "high",
    reviewState: opts.reviewState,
    runId: diagnostic.runId,
    seenAt: diagnostic.capturedAt,
  });
  await linkFindingObservation(db, fixture, finding.id, diagnostic);
  return finding.id;
}

async function createAction(
  db: Db,
  fixture: ProjectFixture,
  findingId: string,
  sourceDiagnosticRunId: string,
  status = "planned",
): Promise<string> {
  const action = await new ActionsRepository(db).insert({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    sourceFindingId: findingId,
    sourceDiagnosticRunId,
    actionKey: contentHash({ fixtureId: randomUUID() }),
    templateId: `content_brief.${randomUUID()}`,
    templateVersion: 1,
    title: "Draft the content brief",
    description: "Produce a content brief for the confirmed coverage gap.",
    contentLocale: "en",
    priorityBand: "high",
    roadmapLane: "now",
    status,
    effort: "medium",
    risk: "low",
    expectedOutcome: "The coverage gap is briefed.",
    evidenceRefs: [],
    createdBy: fixture.actorId,
  });
  return action.id;
}

/** Raw insert a content_brief artifact + one revision, controlling current_revision. */
async function createContentBrief(
  handle: DbHandle,
  fixture: ProjectFixture,
  actionId: string,
  opts: { currentRevision: number; revisionsToInsert: number },
): Promise<{ artifactId: string; revision: number }> {
  const artifactId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.execution_artifacts (
       id, workspace_id, project_id, action_id, artifact_type, status,
       generation_mode, output_locale, current_revision, validation_state,
       content_hash, created_by
     ) VALUES ($1,$2,$3,$4,'content_brief','ready','template','en',$5,'valid',$6,$7)`,
    [
      artifactId,
      fixture.workspaceId,
      fixture.projectId,
      actionId,
      opts.currentRevision,
      contentHash({ artifactId }),
      fixture.actorId,
    ],
  );
  for (let revision = 1; revision <= opts.revisionsToInsert; revision += 1) {
    await handle.pool.query(
      `INSERT INTO app.artifact_revisions (
         id, workspace_id, project_id, artifact_id, revision, output_locale,
         content_format, content_text, content_hash, generated_by
       ) VALUES ($1,$2,$3,$4,$5,'en','markdown',$6,$7,'template')`,
      [
        randomUUID(),
        fixture.workspaceId,
        fixture.projectId,
        artifactId,
        revision,
        `# Content brief revision ${revision}`,
        contentHash({ artifactId, revision }),
      ],
    );
  }
  return { artifactId, revision: opts.revisionsToInsert };
}

/** Fresh content_shadow async run + shadow/internal_write capability run. */
async function createContentShadowCapability(
  handle: DbHandle,
  fixture: ProjectFixture,
): Promise<string> {
  const runId = randomUUID();
  await handle.pool.query(
    `INSERT INTO app.async_runs (id, workspace_id, project_id, kind, initiated_by)
     VALUES ($1,$2,$3,'content_shadow',$4)`,
    [runId, fixture.workspaceId, fixture.projectId, fixture.actorId],
  );
  await new CapabilityRunsRepository(handle.db).create({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    asyncRunId: runId,
    capabilityId: "content-shadow",
    capabilityVersion: "0.3.0",
    inputManifestHash: contentHash({ runId }),
    mode: "shadow",
    sideEffectClass: "internal_write",
  });
  return runId;
}

interface ShadowChain {
  readonly fixture: ProjectFixture;
  readonly diagnostic: DiagnosticFixture;
  readonly findingId: string;
  readonly actionId: string;
  readonly artifactId: string;
  readonly revision: number;
  readonly capabilityRunId: string;
}

async function createShadowChain(
  handle: DbHandle,
  opts: { actionStatus?: string } = {},
): Promise<ShadowChain> {
  const fixture = await createProjectFixture(handle.db);
  const diagnostic = await createDiagnosticRun(handle.db, fixture);
  const findingId = await createFinding(handle.db, fixture, diagnostic, {
    ruleId: CONTENT_RULE_ID,
    reviewState: "confirmed",
  });
  const actionId = await createAction(
    handle.db,
    fixture,
    findingId,
    diagnostic.runId,
    opts.actionStatus ?? "planned",
  );
  const brief = await createContentBrief(handle, fixture, actionId, {
    currentRevision: 1,
    revisionsToInsert: 1,
  });
  const capabilityRunId = await createContentShadowCapability(handle, fixture);
  return {
    fixture,
    diagnostic,
    findingId,
    actionId,
    artifactId: brief.artifactId,
    revision: brief.revision,
    capabilityRunId,
  };
}

function runInsert(
  chain: ShadowChain,
  overrides: Partial<{
    capabilityRunId: string;
    sourceFindingId: string;
    sourceActionId: string;
    contentBriefArtifactId: string;
    contentBriefRevision: number;
  }> = {},
) {
  return {
    workspaceId: chain.fixture.workspaceId,
    projectId: chain.fixture.projectId,
    siteId: chain.fixture.siteId,
    capabilityRunId: overrides.capabilityRunId ?? chain.capabilityRunId,
    sourceFindingId: overrides.sourceFindingId ?? chain.findingId,
    sourceActionId: overrides.sourceActionId ?? chain.actionId,
    contentBriefArtifactId:
      overrides.contentBriefArtifactId ?? chain.artifactId,
    contentBriefRevision: overrides.contentBriefRevision ?? chain.revision,
    flowAdapterVersion: FLOW_ADAPTER_VERSION,
    frozenInputManifest: {
      adapter: FLOW_ADAPTER_VERSION,
      chainId: chain.findingId,
    },
    contentHash: contentHash({ run: randomUUID() }),
    projectionVersion: CONTENT_SHADOW_PROJECTION_VERSION,
  };
}

describeDb("content shadow database foundation", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("provisions the three append-only content-shadow projection tables", async () => {
    await expect(
      handle.pool.query("SELECT 1 FROM app.flow_shadow_runs LIMIT 0"),
    ).resolves.toBeDefined();
    await expect(
      handle.pool.query("SELECT 1 FROM app.flow_shadow_research_packs LIMIT 0"),
    ).resolves.toBeDefined();
    await expect(
      handle.pool.query("SELECT 1 FROM app.flow_shadow_qa_gates LIMIT 0"),
    ).resolves.toBeDefined();
  });

  it("persists a confirmed content-brief lineage and reads it back through the repositories", async () => {
    const chain = await createShadowChain(handle);
    const scope = {
      workspaceId: chain.fixture.workspaceId,
      projectId: chain.fixture.projectId,
    };
    const foreignScope = { workspaceId: randomUUID(), projectId: randomUUID() };
    const runs = new FlowShadowRunsRepository(handle.db);
    const values = runInsert(chain);

    const created = await runs.create(values);
    expect(created).toMatchObject({
      source_finding_id: chain.findingId,
      source_action_id: chain.actionId,
      content_brief_artifact_id: chain.artifactId,
      content_brief_revision: 1,
      projection_version: CONTENT_SHADOW_PROJECTION_VERSION,
    });

    await expect(runs.findById(scope, created.id)).resolves.toMatchObject({
      id: created.id,
    });
    await expect(runs.findById(foreignScope, created.id)).resolves.toBeNull();
    await expect(
      runs.findByContentHash(scope, values.contentHash),
    ).resolves.toMatchObject({ id: created.id });
    await expect(
      runs.listByProject(scope, { limit: 10, cursor: null }),
    ).resolves.toMatchObject({ rows: [{ id: created.id }], nextCursor: null });

    // Exact replay converges; a divergent immutable field is rejected.
    await expect(runs.create(values)).resolves.toEqual(created);
    await expect(
      runs.create({ ...values, contentHash: contentHash({ drift: true }) }),
    ).rejects.toThrow("flow shadow run replay conflicts");

    const packs = new FlowShadowResearchPacksRepository(handle.db);
    const frozenPack = { sources: [] };
    const pack = await packs.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      flowShadowRunId: created.id,
      analysisInvocationId: null,
      contentHash: contentHash(frozenPack),
      pack: frozenPack,
    });
    await expect(packs.findByRun(scope, created.id)).resolves.toMatchObject({
      id: pack.id,
    });
    await expect(
      packs.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        flowShadowRunId: created.id,
        analysisInvocationId: null,
        contentHash: contentHash(frozenPack),
        pack: frozenPack,
      }),
    ).resolves.toEqual(pack);
    await expect(
      packs.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        flowShadowRunId: created.id,
        analysisInvocationId: null,
        contentHash: contentHash(frozenPack),
        pack: { sources: [{ ref: "drift" }] },
      }),
    ).rejects.toThrow("content hash does not match canonical pack");

    const gates = new FlowShadowQaGatesRepository(handle.db);
    const gate = await gates.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      flowShadowRunId: created.id,
      evaluatedArtifactId: chain.artifactId,
      evaluatedRevision: 1,
      analysisInvocationId: null,
      verdict: "needs_review",
      claims: [{ claim: "unsupported", verdict: "needs_review" }],
    });
    await expect(gates.findByRun(scope, created.id)).resolves.toEqual([
      expect.objectContaining({ id: gate.id, verdict: "needs_review" }),
    ]);
  });

  /**
   * The tie-break arm of the keyset seek, `and(eq(created_at), lt(id))`.
   *
   * It only fires when two rows share a `created_at`, and the previous round
   * recorded it as uncoverable: `flow_shadow_runs` carries a BEFORE UPDATE OR
   * DELETE append-only trigger (`0020:181-183`), so no test may flatten two
   * timestamps after the fact. That is still true — and it was the wrong way
   * in. `created_at` defaults to `now()`, which in PostgreSQL is the
   * TRANSACTION timestamp, so three rows written through the ordinary
   * repository path inside ONE transaction share it by construction. Both
   * triggers stay armed, nothing is updated, and no timestamp is hand-set.
   *
   * What the arm has to buy is the whole reason a keyset cursor is used at all:
   * with a tie on the sort key, an `lt(created_at)`-only seek would skip every
   * row sharing the page boundary's timestamp, and an `lte` would repeat them
   * forever. The assertions below are exactly those two failures.
   */
  it("pages a created_at tie by id, repeating and losing no row", async () => {
    const chain = await createShadowChain(handle);
    const scope = {
      workspaceId: chain.fixture.workspaceId,
      projectId: chain.fixture.projectId,
    };
    const capabilityRunIds = [
      chain.capabilityRunId,
      await createContentShadowCapability(handle, chain.fixture),
      await createContentShadowCapability(handle, chain.fixture),
    ];

    const created = await handle.db.transaction(async (tx) => {
      const scoped = new FlowShadowRunsRepository(tx);
      const rows = [];
      for (const capabilityRunId of capabilityRunIds) {
        rows.push(await scoped.create(runInsert(chain, { capabilityRunId })));
      }
      return rows;
    });
    expect(
      new Set(created.map((row) => String(row.created_at))).size,
      "one transaction, one now()",
    ).toBe(1);

    const runs = new FlowShadowRunsRepository(handle.db);
    // Ground truth: one unpaged read of the same index.
    const whole = await runs.listByProject(scope, { limit: 10, cursor: null });
    const expected = whole.rows.map((row) => row.id);
    expect(whole.nextCursor).toBeNull();
    expect(expected).toHaveLength(3);
    expect(expected).toStrictEqual([...expected].sort().reverse());
    expect([...expected].sort()).toStrictEqual(
      [...created.map((row) => row.id)].sort(),
    );

    const walked: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof runs.listByProject>> =
        await runs.listByProject(scope, { limit: 2, cursor });
      pages += 1;
      // A seek that never advances past the tie would loop forever.
      expect(pages).toBeLessThanOrEqual(3);
      expect(page.rows.length).toBeGreaterThan(0);
      walked.push(...page.rows.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(pages).toBe(2);
    // Nothing skipped across the tied boundary, nothing served twice.
    expect(walked).toStrictEqual(expected);
    expect(new Set(walked).size).toBe(walked.length);
  });

  describe("qa gate replay", () => {
    async function seedGate(claims: readonly unknown[]) {
      const chain = await createShadowChain(handle);
      const scope = {
        workspaceId: chain.fixture.workspaceId,
        projectId: chain.fixture.projectId,
      };
      const created = await new FlowShadowRunsRepository(handle.db).create(
        runInsert(chain),
      );
      const gates = new FlowShadowQaGatesRepository(handle.db);
      const values = {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        flowShadowRunId: created.id,
        evaluatedArtifactId: chain.artifactId,
        evaluatedRevision: 1,
        analysisInvocationId: null,
        verdict: "blocked" as const,
        claims,
      };
      const inserted = await gates.insert(values);
      return { gates, values, inserted };
    }

    const CLAIMS: readonly unknown[] = [
      {
        claimId: "content-shadow.qa.rl8_unsupported_claim",
        kind: "red_line",
        status: "failed",
        detail: "line 5 resolves to no source in the frozen research pack",
      },
      {
        claimId: "content-shadow.qa.brief-outline",
        kind: "coverage",
        status: "passed",
        detail: "The draft covers all 2 coverage topic(s).",
      },
    ];

    it("converges when the replay produces the same claims", async () => {
      const { gates, values, inserted } = await seedGate(CLAIMS);

      // Object key order differs from the insert and from jsonb's storage order;
      // canonicalization is what keeps that from reading as corruption.
      const reordered = CLAIMS.map((claim) => {
        const entries = Object.entries(claim as Record<string, unknown>);
        return Object.fromEntries([...entries].reverse());
      });
      await expect(
        gates.insert({ ...values, claims: reordered }),
      ).resolves.toMatchObject({ id: inserted.id });
    });

    /**
     * The hole this closes: comparing only the verdict made the one situation
     * that most needs an alarm — the same frozen run judged differently — the
     * one situation that passed in silence.
     */
    it("rejects a replay whose claims differ under an identical verdict", async () => {
      const { gates, values } = await seedGate(CLAIMS);
      const tampered = [
        { ...(CLAIMS[0] as Record<string, unknown>), status: "passed" },
        CLAIMS[1],
      ];

      await expect(
        gates.insert({ ...values, claims: tampered }),
      ).rejects.toThrow(FlowShadowQaGateReplayConflictError);
      await expect(
        gates.insert({ ...values, claims: tampered }),
      ).rejects.toThrow(/different claims/);
    });

    it("still rejects a replay whose verdict differs", async () => {
      const { gates, values } = await seedGate(CLAIMS);

      await expect(
        gates.insert({ ...values, verdict: "needs_review" }),
      ).rejects.toThrow(/different verdict/);
    });

    it("leaves the stored append-only row untouched after a rejected replay", async () => {
      const { gates, values, inserted } = await seedGate(CLAIMS);
      await expect(gates.insert({ ...values, claims: [] })).rejects.toThrow(
        FlowShadowQaGateReplayConflictError,
      );

      const rows = await gates.findByRun(
        {
          workspaceId: values.workspaceId,
          projectId: values.projectId,
        },
        values.flowShadowRunId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(inserted.id);
      expect(rows[0]?.claims).toHaveLength(CLAIMS.length);
    });
  });

  it("rejects a child row whose canonical run belongs to another project", async () => {
    const chain = await createShadowChain(handle);
    const created = await new FlowShadowRunsRepository(handle.db).create(
      runInsert(chain),
    );
    const foreign = await createShadowChain(handle);
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.flow_shadow_research_packs (
           workspace_id, project_id, flow_shadow_run_id, content_hash, pack
         ) VALUES ($1,$2,$3,$4,'{}'::jsonb)`,
        [
          foreign.fixture.workspaceId,
          foreign.fixture.projectId,
          created.id,
          contentHash({ x: 1 }),
        ],
      ),
      "23514",
    );
  });

  it("rejects flow shadow runs whose provenance chain is not truthful", async () => {
    const chain = await createShadowChain(handle);

    // 1. capability run that is not a content_shadow shadow/internal_write run.
    const diagnosticCapabilityRunId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.async_runs (id, workspace_id, project_id, kind, initiated_by)
       VALUES ($1,$2,$3,'diagnostic',$4)`,
      [
        diagnosticCapabilityRunId,
        chain.fixture.workspaceId,
        chain.fixture.projectId,
        chain.fixture.actorId,
      ],
    );
    await new CapabilityRunsRepository(handle.db).create({
      workspaceId: chain.fixture.workspaceId,
      projectId: chain.fixture.projectId,
      asyncRunId: diagnosticCapabilityRunId,
      capabilityId: "growth-audit",
      capabilityVersion: "0.3.0",
      inputManifestHash: contentHash({ x: 2 }),
      mode: "production",
      sideEffectClass: "internal_write",
    });
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(
        runInsert(chain, { capabilityRunId: diagnosticCapabilityRunId }),
      ),
      "23514",
    );

    // 2. unconfirmed source Finding.
    const unconfirmed = await createShadowChainVariant(handle, {
      ruleId: CONTENT_RULE_ID,
      reviewState: "unreviewed",
    });
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(runInsert(unconfirmed)),
      "23514",
    );

    // 3. confirmed Finding whose rule is not a content-brief rule.
    const technical = await createShadowChainVariant(handle, {
      ruleId: "TECH-HTTP-001",
      reviewState: "confirmed",
    });
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(runInsert(technical)),
      "23514",
    );

    // 4. Action that does not belong to the source Finding.
    const otherChain = await createShadowChain(handle);
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(
        runInsert(chain, {
          capabilityRunId: await createContentShadowCapability(
            handle,
            chain.fixture,
          ),
          sourceActionId: otherChain.actionId,
        }),
      ),
      "23514",
    );

    // 5. frozen content_brief revision does not exist (current_revision ahead of rows).
    const missingRevisionAction = await createAction(
      handle.db,
      chain.fixture,
      chain.findingId,
      chain.diagnostic.runId,
    );
    const briefWithGap = await createContentBrief(
      handle,
      chain.fixture,
      missingRevisionAction,
      { currentRevision: 2, revisionsToInsert: 1 },
    );
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(
        runInsert(chain, {
          capabilityRunId: await createContentShadowCapability(
            handle,
            chain.fixture,
          ),
          sourceActionId: missingRevisionAction,
          contentBriefArtifactId: briefWithGap.artifactId,
          contentBriefRevision: 2,
        }),
      ),
      "23514",
    );

    // 6. Finding re-observed in a later diagnostic run moves beyond the Action's frozen diagnosis.
    const movedChain = await createShadowChain(handle);
    const laterRun = await createDiagnosticRun(handle.db, movedChain.fixture);
    await linkFindingObservation(
      handle.db,
      movedChain.fixture,
      movedChain.findingId,
      laterRun,
    );
    await new FindingsRepository(handle.db).touchSeen(movedChain.findingId, {
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
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(runInsert(movedChain)),
      "23514",
    );

    // 7. content_brief artifact belongs to a different Action than source_action_id.
    const briefMismatch = await createShadowChain(handle);
    const foreignBriefAction = await createAction(
      handle.db,
      briefMismatch.fixture,
      briefMismatch.findingId,
      briefMismatch.diagnostic.runId,
    );
    const foreignBrief = await createContentBrief(
      handle,
      briefMismatch.fixture,
      foreignBriefAction,
      { currentRevision: 1, revisionsToInsert: 1 },
    );
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(
        runInsert(briefMismatch, {
          contentBriefArtifactId: foreignBrief.artifactId,
        }),
      ),
      "23514",
    );

    // 8. Frozen artifact is not a content_brief (wrong artifact_type).
    const typeMismatch = await createShadowChain(handle);
    const metadataArtifactId = randomUUID();
    await handle.pool.query(
      `INSERT INTO app.execution_artifacts (
         id, workspace_id, project_id, action_id, artifact_type, status,
         generation_mode, output_locale, current_revision, validation_state,
         content_hash, created_by
       ) VALUES ($1,$2,$3,$4,'metadata_rewrite','ready','template','en',1,'valid',$5,$6)`,
      [
        metadataArtifactId,
        typeMismatch.fixture.workspaceId,
        typeMismatch.fixture.projectId,
        typeMismatch.actionId,
        contentHash({ metadataArtifactId }),
        typeMismatch.fixture.actorId,
      ],
    );
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(
        runInsert(typeMismatch, {
          contentBriefArtifactId: metadataArtifactId,
        }),
      ),
      "23514",
    );

    // 9. A dismissed Action is not an eligible content-shadow source.
    const dismissedChain = await createShadowChain(handle, {
      actionStatus: "dismissed",
    });
    await expectPgCode(
      new FlowShadowRunsRepository(handle.db).create(runInsert(dismissedChain)),
      "23514",
    );
  });

  it("rejects mutation and deletion of the append-only projection rows", async () => {
    const chain = await createShadowChain(handle);
    const runs = new FlowShadowRunsRepository(handle.db);
    const created = await runs.create(runInsert(chain));
    const scope = {
      workspaceId: chain.fixture.workspaceId,
      projectId: chain.fixture.projectId,
    };
    const pack = await new FlowShadowResearchPacksRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      flowShadowRunId: created.id,
      analysisInvocationId: null,
      contentHash: contentHash({}),
      pack: {},
    });
    const gate = await new FlowShadowQaGatesRepository(handle.db).insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      flowShadowRunId: created.id,
      evaluatedArtifactId: chain.artifactId,
      evaluatedRevision: 1,
      analysisInvocationId: null,
      verdict: "passed",
      claims: [],
    });

    await expectPgCode(
      handle.pool.query(
        "UPDATE app.flow_shadow_runs SET projection_version = 'drift' WHERE id = $1",
        [created.id],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query("DELETE FROM app.flow_shadow_runs WHERE id = $1", [
        created.id,
      ]),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.flow_shadow_research_packs SET content_hash = $1 WHERE id = $2",
        ["a".repeat(64), pack.id],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "DELETE FROM app.flow_shadow_research_packs WHERE id = $1",
        [pack.id],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "UPDATE app.flow_shadow_qa_gates SET verdict = 'blocked' WHERE id = $1",
        [gate.id],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query("DELETE FROM app.flow_shadow_qa_gates WHERE id = $1", [
        gate.id,
      ]),
      "55000",
    );
  });
});

/** A full valid chain but with an overridable Finding rule id / review state. */
async function createShadowChainVariant(
  handle: DbHandle,
  opts: { ruleId: string; reviewState: "unreviewed" | "confirmed" },
): Promise<ShadowChain> {
  const fixture = await createProjectFixture(handle.db);
  const diagnostic = await createDiagnosticRun(handle.db, fixture);
  const findingId = await createFinding(handle.db, fixture, diagnostic, opts);
  const actionId = await createAction(
    handle.db,
    fixture,
    findingId,
    diagnostic.runId,
  );
  const brief = await createContentBrief(handle, fixture, actionId, {
    currentRevision: 1,
    revisionsToInsert: 1,
  });
  const capabilityRunId = await createContentShadowCapability(handle, fixture);
  return {
    fixture,
    diagnostic,
    findingId,
    actionId,
    artifactId: brief.artifactId,
    revision: brief.revision,
    capabilityRunId,
  };
}
