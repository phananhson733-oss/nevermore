import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { runMigrations } from "../migrate.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 6; depth += 1) {
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

interface Fixture {
  readonly workspaceId: string;
  readonly otherWorkspaceId: string;
  readonly projectId: string;
  readonly diagnosticRunId: string;
  readonly crawlCollectionRunId: string;
  readonly otherCrawlCollectionRunId: string;
  readonly gscCollectionRunId: string;
  readonly crawlSnapshotId: string;
  readonly unfrozenCrawlSnapshotId: string;
  readonly gscSnapshotId: string;
  readonly analysisInvocationId: string;
  readonly invalidAnalysisInvocations: readonly {
    readonly name: string;
    readonly id: string;
  }[];
  readonly capturedAt: string;
}

describeDb("evidence frozen-snapshot lineage", () => {
  let handle: DbHandle;
  let fixture: Fixture;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);

    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectId = randomUUID();
    const siteId = randomUUID();
    const icpProfileId = randomUUID();
    const diagnosticRunId = randomUUID();
    const crawlCollectionRunId = randomUUID();
    const otherCrawlCollectionRunId = randomUUID();
    const gscCollectionRunId = randomUUID();
    const crawlSnapshotId = randomUUID();
    const unfrozenCrawlSnapshotId = randomUUID();
    const gscSnapshotId = randomUUID();
    const crawlSourceConnectionId = randomUUID();
    const gscSourceConnectionId = randomUUID();
    const analysisInvocationId = randomUUID();
    const invalidAnalysisInvocations = [
      { name: "missing diagnostic run", id: randomUUID() },
      { name: "wrong async run", id: randomUUID() },
      { name: "wrong task", id: randomUUID() },
      { name: "failed status", id: randomUUID() },
      { name: "missing output hash", id: randomUUID() },
      { name: "wrong prompt set", id: randomUUID() },
    ] as const;
    const actorId = randomUUID();
    const capturedAt = "2026-07-22T04:05:06.789Z";
    const sourceWindow = {
      start: "2026-06-01",
      end: "2026-06-28",
    };
    const icpProfile = { productName: "Frozen evidence fixture" };
    const icpContentHash = contentHash(icpProfile);
    const crawlChecksum = contentHash({ snapshot: crawlSnapshotId });
    const unfrozenCrawlChecksum = contentHash({
      snapshot: unfrozenCrawlSnapshotId,
    });
    const gscChecksum = contentHash({ snapshot: gscSnapshotId });
    const inputManifest = {
      projectId,
      siteId,
      ruleSetVersion: "mvp.rules.0.2.0",
      promptSetVersion: "mvp.prompts.0.2.0",
      deliveryLocale: "en",
      icp: {
        id: icpProfileId,
        version: 1,
        contentHash: icpContentHash,
      },
      snapshots: [
        {
          snapshotId: crawlSnapshotId,
          provider: "crawl",
          datasetKey: "crawl.site_graph.v1",
          schemaVersion: "1",
          methodVersion: "fixture.crawl.v1",
          checksum: crawlChecksum,
          availability: "available",
          sourceWindow,
          capturedAt,
        },
        {
          snapshotId: gscSnapshotId,
          provider: "gsc",
          datasetKey: "gsc.page_query_daily.v1",
          schemaVersion: "1",
          methodVersion: "fixture.gsc.v1",
          checksum: gscChecksum,
          availability: "available",
          sourceWindow,
          capturedAt,
        },
      ],
    };

    await handle.pool.query(
      `INSERT INTO app.workspaces (id, name) VALUES ($1, $2)`,
      [workspaceId, `Evidence lineage ${workspaceId}`],
    );
    await handle.pool.query(
      `INSERT INTO app.workspaces (id, name) VALUES ($1, $2)`,
      [otherWorkspaceId, `Other evidence lineage ${otherWorkspaceId}`],
    );
    await handle.pool.query(
      `INSERT INTO app.client_projects (
         id, workspace_id, client_name, project_name,
         default_delivery_locale, created_by
       ) VALUES ($1, $2, $3, $4, 'en', $5)`,
      [projectId, workspaceId, "Evidence lineage", "Frozen evidence", actorId],
    );
    await handle.pool.query(
      `INSERT INTO app.sites (
         id, workspace_id, project_id, origin, host,
         market_codes, language_codes, is_primary
       ) VALUES ($1, $2, $3, $4, $5, ARRAY['US'], ARRAY['en'], true)`,
      [
        siteId,
        workspaceId,
        projectId,
        `https://${projectId}.example.test`,
        `${projectId}.example.test`,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.icp_profiles (
         id, workspace_id, project_id, version, status,
         profile, content_hash, created_by
       ) VALUES ($1, $2, $3, 1, 'complete', $4, $5, $6)`,
      [
        icpProfileId,
        workspaceId,
        projectId,
        icpProfile,
        icpContentHash,
        actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.source_connections (
         id, workspace_id, project_id, site_id, provider,
         connection_type, state, limitation, connected_at, created_by
       ) VALUES
         ($1, $3, $4, $5, 'crawl', 'public', 'available', $6, $7, $8),
         ($2, $3, $4, $5, 'gsc', 'oauth', 'available', $6, $7, $8)`,
      [
        crawlSourceConnectionId,
        gscSourceConnectionId,
        workspaceId,
        projectId,
        siteId,
        "Disposable evidence-lineage source.",
        capturedAt,
        actorId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.async_runs (
         id, workspace_id, project_id, kind, status,
         initiated_by, started_at, completed_at
       ) VALUES
         ($1, $2, $3, 'diagnostic', 'completed', $7, $8, $8),
         ($4, $2, $3, 'collection', 'completed', $7, $8, $8),
         ($5, $2, $3, 'collection', 'completed', $7, $8, $8),
         ($6, $2, $3, 'collection', 'completed', $7, $8, $8)`,
      [
        diagnosticRunId,
        workspaceId,
        projectId,
        crawlCollectionRunId,
        otherCrawlCollectionRunId,
        gscCollectionRunId,
        actorId,
        capturedAt,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.collection_runs (
         id, workspace_id, project_id, site_id, source_connection_id, provider,
         operation, method_version, parameters_hash
       ) VALUES
         ($1, $2, $3, $4, $10, 'crawl', 'site_graph', 'fixture.crawl.v1', $7),
         ($5, $2, $3, $4, $10, 'crawl', 'site_graph', 'fixture.crawl.v1', $8),
         ($6, $2, $3, $4, $11, 'gsc', 'search_analytics', 'fixture.gsc.v1', $9)`,
      [
        crawlCollectionRunId,
        workspaceId,
        projectId,
        siteId,
        otherCrawlCollectionRunId,
        gscCollectionRunId,
        contentHash({ run: crawlCollectionRunId }),
        contentHash({ run: otherCrawlCollectionRunId }),
        contentHash({ run: gscCollectionRunId }),
        crawlSourceConnectionId,
        gscSourceConnectionId,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.data_snapshots (
         id, workspace_id, project_id, site_id, collection_run_id,
         source_connection_id, provider, dataset_key, schema_version, method_version,
         captured_at, source_window, availability, limitation,
         row_count, checksum
       ) VALUES
         ($1, $2, $3, $4, $5, $16, 'crawl', 'crawl.site_graph.v1', '1',
          'fixture.crawl.v1', $9, $10, 'available', $11, 1, $12),
         ($6, $2, $3, $4, $7, $16, 'crawl', 'crawl.site_graph.v1', '1',
          'fixture.crawl.v1', $9, $10, 'available', $11, 1, $13),
         ($8, $2, $3, $4, $14, $17, 'gsc', 'gsc.page_query_daily.v1', '1',
          'fixture.gsc.v1', $9, $10, 'available', $11, 1, $15)`,
      [
        crawlSnapshotId,
        workspaceId,
        projectId,
        siteId,
        crawlCollectionRunId,
        unfrozenCrawlSnapshotId,
        otherCrawlCollectionRunId,
        gscSnapshotId,
        capturedAt,
        sourceWindow,
        "Disposable evidence-lineage fixture.",
        crawlChecksum,
        unfrozenCrawlChecksum,
        gscCollectionRunId,
        gscChecksum,
        crawlSourceConnectionId,
        gscSourceConnectionId,
      ],
    );
    await handle.pool.query(
      `UPDATE app.collection_runs
       SET row_count = 1, source_window = $4
       WHERE id = ANY($1::uuid[])
         AND workspace_id = $2
         AND project_id = $3`,
      [
        [
          crawlCollectionRunId,
          otherCrawlCollectionRunId,
          gscCollectionRunId,
        ],
        workspaceId,
        projectId,
        sourceWindow,
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.diagnostic_runs (
         id, workspace_id, project_id, site_id, icp_profile_id,
         icp_profile_version, rule_set_version, prompt_set_version,
         output_locale, input_manifest, input_hash
       ) VALUES (
         $1, $2, $3, $4, $5, 1, 'mvp.rules.0.2.0',
         'mvp.prompts.0.2.0', 'en', $6, $7
       )`,
      [
        diagnosticRunId,
        workspaceId,
        projectId,
        siteId,
        icpProfileId,
        inputManifest,
        contentHash(inputManifest),
      ],
    );
    await handle.pool.query(
      `INSERT INTO app.analysis_invocations (
         id, workspace_id, project_id, async_run_id, diagnostic_run_id,
         task, provider, model, prompt_set_version, input_hash,
         output_hash, status, input_tokens, output_tokens, latency_ms
       ) VALUES (
         $1, $2, $3, $4, $4, 'finding_summary', 'openai',
         'fixture-model', 'mvp.prompts.0.2.0', $5, $6,
         'succeeded', 10, 5, 25
       )`,
      [
        analysisInvocationId,
        workspaceId,
        projectId,
        diagnosticRunId,
        contentHash({ invocation: analysisInvocationId, direction: "input" }),
        contentHash({ invocation: analysisInvocationId, direction: "output" }),
      ],
    );
    const invalidInvocationRows = [
      {
        ...invalidAnalysisInvocations[0],
        asyncRunId: diagnosticRunId,
        diagnosticRunId: null,
        task: "finding_summary",
        status: "succeeded",
        outputHash: contentHash({ invalid: "missing-diagnostic" }),
        promptSetVersion: "mvp.prompts.0.2.0",
      },
      {
        ...invalidAnalysisInvocations[1],
        asyncRunId: crawlCollectionRunId,
        diagnosticRunId,
        task: "finding_summary",
        status: "succeeded",
        outputHash: contentHash({ invalid: "wrong-async" }),
        promptSetVersion: "mvp.prompts.0.2.0",
      },
      {
        ...invalidAnalysisInvocations[2],
        asyncRunId: diagnosticRunId,
        diagnosticRunId,
        task: "artifact_generation",
        status: "succeeded",
        outputHash: contentHash({ invalid: "wrong-task" }),
        promptSetVersion: "mvp.prompts.0.2.0",
      },
      {
        ...invalidAnalysisInvocations[3],
        asyncRunId: diagnosticRunId,
        diagnosticRunId,
        task: "finding_summary",
        status: "failed",
        outputHash: contentHash({ invalid: "failed-status" }),
        promptSetVersion: "mvp.prompts.0.2.0",
      },
      {
        ...invalidAnalysisInvocations[4],
        asyncRunId: diagnosticRunId,
        diagnosticRunId,
        task: "finding_summary",
        status: "succeeded",
        outputHash: null,
        promptSetVersion: "mvp.prompts.0.2.0",
      },
      {
        ...invalidAnalysisInvocations[5],
        asyncRunId: diagnosticRunId,
        diagnosticRunId,
        task: "finding_summary",
        status: "succeeded",
        outputHash: contentHash({ invalid: "wrong-prompt-set" }),
        promptSetVersion: "mvp.prompts.invalid",
      },
    ] as const;
    for (const invocation of invalidInvocationRows) {
      await handle.pool.query(
        `INSERT INTO app.analysis_invocations (
           id, workspace_id, project_id, async_run_id, diagnostic_run_id,
           task, provider, model, prompt_set_version, input_hash,
           output_hash, status, input_tokens, output_tokens, latency_ms
         ) VALUES (
           $1, $2, $3, $4, $5, $6, 'openai',
           'fixture-model', $7, $8, $9, $10, 10, 5, 25
         )`,
        [
          invocation.id,
          workspaceId,
          projectId,
          invocation.asyncRunId,
          invocation.diagnosticRunId,
          invocation.task,
          invocation.promptSetVersion,
          contentHash({ invocation: invocation.id, direction: "input" }),
          invocation.outputHash,
          invocation.status,
        ],
      );
    }

    fixture = {
      workspaceId,
      otherWorkspaceId,
      projectId,
      diagnosticRunId,
      crawlCollectionRunId,
      otherCrawlCollectionRunId,
      gscCollectionRunId,
      crawlSnapshotId,
      unfrozenCrawlSnapshotId,
      gscSnapshotId,
      analysisInvocationId,
      invalidAnalysisInvocations,
      capturedAt,
    };
  });

  afterAll(async () => {
    await handle?.end();
  });

  function insertSourceEvidence(
    overrides: Partial<{
      workspaceId: string;
      snapshotId: string | null;
      collectionRunId: string | null;
      sourceProvider: "crawl" | "gsc" | "system";
      observedAt: string;
      origin: "first_party" | "direct_public" | "derived";
      method: "observed" | "computed" | "inferred";
      grade: "A" | "B" | "C";
    }> = {},
  ): Promise<unknown> {
    const sourceProvider = overrides.sourceProvider ?? "crawl";
    const origin =
      overrides.origin ??
      (sourceProvider === "crawl" ? "direct_public" : "first_party");
    const grade = overrides.grade ?? (sourceProvider === "crawl" ? "B" : "A");
    return handle.pool.query(
      `INSERT INTO app.evidence (
         id, workspace_id, project_id, diagnostic_run_id,
         snapshot_id, collection_run_id, source_provider,
         origin, method, grade, availability, support,
         subject_refs, claim, observed_at, limitation
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, 'available', 'supports',
         $11, $12, $13, $14
       )`,
      [
        randomUUID(),
        overrides.workspaceId ?? fixture.workspaceId,
        fixture.projectId,
        fixture.diagnosticRunId,
        overrides.snapshotId === undefined
          ? fixture.crawlSnapshotId
          : overrides.snapshotId,
        overrides.collectionRunId === undefined
          ? fixture.crawlCollectionRunId
          : overrides.collectionRunId,
        sourceProvider,
        origin,
        overrides.method ?? "observed",
        grade,
        JSON.stringify([
          { type: "url", value: "https://example.test/pricing/" },
        ]),
        "Source-backed claim tied to one frozen snapshot.",
        overrides.observedAt ?? fixture.capturedAt,
        "Disposable evidence-lineage fixture.",
      ],
    );
  }

  it("accepts source-backed evidence tied to its exact frozen snapshot", async () => {
    await expect(insertSourceEvidence()).resolves.toBeDefined();
  });

  it("accepts first-party observed evidence on the exact frozen GSC lineage", async () => {
    await expect(
      insertSourceEvidence({
        snapshotId: fixture.gscSnapshotId,
        collectionRunId: fixture.gscCollectionRunId,
        sourceProvider: "gsc",
        origin: "first_party",
        method: "observed",
        grade: "A",
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    { method: "computed" as const, grade: "B" as const },
    { method: "inferred" as const, grade: "C" as const },
  ])(
    "accepts replayable source-backed derived/$method/$grade evidence",
    async ({ method, grade }) => {
      await expect(
        insertSourceEvidence({ origin: "derived", method, grade }),
      ).resolves.toBeDefined();
    },
  );

  it("rejects source-backed evidence without snapshot and collection lineage", async () => {
    await expectPgCode(
      insertSourceEvidence({ snapshotId: null, collectionRunId: null }),
      "23514",
    );
  });

  it("rejects a provider that does not match the source snapshot", async () => {
    await expectPgCode(
      insertSourceEvidence({
        snapshotId: fixture.gscSnapshotId,
        collectionRunId: fixture.gscCollectionRunId,
        sourceProvider: "crawl",
      }),
      "23514",
    );
  });

  it("rejects a snapshot outside the frozen diagnostic manifest", async () => {
    await expectPgCode(
      insertSourceEvidence({
        snapshotId: fixture.unfrozenCrawlSnapshotId,
        collectionRunId: fixture.otherCrawlCollectionRunId,
      }),
      "23514",
    );
  });

  it("rejects a collection run that does not own the source snapshot", async () => {
    await expectPgCode(
      insertSourceEvidence({
        collectionRunId: fixture.otherCrawlCollectionRunId,
      }),
      "23514",
    );
  });

  it("rejects an observation timestamp that differs from the snapshot", async () => {
    await expectPgCode(
      insertSourceEvidence({ observedAt: "2026-07-22T04:05:07.789Z" }),
      "23514",
    );
  });

  it("rejects source evidence that forges a higher-trust provider axis", async () => {
    await expectPgCode(
      insertSourceEvidence({ origin: "first_party", grade: "A" }),
      "23514",
    );
  });

  it.each([
    {
      name: "pseudo-provider lineage",
      overrides: {
        sourceProvider: "system" as const,
        origin: "derived" as const,
        method: "computed" as const,
        grade: "B" as const,
      },
    },
    {
      name: "computed grade",
      overrides: {
        origin: "derived" as const,
        method: "computed" as const,
        grade: "A" as const,
      },
    },
    {
      name: "inferred grade",
      overrides: {
        origin: "derived" as const,
        method: "inferred" as const,
        grade: "B" as const,
      },
    },
    {
      name: "derived method",
      overrides: {
        origin: "derived" as const,
        method: "observed" as const,
        grade: "B" as const,
      },
    },
    {
      name: "observed origin",
      overrides: {
        origin: "direct_public" as const,
        method: "computed" as const,
        grade: "B" as const,
      },
    },
  ])("rejects forged $name semantics", async ({ overrides }) => {
    await expectPgCode(insertSourceEvidence(overrides), "23514");
  });

  it("allows lineage-free deterministic system evidence only on its exact axes", async () => {
    await expect(
      insertSourceEvidence({
        snapshotId: null,
        collectionRunId: null,
        sourceProvider: "system",
        origin: "derived",
        method: "computed",
        grade: "B",
      }),
    ).resolves.toBeDefined();

    await expectPgCode(
      insertSourceEvidence({
        snapshotId: null,
        collectionRunId: null,
        sourceProvider: "system",
        origin: "derived",
        method: "inferred",
        grade: "C",
      }),
      "23514",
    );

    await expectPgCode(
      insertSourceEvidence({
        workspaceId: fixture.otherWorkspaceId,
        snapshotId: null,
        collectionRunId: null,
        sourceProvider: "system",
        origin: "derived",
        method: "computed",
        grade: "B",
      }),
      "23514",
    );
  });

  it("keeps invocation-backed generated evidence separate from snapshots", async () => {
    const generatedInsert = (
      withSnapshot: boolean,
      grade: "B" | "C" = "C",
      analysisInvocationId = fixture.analysisInvocationId,
    ) =>
      handle.pool.query(
        `INSERT INTO app.evidence (
           id, workspace_id, project_id, diagnostic_run_id,
           snapshot_id, collection_run_id, analysis_invocation_id,
           source_provider, origin, method, grade, availability,
           support, subject_refs, claim, observed_at, limitation
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           'llm', 'generated', 'generated', $8, 'available',
           'context', $9, $10, $11, $12
         )`,
        [
          randomUUID(),
          fixture.workspaceId,
          fixture.projectId,
          fixture.diagnosticRunId,
          withSnapshot ? fixture.crawlSnapshotId : null,
          withSnapshot ? fixture.crawlCollectionRunId : null,
          analysisInvocationId,
          grade,
          JSON.stringify([{ type: "site", value: "https://example.test" }]),
          "Generated summary with immutable invocation lineage.",
          fixture.capturedAt,
          "Generated text is not a source observation.",
        ],
      );

    await expect(generatedInsert(false)).resolves.toBeDefined();
    await expectPgCode(generatedInsert(true), "23514");
    await expectPgCode(generatedInsert(false, "B"), "23514");
    for (const invocation of fixture.invalidAnalysisInvocations) {
      await expectPgCode(
        generatedInsert(false, "C", invocation.id),
        "23514",
      );
    }
  });
});
