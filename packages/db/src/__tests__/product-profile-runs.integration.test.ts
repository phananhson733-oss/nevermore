import { randomUUID } from "node:crypto";
import { ProductProfileDraft } from "@sf/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash, type CanonicalValue } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import { AnalysisInvocationsRepository } from "../repositories/analysis-invocations.ts";
import {
  AsyncRunsRepository,
  toRunAttempt,
} from "../repositories/async-runs.ts";
import { CollectionRunsRepository } from "../repositories/collection-runs.ts";
import { DataSnapshotsRepository } from "../repositories/data-snapshots.ts";
import { IcpProfilesRepository } from "../repositories/icp-profiles.ts";
import { ObservationsRepository } from "../repositories/observations.ts";
import { PageSnapshotsRepository } from "../repositories/page-snapshots.ts";
import { ProductProfileRunsRepository } from "../repositories/product-profile-runs.ts";
import { ProductProfileInvocationAttemptsRepository } from "../repositories/product-profile-invocation-attempts.ts";
import { ProjectsRepository } from "../repositories/projects.ts";
import { SitesRepository } from "../repositories/sites.ts";
import { SourceConnectionsRepository } from "../repositories/source-connections.ts";
import { SitePagesRepository } from "../repositories/site-pages.ts";
import {
  analysisInvocations,
  asyncRuns,
  icpProfiles,
  normalizedObservations,
  productProfileRuns,
  productProfileInvocationAttempts,
  workspaces,
} from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

function crawlPageExtract(fetchUrl: string, nonce: string) {
  return {
    schemaVersion: "crawl.page-extract.v1",
    subjectUrl: fetchUrl,
    depth: 0,
    projection: { fetchUrl },
    nonce,
  };
}

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

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly baseProfileId: string;
  readonly baseProfileVersion: number;
  readonly baseProfileContentHash: string;
  readonly sourcePageUrl: string;
  readonly sourceCollectionRunId: string;
  readonly sourceConnectionId: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotChecksum: string;
  readonly wrongProviderSnapshotId: string;
  readonly resultProfileId: string;
  readonly alternateResultProfileId: string;
}

interface Fixture {
  readonly actorId: string;
  readonly primary: ProjectFixture;
  readonly foreignProject: ProjectFixture;
  readonly foreignWorkspace: ProjectFixture;
}

describeDb("Product Profile synthesis persistence", () => {
  let handle: DbHandle;
  let fixture: Fixture;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
    const actorId = randomUUID();

    const [workspace, otherWorkspace] = await handle.db
      .insert(workspaces)
      .values([
        { name: `Profile synthesis ${randomUUID()}` },
        { name: `Foreign profile synthesis ${randomUUID()}` },
      ])
      .returning();

    const createProjectFixture = async (
      workspaceId: string,
      label: string,
    ): Promise<ProjectFixture> => {
      const project = await new ProjectsRepository(handle.db).insert({
        workspaceId,
        clientName: `${label} client`,
        projectName: `${label} project`,
        defaultDeliveryLocale: "en",
        createdBy: actorId,
      });
      const host = `${randomUUID()}.example.com`;
      const sourcePageUrl = `https://${host}/product`;
      const site = await new SitesRepository(handle.db).insertPrimary({
        workspaceId,
        projectId: project.id,
        origin: `https://${host}`,
        host,
        marketCodes: [],
        languageCodes: [],
      });
      const profiles = new IcpProfilesRepository(handle.db);
      const insertProfile = async (version: number, labelSuffix: string) => {
        const profile = { productName: `${label} ${labelSuffix}` };
        return profiles.insertVersion({
          workspaceId,
          projectId: project.id,
          version,
          status: "draft",
          profile,
          contentHash: contentHash({ status: "draft", profile }),
          createdBy: actorId,
        });
      };
      const base = await insertProfile(1, "base");
      const result = await insertProfile(2, "result");
      const alternateResult = await insertProfile(3, "alternate result");
      const source = await new SourceConnectionsRepository(
        handle.db,
      ).insertDefaultCrawl({
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        createdBy: actorId,
      });
      const collectionRun = await new AsyncRunsRepository(
        handle.db,
      ).insertQueued({
        workspaceId,
        projectId: project.id,
        kind: "collection",
        activeKey: `profile-source:${randomUUID()}`,
        initiatedBy: actorId,
        contractVersion: "2026-07-21",
      });
      await new CollectionRunsRepository(handle.db).insertPlaceholder({
        runId: collectionRun.id,
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        sourceConnectionId: source.id,
        provider: "crawl",
        operation: "site_graph",
        methodVersion: "crawl.site_graph.v2",
        parametersHash: contentHash({ projectId: project.id, siteId: site.id }),
      });
      const snapshot = await new DataSnapshotsRepository(handle.db).insert({
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        collectionRunId: collectionRun.id,
        sourceConnectionId: source.id,
        provider: "crawl",
        datasetKey: "crawl.site_graph.v1",
        schemaVersion: "0.2.0",
        methodVersion: "crawl.site_graph.v2",
        capturedAt: "2026-07-22T08:00:00.000Z",
        sourceWindow: { start: null, end: null },
        availability: "available",
        limitation: "Disposable Product Profile source snapshot.",
        rawObjectKey: null,
        rowCount: 1,
        checksum: contentHash({ collectionRunId: collectionRun.id }),
      });
      const dataForSeoSource = await new SourceConnectionsRepository(
        handle.db,
      ).insertConnection({
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        provider: "dataforseo",
        connectionType: "api_key_stub",
        state: "connected",
        config: { locationCode: 2840, languageCode: "en" },
        limitation: "Disposable non-Crawl source snapshot.",
        connectedAt: true,
        createdBy: actorId,
      });
      const dataForSeoRun = await new AsyncRunsRepository(
        handle.db,
      ).insertQueued({
        workspaceId,
        projectId: project.id,
        kind: "collection",
        activeKey: `profile-non-crawl-source:${randomUUID()}`,
        initiatedBy: actorId,
        contractVersion: "2026-07-21",
      });
      await new CollectionRunsRepository(handle.db).insertPlaceholder({
        runId: dataForSeoRun.id,
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        sourceConnectionId: dataForSeoSource.id,
        provider: "dataforseo",
        operation: "keyword_gap_import",
        methodVersion: "dataforseo.ranked_keywords.v1",
        parametersHash: contentHash({
          projectId: project.id,
          provider: "dataforseo",
        }),
      });
      const wrongProviderSnapshot = await new DataSnapshotsRepository(
        handle.db,
      ).insert({
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        collectionRunId: dataForSeoRun.id,
        sourceConnectionId: dataForSeoSource.id,
        provider: "dataforseo",
        datasetKey: "csv.keyword_gap.v1",
        schemaVersion: "dataforseo.ranked_keywords.v1",
        methodVersion: "dataforseo.ranked_keywords.v1",
        capturedAt: "2026-07-22T08:00:00.000Z",
        sourceWindow: { start: null, end: null },
        availability: "available",
        limitation: "Disposable non-Crawl source snapshot.",
        rawObjectKey: null,
        rowCount: 0,
        checksum: contentHash({ dataForSeoRunId: dataForSeoRun.id }),
      });
      return {
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        baseProfileId: base.id,
        baseProfileVersion: base.version,
        baseProfileContentHash: base.content_hash,
        sourcePageUrl,
        sourceCollectionRunId: collectionRun.id,
        sourceConnectionId: source.id,
        sourceSnapshotId: snapshot.id,
        sourceSnapshotChecksum: snapshot.checksum,
        wrongProviderSnapshotId: wrongProviderSnapshot.id,
        resultProfileId: result.id,
        alternateResultProfileId: alternateResult.id,
      };
    };

    fixture = {
      actorId,
      primary: await createProjectFixture(workspace!.id, "Primary"),
      foreignProject: await createProjectFixture(workspace!.id, "Foreign"),
      foreignWorkspace: await createProjectFixture(
        otherWorkspace!.id,
        "Other workspace",
      ),
    };
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

  function manifest(project: ProjectFixture) {
    return {
      schemaVersion: "product-profile-synthesis-input.0.3.0",
      selectionPolicyVersion: "product-profile-page-selection.0.3.0",
      projectId: project.projectId,
      siteId: project.siteId,
      sourcePageUrl: project.sourcePageUrl,
      baseProfile: {
        id: project.baseProfileId,
        version: project.baseProfileVersion,
        contentHash: project.baseProfileContentHash,
        status: "draft",
      },
      crawlSnapshot: {
        id: project.sourceSnapshotId,
        collectionRunId: project.sourceCollectionRunId,
        sourceConnectionId: project.sourceConnectionId,
        provider: "crawl",
        datasetKey: "crawl.site_graph.v1",
        schemaVersion: "0.2.0",
        methodVersion: "crawl.site_graph.v2",
        capturedAt: "2026-07-22T08:00:00.000Z",
        checksum: project.sourceSnapshotChecksum,
        availability: "available",
        rowCount: 1,
        limitation: "Disposable Product Profile source snapshot.",
      },
      pages: [
        {
          pageSnapshotId: randomUUID(),
          sitePageId: randomUUID(),
          dataSnapshotId: project.sourceSnapshotId,
          normalizedUrl: project.sourcePageUrl,
          normalizedUrlHash: contentHash(project.sourcePageUrl),
          contentHash: contentHash({ sourcePageUrl: project.sourcePageUrl }),
          capturedAt: "2026-07-22T08:00:00.000Z",
        },
      ],
    };
  }

  async function createRun(
    project: ProjectFixture,
    kind: "product_profile_synthesis" | "diagnostic" =
      "product_profile_synthesis",
  ) {
    return new AsyncRunsRepository(handle.db).insertQueued({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      kind,
      activeKey: `product-profile:${randomUUID()}`,
      initiatedBy: fixture.actorId,
      contractVersion: "2026-07-21",
      requestPayload: { command: "product_profile_synthesis" },
    });
  }

  async function insertPlaceholder(
    project: ProjectFixture,
    runId: string,
  ) {
    const inputManifest = manifest(project);
    return new ProductProfileRunsRepository(handle.db).insertPlaceholder({
      runId,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      siteId: project.siteId,
      baseIcpProfileId: project.baseProfileId,
      baseIcpProfileVersion: project.baseProfileVersion,
      baseIcpProfileContentHash: project.baseProfileContentHash,
      sourceSnapshotId: project.sourceSnapshotId,
      synthesisVersion: "product-profile-synthesis.0.3.0",
      promptSetVersion: "product-profile-prompts.0.3.0",
      inputManifest,
      inputHash: contentHash(inputManifest),
    });
  }

  async function insertInvocation(
    project: ProjectFixture,
    runId: string,
    inputHash: string,
    overrides: {
      readonly task?: "product_profile_synthesis" | "artifact_generation";
      readonly promptSetVersion?: string;
      readonly status?: "succeeded" | "failed";
      readonly outputHash?: string | null;
    } = {},
  ) {
    return new AnalysisInvocationsRepository(
      handle.db,
    ).insert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      asyncRunId: runId,
      task: overrides.task ?? "product_profile_synthesis",
      provider: "openai",
      model: "gpt-test",
      promptSetVersion:
        overrides.promptSetVersion ?? "product-profile-prompts.0.3.0",
      inputHash,
      outputHash:
        overrides.outputHash === undefined
          ? contentHash({ runId, output: randomUUID() })
          : overrides.outputHash,
      status: overrides.status ?? "succeeded",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.01,
      latencyMs: 250,
      errorCode:
        (overrides.status ?? "succeeded") === "succeeded"
          ? null
          : "PROVIDER_FAILURE",
    });
  }

  async function insertResultProfile(
    project: ProjectFixture,
    invocationId: string,
    overrides: {
      readonly sourceSiteId?: string;
      readonly sourceSnapshotId?: string;
      readonly sourcePageUrl?: string;
      readonly status?: "draft" | "complete";
    } = {},
  ) {
    const profiles = new IcpProfilesRepository(handle.db);
    const version = (await profiles.maxVersion(scope(project))) + 1;
    const profile = {
      productName: "Traceable synthesis result",
      sourceSiteId: overrides.sourceSiteId ?? project.siteId,
      sourceSnapshotId:
        overrides.sourceSnapshotId ?? project.sourceSnapshotId,
      sourcePageUrl: overrides.sourcePageUrl ?? project.sourcePageUrl,
      analysisInvocationId: invocationId,
      generatedAt: "2026-07-22T08:01:00.000Z",
      fixtureNonce: randomUUID(),
    };
    return profiles.insertVersion({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      version,
      status: overrides.status ?? "draft",
      profile,
      contentHash: contentHash({ status: overrides.status ?? "draft", profile }),
      createdBy: fixture.actorId,
    });
  }

  async function insertSuccessfulResultProfile(
    project: ProjectFixture,
    runId: string,
    promptInputHash: string,
  ) {
    const invocationId = await insertInvocation(project, runId, promptInputHash);
    const persisted = await insertResultProfile(project, invocationId);
    return { invocationId, profile: persisted };
  }

  const invocationPreflight = {
    provider: "openai",
    model: "gpt-4.1-mini",
    promptSetVersion: "product-profile-prompts.0.3.0",
    inputHash: "7".repeat(64),
  } as const;

  const failedInvocation = {
    ...invocationPreflight,
    outputHash: null,
    status: "failed" as const,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    latencyMs: 25,
    errorCode: "SERVER_ERROR",
  } as const;

  it("persists a scoped frozen run, invocation accounting, one result, and an icp_profile terminal ref", async () => {
    const project = fixture.primary;
    const projectScope = scope(project);
    const asyncRunsRepository = new AsyncRunsRepository(handle.db);
    const run = await createRun(project);
    const persisted = await insertPlaceholder(project, run.id);

    expect(persisted).toMatchObject({
      id: run.id,
      workspace_id: project.workspaceId,
      project_id: project.projectId,
      site_id: project.siteId,
      base_icp_profile_id: project.baseProfileId,
      base_icp_profile_version: 1,
      base_icp_profile_content_hash: project.baseProfileContentHash,
      source_snapshot_id: project.sourceSnapshotId,
      prompt_input_hash: null,
      result_icp_profile_id: null,
    });

    const repository = new ProductProfileRunsRepository(handle.db);
    await expect(repository.findById(projectScope, run.id)).resolves.toEqual(
      persisted,
    );
    await expect(
      repository.findById(scope(fixture.foreignProject), run.id),
    ).resolves.toBeNull();
    await expect(
      repository.findById(scope(fixture.foreignWorkspace), run.id),
    ).resolves.toBeNull();

    const promptInputHash = contentHash({
      promptVersion: persisted.prompt_set_version,
      pages: [{ pageKey: "page-1", title: "Primary product" }],
    });
    expect(promptInputHash).not.toBe(persisted.input_hash);
    await expect(
      repository.setPromptInputHash(projectScope, run.id, promptInputHash),
    ).resolves.toBe(true);
    const result = await insertSuccessfulResultProfile(
      project,
      run.id,
      promptInputHash,
    );
    const invocationId = result.invocationId;
    expect(invocationId).toEqual(expect.any(String));
    await expect(
      new AnalysisInvocationsRepository(handle.db).countByAsyncRunTask(
        projectScope,
        run.id,
        "product_profile_synthesis",
      ),
    ).resolves.toBe(1);

    const claimed = await asyncRunsRepository.claim(projectScope, run.id);
    expect(claimed).not.toBeNull();
    await expect(
      repository.setResult(projectScope, run.id, project.resultProfileId),
    ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23514");
    await expect(
      repository.setResult(
        projectScope,
        run.id,
        result.profile.id,
      ),
    ).resolves.toBe(true);
    await expect(
      repository.setResult(projectScope, run.id, result.profile.id),
    ).resolves.toBe(false);
    await expect(
      asyncRunsRepository.setTerminal(toRunAttempt(claimed!), {
        status: "completed",
        resultType: "icp_profile",
        resultId: result.profile.id,
      }),
    ).resolves.toBe(true);

    await expect(
      asyncRunsRepository.findById(projectScope, run.id),
    ).resolves.toMatchObject({
      kind: "product_profile_synthesis",
      status: "completed",
      result_type: "icp_profile",
      result_id: result.profile.id,
    });
    await expect(repository.findById(projectScope, run.id)).resolves.toMatchObject(
      { result_icp_profile_id: result.profile.id },
    );

    // The run ledger points at an immutable version; it never becomes a second
    // mutable source of Product Profile truth.
    await expectPgCode(
      handle.db
        .update(icpProfiles)
        .set({ profile: { productName: "mutated in place" } })
        .where(eq(icpProfiles.id, result.profile.id)),
      "55000",
    );
  });

  it("accepts only the new canonical run kind, result type, and invocation task", async () => {
    const project = fixture.primary;
    const invalidRunId = randomUUID();
    await expectPgCode(
      handle.db.insert(asyncRuns).values({
        id: invalidRunId,
        workspace_id: project.workspaceId,
        project_id: project.projectId,
        kind: "invented_kind",
        active_key: `invalid-kind:${invalidRunId}`,
        contract_version: "2026-07-21",
        initiated_by: fixture.actorId,
      }),
      "23514",
    );

    const invalidResultRunId = randomUUID();
    await expectPgCode(
      handle.db.insert(asyncRuns).values({
        id: invalidResultRunId,
        workspace_id: project.workspaceId,
        project_id: project.projectId,
        kind: "product_profile_synthesis",
        status: "completed",
        active_key: `invalid-result:${invalidResultRunId}`,
        contract_version: "2026-07-21",
        result_type: "invented_result",
        result_id: project.resultProfileId,
        attempt_count: 1,
        initiated_by: fixture.actorId,
        started_at: "2026-07-22T08:00:00.000Z",
        completed_at: "2026-07-22T08:01:00.000Z",
      }),
      "23514",
    );

    await expectPgCode(
      handle.db.insert(analysisInvocations).values({
        workspace_id: project.workspaceId,
        project_id: project.projectId,
        async_run_id: null,
        task: "invented_task",
        provider: "openai",
        model: "gpt-test",
        prompt_set_version: "product-profile-prompts.0.3.0",
        input_hash: "a".repeat(64),
        output_hash: null,
        status: "failed",
        input_tokens: null,
        output_tokens: null,
        cost_usd: null,
        latency_ms: 1,
        error_code: "INVALID_TASK",
      }),
      "23514",
    );
  });

  it("binds every Product Profile async result to the run ledger and rejects partial or terminal drift", async () => {
    const project = fixture.primary;
    const projectScope = scope(project);
    const asyncRepository = new AsyncRunsRepository(handle.db);
    const profileRepository = new ProductProfileRunsRepository(handle.db);
    const run = await createRun(project);
    const persisted = await insertPlaceholder(project, run.id);
    const promptInputHash = contentHash({
      promptVersion: persisted.prompt_set_version,
      sourcePageUrl: project.sourcePageUrl,
      semanticFields: ["productName"],
    });
    await profileRepository.setPromptInputHash(
      projectScope,
      run.id,
      promptInputHash,
    );
    const result = await insertSuccessfulResultProfile(
      project,
      run.id,
      promptInputHash,
    );
    await profileRepository.setResult(
      projectScope,
      run.id,
      result.profile.id,
    );
    const claimed = await asyncRepository.claim(projectScope, run.id);
    expect(claimed).not.toBeNull();
    const attempt = toRunAttempt(claimed!);

    await expectPgCode(
      asyncRepository.setTerminal(attempt, { status: "completed" }),
      "23514",
    );
    await expectPgCode(
      asyncRepository.setTerminal(attempt, {
        status: "completed",
        resultType: "artifact",
        resultId: result.profile.id,
      }),
      "23514",
    );
    await expectPgCode(
      asyncRepository.setTerminal(attempt, {
        status: "completed",
        resultType: "icp_profile",
        resultId: project.alternateResultProfileId,
      }),
      "23514",
    );
    await expectPgCode(
      asyncRepository.setTerminal(attempt, { status: "partial" }),
      "23514",
    );
    await expectPgCode(
      asyncRepository.setTerminal(attempt, {
        status: "failed",
        resultType: "icp_profile",
        resultId: result.profile.id,
      }),
      "23514",
    );
    await expectPgCode(
      asyncRepository.setTerminal(attempt, {
        status: "cancelled",
        resultType: "icp_profile",
        resultId: result.profile.id,
      }),
      "23514",
    );

    await expect(
      asyncRepository.setTerminal(attempt, {
        status: "completed",
        resultType: "icp_profile",
        resultId: result.profile.id,
      }),
    ).resolves.toBe(true);
    await expectPgCode(
      handle.db
        .update(asyncRuns)
        .set({ result_id: project.alternateResultProfileId })
        .where(eq(asyncRuns.id, run.id)),
      "23514",
    );
    await expectPgCode(
      handle.db
        .update(asyncRuns)
        .set({ result_type: null, result_id: null })
        .where(eq(asyncRuns.id, run.id)),
      "23514",
    );

    const failedRun = await createRun(project);
    await insertPlaceholder(project, failedRun.id);
    const failedClaim = await asyncRepository.claim(
      projectScope,
      failedRun.id,
    );
    await expect(
      asyncRepository.setTerminal(toRunAttempt(failedClaim!), {
        status: "failed",
        lastErrorCode: "PROFILE_SYNTHESIS_FAILED",
        lastErrorSummary: "No canonical result was persisted.",
      }),
    ).resolves.toBe(true);
    await expectPgCode(
      handle.db
        .update(asyncRuns)
        .set({
          result_type: "icp_profile",
          result_id: result.profile.id,
        })
        .where(eq(asyncRuns.id, failedRun.id)),
      "23514",
    );
  });

  it("rejects wrong async kind, scope, Site, profile, and base version", async () => {
    const project = fixture.primary;
    const inputManifest = manifest(project);
    const inputHash = contentHash(inputManifest);
    const repository = new ProductProfileRunsRepository(handle.db);

    const wrongKindRun = await createRun(project, "diagnostic");
    await expectPgCode(
      repository.insertPlaceholder({
        runId: wrongKindRun.id,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: project.siteId,
        baseIcpProfileId: project.baseProfileId,
        baseIcpProfileVersion: project.baseProfileVersion,
        baseIcpProfileContentHash: project.baseProfileContentHash,
        sourceSnapshotId: project.sourceSnapshotId,
        synthesisVersion: "product-profile-synthesis.0.3.0",
        promptSetVersion: "product-profile-prompts.0.3.0",
        inputManifest,
        inputHash,
      }),
      "23514",
    );

    const scopedRun = await createRun(project);
    for (const invalid of [
      {
        workspaceId: fixture.foreignWorkspace.workspaceId,
        projectId: fixture.foreignWorkspace.projectId,
        siteId: fixture.foreignWorkspace.siteId,
        baseIcpProfileId: fixture.foreignWorkspace.baseProfileId,
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash:
          fixture.foreignWorkspace.baseProfileContentHash,
        sourceSnapshotId: fixture.foreignWorkspace.sourceSnapshotId,
      },
      {
        workspaceId: fixture.foreignProject.workspaceId,
        projectId: fixture.foreignProject.projectId,
        siteId: fixture.foreignProject.siteId,
        baseIcpProfileId: fixture.foreignProject.baseProfileId,
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash: fixture.foreignProject.baseProfileContentHash,
        sourceSnapshotId: fixture.foreignProject.sourceSnapshotId,
      },
      {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: fixture.foreignProject.siteId,
        baseIcpProfileId: project.baseProfileId,
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash: project.baseProfileContentHash,
        sourceSnapshotId: project.sourceSnapshotId,
      },
      {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: project.siteId,
        baseIcpProfileId: project.baseProfileId,
        baseIcpProfileVersion: project.baseProfileVersion,
        baseIcpProfileContentHash: "0".repeat(64),
        sourceSnapshotId: project.sourceSnapshotId,
      },
      {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: project.siteId,
        baseIcpProfileId: fixture.foreignProject.baseProfileId,
        baseIcpProfileVersion: 1,
        baseIcpProfileContentHash: fixture.foreignProject.baseProfileContentHash,
        sourceSnapshotId: project.sourceSnapshotId,
      },
      {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: project.siteId,
        baseIcpProfileId: project.baseProfileId,
        baseIcpProfileVersion: 99,
        baseIcpProfileContentHash: project.baseProfileContentHash,
        sourceSnapshotId: project.sourceSnapshotId,
      },
      {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: project.siteId,
        baseIcpProfileId: project.baseProfileId,
        baseIcpProfileVersion: project.baseProfileVersion,
        baseIcpProfileContentHash: project.baseProfileContentHash,
        sourceSnapshotId: fixture.foreignProject.sourceSnapshotId,
      },
      {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: project.siteId,
        baseIcpProfileId: project.baseProfileId,
        baseIcpProfileVersion: project.baseProfileVersion,
        baseIcpProfileContentHash: project.baseProfileContentHash,
        sourceSnapshotId: project.wrongProviderSnapshotId,
      },
    ]) {
      await expectPgCode(
        repository.insertPlaceholder({
          runId: scopedRun.id,
          ...invalid,
          synthesisVersion: "product-profile-synthesis.0.3.0",
          promptSetVersion: "product-profile-prompts.0.3.0",
          inputManifest,
          inputHash,
        }),
        "23514",
      );
    }

    await expect(repository.findById(scope(project), scopedRun.id)).resolves.toBeNull();
  });

  it("rejects repository hash drift, malformed DB inputs, and every frozen-input mutation", async () => {
    const project = fixture.primary;
    const run = await createRun(project);
    const repository = new ProductProfileRunsRepository(handle.db);
    const inputManifest = manifest(project);

    await expect(
      repository.insertPlaceholder({
        runId: run.id,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: project.siteId,
        baseIcpProfileId: project.baseProfileId,
        baseIcpProfileVersion: project.baseProfileVersion,
        baseIcpProfileContentHash: project.baseProfileContentHash,
        sourceSnapshotId: project.sourceSnapshotId,
        synthesisVersion: "product-profile-synthesis.0.3.0",
        promptSetVersion: "product-profile-prompts.0.3.0",
        inputManifest,
        inputHash: "f".repeat(64),
      }),
    ).rejects.toThrow(/input hash does not match its frozen manifest/i);
    await expect(repository.findById(scope(project), run.id)).resolves.toBeNull();

    const mismatchedManifests = [
      {
        ...inputManifest,
        projectId: fixture.foreignProject.projectId,
      },
      {
        ...inputManifest,
        siteId: fixture.foreignProject.siteId,
      },
      {
        ...inputManifest,
        baseProfile: {
          ...inputManifest.baseProfile,
          id: fixture.foreignProject.baseProfileId,
        },
      },
      {
        ...inputManifest,
        baseProfile: { ...inputManifest.baseProfile, version: 99 },
      },
      {
        ...inputManifest,
        baseProfile: {
          ...inputManifest.baseProfile,
          contentHash: "0".repeat(64),
        },
      },
      {
        ...inputManifest,
        crawlSnapshot: {
          ...inputManifest.crawlSnapshot,
          id: fixture.foreignProject.sourceSnapshotId,
        },
        pages: inputManifest.pages.map((page) => ({
          ...page,
          dataSnapshotId: fixture.foreignProject.sourceSnapshotId,
        })),
      },
    ];
    for (const mismatchedManifest of mismatchedManifests) {
      await expectPgCode(
        repository.insertPlaceholder({
          runId: run.id,
          workspaceId: project.workspaceId,
          projectId: project.projectId,
          siteId: project.siteId,
          baseIcpProfileId: project.baseProfileId,
          baseIcpProfileVersion: project.baseProfileVersion,
          baseIcpProfileContentHash: project.baseProfileContentHash,
          sourceSnapshotId: project.sourceSnapshotId,
          synthesisVersion: "product-profile-synthesis.0.3.0",
          promptSetVersion: "product-profile-prompts.0.3.0",
          inputManifest: mismatchedManifest,
          inputHash: contentHash(mismatchedManifest),
        }),
        "23514",
      );
    }

    const invalidBaseStatusManifest = {
      ...inputManifest,
      baseProfile: { ...inputManifest.baseProfile, status: "complete" },
    };
    await expect(
      repository.insertPlaceholder({
        runId: run.id,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        siteId: project.siteId,
        baseIcpProfileId: project.baseProfileId,
        baseIcpProfileVersion: project.baseProfileVersion,
        baseIcpProfileContentHash: project.baseProfileContentHash,
        sourceSnapshotId: project.sourceSnapshotId,
        synthesisVersion: "product-profile-synthesis.0.3.0",
        promptSetVersion: "product-profile-prompts.0.3.0",
        inputManifest: invalidBaseStatusManifest,
        inputHash: contentHash(invalidBaseStatusManifest),
      }),
    ).rejects.toThrow(/draft/i);

    await expectPgCode(
      handle.db.insert(productProfileRuns).values({
        id: run.id,
        workspace_id: project.workspaceId,
        project_id: project.projectId,
        site_id: project.siteId,
        base_icp_profile_id: project.baseProfileId,
        base_icp_profile_version: project.baseProfileVersion,
        base_icp_profile_content_hash: project.baseProfileContentHash,
        source_snapshot_id: project.sourceSnapshotId,
        synthesis_version: "product-profile-synthesis.0.3.0",
        prompt_set_version: "product-profile-prompts.0.3.0",
        input_manifest: [] as never,
        input_hash: "not-a-sha256",
      }),
      "23514",
    );

    const persisted = await insertPlaceholder(project, run.id);
    const promptInputHash = contentHash({ prompt: "frozen allowlist" });
    await expect(
      repository.setPromptInputHash(scope(project), run.id, promptInputHash),
    ).resolves.toBe(true);
    await expect(
      repository.setPromptInputHash(scope(project), run.id, promptInputHash),
    ).resolves.toBe(true);
    await expect(
      repository.setPromptInputHash(
        scope(project),
        run.id,
        "9".repeat(64),
      ),
    ).resolves.toBe(false);
    await expectPgCode(
      handle.db
        .update(productProfileRuns)
        .set({ prompt_input_hash: null })
        .where(eq(productProfileRuns.id, run.id)),
      "23514",
    );
    await expectPgCode(
      handle.db
        .update(productProfileRuns)
        .set({ prompt_input_hash: "9".repeat(64) })
        .where(eq(productProfileRuns.id, run.id)),
      "23514",
    );
    for (const mutation of [
      { input_manifest: { ...persisted.input_manifest, pages: ["changed"] } },
      { input_hash: "0".repeat(64) },
      { synthesis_version: "product-profile-synthesis.9.9.9" },
      { prompt_set_version: "product-profile-prompts.9.9.9" },
      { base_icp_profile_version: 2 },
      { base_icp_profile_content_hash: "1".repeat(64) },
      { source_snapshot_id: fixture.foreignProject.sourceSnapshotId },
      { site_id: fixture.foreignProject.siteId },
    ]) {
      await expectPgCode(
        handle.db
          .update(productProfileRuns)
          .set(mutation)
          .where(eq(productProfileRuns.id, run.id)),
        "23514",
      );
    }
    await expectPgCode(
      handle.db
        .delete(productProfileRuns)
        .where(eq(productProfileRuns.id, run.id)),
      "23514",
    );
  });

  it("requires a draft result bound to the exact successful invocation, input, prompt, Site, and Crawl snapshot", async () => {
    const project = fixture.primary;
    const run = await createRun(project);
    const repository = new ProductProfileRunsRepository(handle.db);
    const persistedRun = await insertPlaceholder(project, run.id);
    const projectScope = scope(project);
    const promptInputHash = contentHash({
      promptVersion: persistedRun.prompt_set_version,
      sourcePageUrl: project.sourcePageUrl,
    });
    expect(promptInputHash).not.toBe(persistedRun.input_hash);
    await expect(
      repository.setPromptInputHash(projectScope, run.id, promptInputHash),
    ).resolves.toBe(true);

    const rejectInvocation = async (
      invocationInputHash: string,
      invocationOverrides: Parameters<typeof insertInvocation>[3],
    ) => {
      const invocationId = await insertInvocation(
        project,
        run.id,
        invocationInputHash,
        invocationOverrides,
      );
      const profile = await insertResultProfile(project, invocationId);
      await expectPgCode(
        repository.setResult(projectScope, run.id, profile.id),
        "23514",
      );
    };

    // The durable manifest hash was previously (and impossibly) treated as the
    // redacted LLM prompt hash. A succeeded invocation carrying it must fail.
    await rejectInvocation(persistedRun.input_hash, {});
    await rejectInvocation(promptInputHash, { status: "failed" });
    await rejectInvocation(promptInputHash, {
      task: "artifact_generation",
    });
    await rejectInvocation(promptInputHash, {
      promptSetVersion: "product-profile-prompts.wrong",
    });
    await rejectInvocation("f".repeat(64), {});
    await rejectInvocation(promptInputHash, { outputHash: null });

    const otherRun = await createRun(project);
    const otherRunInvocationId = await insertInvocation(
      project,
      otherRun.id,
      promptInputHash,
    );
    const otherRunProfile = await insertResultProfile(
      project,
      otherRunInvocationId,
    );
    await expectPgCode(
      repository.setResult(projectScope, run.id, otherRunProfile.id),
      "23514",
    );

    const validInvocationId = await insertInvocation(
      project,
      run.id,
      promptInputHash,
    );
    for (const profile of [
      await insertResultProfile(project, validInvocationId, {
        sourceSiteId: fixture.foreignProject.siteId,
      }),
      await insertResultProfile(project, validInvocationId, {
        sourceSnapshotId: fixture.foreignProject.sourceSnapshotId,
      }),
      await insertResultProfile(project, validInvocationId, {
        sourcePageUrl: `${project.sourcePageUrl}/other`,
      }),
      await insertResultProfile(project, validInvocationId, {
        status: "complete",
      }),
    ]) {
      await expectPgCode(
        repository.setResult(projectScope, run.id, profile.id),
        "23514",
      );
    }

    const validProfile = await insertResultProfile(
      project,
      validInvocationId,
    );
    await expect(
      repository.setResult(projectScope, run.id, validProfile.id),
    ).resolves.toBe(true);
  });

  it("allows only null-to-one same-project result and never mutates the ICP ledger", async () => {
    const project = fixture.primary;
    const run = await createRun(project);
    const repository = new ProductProfileRunsRepository(handle.db);
    const persisted = await insertPlaceholder(project, run.id);

    await expect(
      repository.setResult(
        scope(fixture.foreignProject),
        run.id,
        project.resultProfileId,
      ),
    ).resolves.toBe(false);
    await expectPgCode(
      handle.db
        .update(productProfileRuns)
        .set({
          result_icp_profile_id: fixture.foreignProject.resultProfileId,
        })
        .where(eq(productProfileRuns.id, run.id)),
      "23514",
    );
    await expectPgCode(
      repository.setResult(scope(project), run.id, project.resultProfileId),
      "23514",
    );
    const promptInputHash = contentHash({
      source: "allowlisted prompt",
      manifestHash: persisted.input_hash,
    });
    await expect(
      repository.setPromptInputHash(scope(project), run.id, promptInputHash),
    ).resolves.toBe(true);
    const validResult = await insertSuccessfulResultProfile(
      project,
      run.id,
      promptInputHash,
    );
    await expect(
      repository.setResult(scope(project), run.id, validResult.profile.id),
    ).resolves.toBe(true);
    await expectPgCode(
      handle.db
        .update(productProfileRuns)
        .set({ result_icp_profile_id: project.alternateResultProfileId })
        .where(eq(productProfileRuns.id, run.id)),
      "23514",
    );
    await expectPgCode(
      handle.db
        .update(productProfileRuns)
        .set({ result_icp_profile_id: null })
        .where(eq(productProfileRuns.id, run.id)),
      "23514",
    );

    await expect(
      new IcpProfilesRepository(handle.db).findById(
        scope(project),
        validResult.profile.id,
      ),
    ).resolves.toMatchObject({
      version: validResult.profile.version,
      status: "draft",
      profile: {
        productName: "Traceable synthesis result",
        sourceSiteId: project.siteId,
        sourceSnapshotId: project.sourceSnapshotId,
        sourcePageUrl: project.sourcePageUrl,
        analysisInvocationId: validResult.invocationId,
      },
    });
  });

  it("serializes simultaneous reservations to one database-owned ordinal and delivery attempt", async () => {
    const project = fixture.primary;
    const run = await createRun(project);
    await insertPlaceholder(project, run.id);
    const asyncRepository = new AsyncRunsRepository(handle.db);
    const claimed = await asyncRepository.claim(scope(project), run.id);
    const attempt = toRunAttempt(claimed!);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        new ProductProfileInvocationAttemptsRepository(handle.db).reserve(
          attempt,
          invocationPreflight,
        ),
      ),
    );

    expect(results.filter((result) => result.kind === "reserved")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.kind === "existing")).toHaveLength(
      7,
    );
    const rows = await handle.db
      .select()
      .from(productProfileInvocationAttempts)
      .where(eq(productProfileInvocationAttempts.product_profile_run_id, run.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ordinal: 1,
      async_attempt_count: attempt.attemptCount,
      status: "reserved",
      input_hash: invocationPreflight.inputHash,
    });
  });

  it("blocks a newer delivery behind a reserved or outcome-unknown prior call", async () => {
    const project = fixture.primary;
    const projectScope = scope(project);
    const run = await createRun(project);
    await insertPlaceholder(project, run.id);
    const asyncRepository = new AsyncRunsRepository(handle.db);
    const reservations = new ProductProfileInvocationAttemptsRepository(
      handle.db,
    );
    const firstClaim = await asyncRepository.claim(projectScope, run.id);
    const firstAttempt = toRunAttempt(firstClaim!);
    const first = await reservations.reserve(
      firstAttempt,
      invocationPreflight,
    );
    expect(first.kind).toBe("reserved");

    await asyncRepository.resetToQueued(firstAttempt);
    const secondClaim = await asyncRepository.claim(projectScope, run.id);
    const secondAttempt = toRunAttempt(secondClaim!);
    await expect(
      reservations.reserve(firstAttempt, invocationPreflight),
    ).resolves.toEqual({ kind: "stale" });
    const unresolved = await reservations.reserve(
      secondAttempt,
      invocationPreflight,
    );
    expect(unresolved).toMatchObject({
      kind: "unresolved",
      reservation: {
        id: first.kind === "reserved" ? first.reservation.id : "unreachable",
        status: "reserved",
      },
    });

    if (first.kind !== "reserved") throw new Error("reservation missing");
    await expect(
      reservations.markOutcomeUnknown(
        firstAttempt,
        first.reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toMatchObject({
      kind: "marked",
      reservation: { status: "outcome_unknown" },
    });
    await expect(
      reservations.reserve(secondAttempt, invocationPreflight),
    ).resolves.toMatchObject({
      kind: "unresolved",
      reservation: { status: "outcome_unknown", ordinal: 1 },
    });

    const rows = await handle.db
      .select()
      .from(productProfileInvocationAttempts)
      .where(eq(productProfileInvocationAttempts.product_profile_run_id, run.id));
    expect(rows).toHaveLength(1);
  });

  it("counts every finalized provider call and never allocates beyond three", async () => {
    const project = fixture.primary;
    const projectScope = scope(project);
    const run = await createRun(project);
    await insertPlaceholder(project, run.id);
    const asyncRepository = new AsyncRunsRepository(handle.db);
    const reservations = new ProductProfileInvocationAttemptsRepository(
      handle.db,
    );
    let claimed = await asyncRepository.claim(projectScope, run.id);

    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const attempt = toRunAttempt(claimed!);
      const reserved = await reservations.reserve(
        attempt,
        invocationPreflight,
      );
      expect(reserved).toMatchObject({
        kind: "reserved",
        reservation: {
          ordinal,
          async_attempt_count: attempt.attemptCount,
        },
      });
      if (reserved.kind !== "reserved") throw new Error("reservation missing");
      await expect(
        reservations.finalizeWithInvocation(
          attempt,
          reserved.reservation.id,
          failedInvocation,
        ),
      ).resolves.toMatchObject({
        kind: "finalized",
        reservation: { ordinal, status: "failed" },
      });
      await asyncRepository.resetToQueued(attempt);
      claimed = await asyncRepository.claim(projectScope, run.id);
    }

    const fourthAttempt = toRunAttempt(claimed!);
    const exhausted = await Promise.all(
      Array.from({ length: 5 }, () =>
        reservations.reserve(fourthAttempt, invocationPreflight),
      ),
    );
    expect(exhausted).toEqual(
      Array.from({ length: 5 }, () => ({ kind: "budget_exhausted" })),
    );
    const rows = await handle.db
      .select()
      .from(productProfileInvocationAttempts)
      .where(eq(productProfileInvocationAttempts.product_profile_run_id, run.id));
    expect(rows.map((row) => row.ordinal)).toEqual([1, 2, 3]);
    expect(new Set(rows.map((row) => row.async_attempt_count)).size).toBe(3);
  });

  it("fences reservation identity while allowing an old call to finalize after AsyncRun advances", async () => {
    const project = fixture.primary;
    const projectScope = scope(project);
    const run = await createRun(project);
    await insertPlaceholder(project, run.id);
    const asyncRepository = new AsyncRunsRepository(handle.db);
    const reservations = new ProductProfileInvocationAttemptsRepository(
      handle.db,
    );
    const firstClaim = await asyncRepository.claim(projectScope, run.id);
    const firstAttempt = toRunAttempt(firstClaim!);
    const reserved = await reservations.reserve(
      firstAttempt,
      invocationPreflight,
    );
    if (reserved.kind !== "reserved") throw new Error("reservation missing");
    await asyncRepository.resetToQueued(firstAttempt);
    const secondClaim = await asyncRepository.claim(projectScope, run.id);
    const secondAttempt = toRunAttempt(secondClaim!);

    await expect(
      reservations.finalizeWithInvocation(
        secondAttempt,
        reserved.reservation.id,
        failedInvocation,
      ),
    ).resolves.toEqual({ kind: "stale_reservation" });
    const finalized = await reservations.finalizeWithInvocation(
      firstAttempt,
      reserved.reservation.id,
      failedInvocation,
    );
    expect(finalized).toMatchObject({
      kind: "finalized",
      reservation: { status: "failed" },
    });
    await expect(
      reservations.finalizeWithInvocation(
        firstAttempt,
        reserved.reservation.id,
        failedInvocation,
      ),
    ).resolves.toEqual(finalized);
    await expect(
      reservations.markOutcomeUnknown(
        firstAttempt,
        reserved.reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toMatchObject({
      kind: "finalized",
      invocationId:
        finalized.kind === "finalized" ? finalized.invocationId : null,
    });
  });

  it("keeps a provider-success reservation unresolved when invocation persistence rolls back", async () => {
    const project = fixture.primary;
    const projectScope = scope(project);
    const run = await createRun(project);
    await insertPlaceholder(project, run.id);
    const asyncRepository = new AsyncRunsRepository(handle.db);
    const firstClaim = await asyncRepository.claim(projectScope, run.id);
    const firstAttempt = toRunAttempt(firstClaim!);
    const reservations = new ProductProfileInvocationAttemptsRepository(
      handle.db,
    );
    const reserved = await reservations.reserve(
      firstAttempt,
      invocationPreflight,
    );
    if (reserved.kind !== "reserved") throw new Error("reservation missing");

    const rollbackSentinel = new Error("ROLLBACK_AFTER_PROVIDER_SUCCESS");
    await expect(
      handle.db.transaction(async (tx) => {
        await expect(
          new ProductProfileInvocationAttemptsRepository(
            tx,
          ).finalizeWithInvocation(
            firstAttempt,
            reserved.reservation.id,
            {
              ...invocationPreflight,
              outputHash: "8".repeat(64),
              status: "succeeded",
              inputTokens: 100,
              outputTokens: 50,
              costUsd: 0.01,
              latencyMs: 25,
              errorCode: null,
            },
          ),
        ).resolves.toMatchObject({
          kind: "finalized",
          invocationId: reserved.reservation.planned_analysis_invocation_id,
        });
        throw rollbackSentinel;
      }),
    ).rejects.toBe(rollbackSentinel);

    await expect(
      handle.db
        .select({ id: analysisInvocations.id })
        .from(analysisInvocations)
        .where(
          eq(
            analysisInvocations.id,
            reserved.reservation.planned_analysis_invocation_id,
          ),
        ),
    ).resolves.toEqual([]);
    const [rolledBackReservation] = await handle.db
      .select()
      .from(productProfileInvocationAttempts)
      .where(eq(productProfileInvocationAttempts.id, reserved.reservation.id));
    expect(rolledBackReservation).toMatchObject({
      status: "reserved",
      analysis_invocation_id: null,
    });

    await expect(
      reservations.markOutcomeUnknown(
        firstAttempt,
        reserved.reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toMatchObject({
      kind: "marked",
      reservation: { status: "outcome_unknown" },
    });
    await asyncRepository.resetToQueued(firstAttempt);
    const secondClaim = await asyncRepository.claim(projectScope, run.id);
    await expect(
      reservations.reserve(toRunAttempt(secondClaim!), invocationPreflight),
    ).resolves.toMatchObject({
      kind: "unresolved",
      reservation: {
        id: reserved.reservation.id,
        status: "outcome_unknown",
      },
    });
  });

  it("rejects foreign and stale canonical Product Profile evidence in preflight and at insert", async () => {
    const project = fixture.primary;
    const projectScope = scope(project);
    const capturedAt = "2026-07-22T08:02:00.000Z";

    const successfulInvocation = async (target: ProjectFixture) => {
      const run = await createRun(target);
      await insertPlaceholder(target, run.id);
      const claimed = await new AsyncRunsRepository(handle.db).claim(
        scope(target),
        run.id,
      );
      const attempt = toRunAttempt(claimed!);
      const reservations = new ProductProfileInvocationAttemptsRepository(
        handle.db,
      );
      const reserved = await reservations.reserve(attempt, invocationPreflight);
      if (reserved.kind !== "reserved") throw new Error("reservation missing");
      const finalized = await reservations.finalizeWithInvocation(
        attempt,
        reserved.reservation.id,
        {
          ...invocationPreflight,
          outputHash: contentHash({ runId: run.id, output: "success" }),
          status: "succeeded",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.01,
          latencyMs: 25,
          errorCode: null,
        },
      );
      if (finalized.kind !== "finalized") {
        throw new Error("invocation finalization missing");
      }
      return finalized.invocationId;
    };

    const primaryInvocationId = await successfulInvocation(project);
    const foreignInvocationId = await successfulInvocation(
      fixture.foreignProject,
    );
    const staleCollectionRun = await new AsyncRunsRepository(
      handle.db,
    ).insertQueued({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      kind: "collection",
      activeKey: `profile-stale-source:${randomUUID()}`,
      initiatedBy: fixture.actorId,
      contractVersion: "2026-07-21",
    });
    await new CollectionRunsRepository(handle.db).insertPlaceholder({
      runId: staleCollectionRun.id,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      siteId: project.siteId,
      sourceConnectionId: project.sourceConnectionId,
      provider: "crawl",
      operation: "site_graph",
      methodVersion: "crawl.site_graph.v2",
      parametersHash: contentHash({ staleCollectionRunId: staleCollectionRun.id }),
    });
    const staleSnapshot = await new DataSnapshotsRepository(handle.db).insert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      siteId: project.siteId,
      collectionRunId: staleCollectionRun.id,
      sourceConnectionId: project.sourceConnectionId,
      provider: "crawl",
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: "0.2.0",
      methodVersion: "crawl.site_graph.v2",
      capturedAt,
      sourceWindow: { start: null, end: null },
      availability: "available",
      limitation: "Disposable stale Product Profile snapshot.",
      rawObjectKey: null,
      rowCount: 1,
      checksum: contentHash({ staleCollectionRunId: staleCollectionRun.id }),
    });

    const pageSnapshot = async (
      target: ProjectFixture,
      snapshotId: string,
      snapshotCapturedAt: string,
      suffix: string,
    ) => {
      const normalizedUrl = `${target.sourcePageUrl}/${suffix}`;
      const page = await new SitePagesRepository(handle.db).upsertNormalizedUrl({
        workspaceId: target.workspaceId,
        projectId: target.projectId,
        siteId: target.siteId,
        normalizedUrl,
        templateKey: null,
      });
      const extract = crawlPageExtract(normalizedUrl, randomUUID());
      return new PageSnapshotsRepository(handle.db).create({
        workspaceId: target.workspaceId,
        projectId: target.projectId,
        sitePageId: page.id,
        dataSnapshotId: snapshotId,
        contentHash: contentHash(extract),
        extract,
        capturedAt: snapshotCapturedAt,
      });
    };
    const validPageSnapshot = await pageSnapshot(
      project,
      project.sourceSnapshotId,
      "2026-07-22T08:00:00.000Z",
      "valid-evidence",
    );
    const stalePageSnapshot = await pageSnapshot(
      project,
      staleSnapshot.id,
      capturedAt,
      "stale-evidence",
    );
    const foreignPageSnapshot = await pageSnapshot(
      fixture.foreignProject,
      fixture.foreignProject.sourceSnapshotId,
      "2026-07-22T08:00:00.000Z",
      "foreign-evidence",
    );

    const observation = async (
      target: ProjectFixture,
      snapshotId: string,
      observedAt: string,
      subjectRef: string,
    ) => {
      await new ObservationsRepository(handle.db).insertMany(
        scope(target),
        snapshotId,
        "crawl",
        [
          {
            metricKey: "crawl.page.v1",
            subjectType: "url",
            subjectRef,
            observedAt,
            availability: "available",
            valueNumeric: null,
            valueText: null,
            valueJson: { indexed: true },
            unit: null,
            origin: "direct_public",
            grade: "B",
            support: "supports",
            limitation: "Disposable Product Profile provenance observation.",
          },
        ],
      );
      const [row] = await handle.db
        .select({ id: normalizedObservations.id })
        .from(normalizedObservations)
        .where(eq(normalizedObservations.subject_ref, subjectRef));
      if (!row) throw new Error("observation missing");
      return row.id;
    };
    const validObservationId = await observation(
      project,
      project.sourceSnapshotId,
      "2026-07-22T08:00:00.000Z",
      `valid:${randomUUID()}`,
    );
    const staleObservationId = await observation(
      project,
      staleSnapshot.id,
      capturedAt,
      `stale:${randomUUID()}`,
    );
    const foreignObservationId = await observation(
      fixture.foreignProject,
      fixture.foreignProject.sourceSnapshotId,
      "2026-07-22T08:00:00.000Z",
      `foreign:${randomUUID()}`,
    );

    const validProfile = ProductProfileDraft.parse({
      profileSchemaVersion: "product-profile.0.3.0",
      sourceSiteId: project.siteId,
      sourcePageUrl: project.sourcePageUrl,
      sourceSnapshotId: project.sourceSnapshotId,
      analysisInvocationId: primaryInvocationId,
      generatedAt: capturedAt,
      businessHint: null,
      productName: "Traceable Product",
      oneLiner: null,
      category: null,
      productType: null,
      businessModels: [],
      valueProposition: null,
      coreFeatures: [],
      targetMarkets: [],
      targetAudiences: [],
      competitorCandidates: [],
      fieldProvenance: [
        {
          path: "/productName",
          derivation: "inferred",
          confidence: "high",
          evidenceRefs: [
            {
              evidenceRefId: randomUUID(),
              kind: "snapshot",
              snapshotId: project.sourceSnapshotId,
            },
            {
              evidenceRefId: randomUUID(),
              kind: "pageSnapshot",
              pageSnapshotId: validPageSnapshot.id,
            },
            {
              evidenceRefId: randomUUID(),
              kind: "observation",
              observationId: validObservationId,
            },
            {
              evidenceRefId: randomUUID(),
              kind: "analysisInvocation",
              analysisInvocationId: primaryInvocationId,
            },
          ],
          limitation: null,
          observedAt: capturedAt,
        },
      ],
      missingFields: [
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
      conflictingFields: [],
    });

    type MutableProfile = typeof validProfile;
    const replaceRef = (
      profile: MutableProfile,
      kind: "snapshot" | "pageSnapshot" | "observation" | "analysisInvocation",
      replacement: Record<string, string>,
    ) => {
      const cloned = structuredClone(profile) as MutableProfile;
      const refs = cloned.fieldProvenance[0]!.evidenceRefs;
      const index = refs.findIndex((ref) => ref.kind === kind);
      refs[index] = { ...refs[index]!, ...replacement } as never;
      return cloned;
    };

    const staleSnapshotProfile = replaceRef(
      { ...structuredClone(validProfile), sourceSnapshotId: staleSnapshot.id },
      "snapshot",
      { snapshotId: staleSnapshot.id },
    );
    const foreignSnapshotProfile = replaceRef(
      {
        ...structuredClone(validProfile),
        sourceSnapshotId: fixture.foreignProject.sourceSnapshotId,
      },
      "snapshot",
      { snapshotId: fixture.foreignProject.sourceSnapshotId },
    );
    const foreignInvocationProfile = replaceRef(
      {
        ...structuredClone(validProfile),
        analysisInvocationId: foreignInvocationId,
      },
      "analysisInvocation",
      { analysisInvocationId: foreignInvocationId },
    );
    const cases = [
      {
        expectedCode: "source_snapshot_site_mismatch",
        profile: foreignSnapshotProfile,
      },
      {
        expectedCode: "page_snapshot_snapshot_mismatch",
        profile: staleSnapshotProfile,
      },
      {
        expectedCode: "page_snapshot_snapshot_mismatch",
        profile: replaceRef(validProfile, "pageSnapshot", {
          pageSnapshotId: stalePageSnapshot.id,
        }),
      },
      {
        expectedCode: "page_snapshot_missing",
        profile: replaceRef(validProfile, "pageSnapshot", {
          pageSnapshotId: foreignPageSnapshot.id,
        }),
      },
      {
        expectedCode: "observation_snapshot_mismatch",
        profile: replaceRef(validProfile, "observation", {
          observationId: staleObservationId,
        }),
      },
      {
        expectedCode: "observation_missing",
        profile: replaceRef(validProfile, "observation", {
          observationId: foreignObservationId,
        }),
      },
      {
        expectedCode: "analysis_invocation_task_mismatch",
        profile: foreignInvocationProfile,
      },
    ] as const;

    const profiles = new IcpProfilesRepository(handle.db);
    for (const testCase of cases) {
      const parsed = ProductProfileDraft.parse(testCase.profile);
      const preflight = await profiles.preflightProductProfileProvenance(
        projectScope,
        parsed,
      );
      expect(preflight).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ code: testCase.expectedCode }),
        ]),
      });
      await expectPgCode(
        profiles.insertVersion({
          workspaceId: project.workspaceId,
          projectId: project.projectId,
          version: 40,
          status: "draft",
          profile: parsed,
          contentHash: contentHash({ status: "draft", profile: parsed }),
          createdBy: fixture.actorId,
        }),
        "23514",
      );
    }

    const missingTopLineage = {
      ...structuredClone(validProfile),
      sourceSnapshotId: null,
      analysisInvocationId: null,
      generatedAt: null,
    };
    const declaredRefWithCanonicalId = structuredClone(validProfile) as Record<
      string,
      unknown
    >;
    const declaredProvenance = declaredRefWithCanonicalId[
      "fieldProvenance"
    ] as Array<{ evidenceRefs: Array<Record<string, unknown>> }>;
    declaredProvenance[0]!.evidenceRefs[0] = {
      evidenceRefId: randomUUID(),
      kind: "declaredHint",
      pageSnapshotId: validPageSnapshot.id,
    };
    for (const malformed of [
      missingTopLineage as unknown as Record<string, unknown>,
      declaredRefWithCanonicalId,
    ]) {
      await expect(
        profiles.insertVersion({
          workspaceId: project.workspaceId,
          projectId: project.projectId,
          version: 40,
          status: "draft",
          profile: malformed,
          contentHash: contentHash({
            status: "draft",
            profile: malformed as CanonicalValue,
          }),
          createdBy: fixture.actorId,
        }),
      ).rejects.toThrow(/contract-valid/i);
      await expectPgCode(
        handle.db.insert(icpProfiles).values({
          workspace_id: project.workspaceId,
          project_id: project.projectId,
          version: 40,
          status: "draft",
          profile: malformed,
          content_hash: contentHash({
            status: "draft",
            profile: malformed as CanonicalValue,
          }),
          created_by: fixture.actorId,
        }),
        "23514",
      );
    }

    await expect(
      profiles.preflightProductProfileProvenance(projectScope, validProfile),
    ).resolves.toMatchObject({ ok: true, profile: validProfile });
    await expect(
      profiles.insertVersion({
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        version: 40,
        status: "draft",
        profile: validProfile,
        contentHash: "f".repeat(64),
        createdBy: fixture.actorId,
      }),
    ).rejects.toThrow(/content hash/i);
    await expect(
      profiles.insertVersion({
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        version: 40,
        status: "draft",
        profile: validProfile,
        contentHash: contentHash({ status: "draft", profile: validProfile }),
        createdBy: fixture.actorId,
      }),
    ).resolves.toMatchObject({ version: 40, profile: validProfile });
  });
});
