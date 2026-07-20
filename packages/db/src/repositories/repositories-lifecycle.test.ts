import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { ExecutionArtifactsRepository } from "./execution-artifacts.ts";
import { FindingsRepository } from "./findings.ts";
import { IcpProfilesRepository } from "./icp-profiles.ts";
import { OAuthIntentsRepository } from "./oauth-intents.ts";
import {
  decodeProjectCursor,
  encodeProjectCursor,
  ProjectsRepository,
} from "./projects.ts";
import { SitesRepository } from "./sites.ts";
import { SourceConnectionsRepository } from "./source-connections.ts";
import { SourceCredentialsRepository } from "./source-credentials.ts";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: Call[];
  enqueue(...values: unknown[]): void;
  last(method: string): Call;
} {
  const calls: Call[] = [];
  const results: unknown[] = [];
  const take = () => (results.length > 0 ? results.shift() : []);
  const query: object = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(take()).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  const executor = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          if (property === "execute") return Promise.resolve(take());
          return query;
        };
      },
    },
  );
  return {
    executor: executor as never,
    calls,
    enqueue: (...values: unknown[]) => results.push(...values),
    last(method: string): Call {
      const found = calls.findLast((call) => call.method === method);
      if (!found) throw new Error(`No ${method} call`);
      return found;
    },
  };
}

const scope = { workspaceId: "workspace-1", projectId: "project-1" };

describe("artifact and finding repositories", () => {
  it("keeps immutable artifact revisions and enforces revision CAS", async () => {
    const fake = fakeExecutor();
    const repo = new ExecutionArtifactsRepository(fake.executor);
    const artifact = {
      id: "artifact-1",
      updated_at: "2026-07-18 12:00:00+08",
      current_revision: 2,
    };

    fake.enqueue([artifact], [{ id: "artifact-2" }]);
    await expect(
      repo.insert({
        id: "artifact-1",
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        actionId: "action-1",
        artifactType: "content_brief",
        generationMode: "template",
        outputLocale: "en",
        latestGenerationRunId: "run-1",
        createdBy: "user-1",
      }),
    ).resolves.toBe(artifact);
    expect(fake.last("values").args[0]).toMatchObject({ id: "artifact-1" });
    await repo.insert({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      actionId: "action-2",
      artifactType: "technical_ticket",
      generationMode: "structured_llm",
      outputLocale: "zh-CN",
      latestGenerationRunId: "run-2",
      createdBy: "user-1",
    });
    expect(fake.last("values").args[0]).not.toHaveProperty("id");

    fake.enqueue([artifact], [], [artifact], [], [artifact], []);
    await expect(repo.findById(scope, "artifact-1")).resolves.toBe(artifact);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(
      repo.findByIdForUpdate(scope, "artifact-1"),
    ).resolves.toBe(artifact);
    expect(fake.last("for").args).toEqual(["update"]);
    await expect(
      repo.findByIdForUpdate(scope, "missing"),
    ).resolves.toBeNull();
    await expect(
      repo.findLiveByActionType(scope, "action-1", "content_brief"),
    ).resolves.toBe(artifact);
    await expect(
      repo.findLiveByActionType(scope, "action-2", "content_brief"),
    ).resolves.toBeNull();

    await repo.startRegeneration("artifact-1", "run-3", {
      generationMode: "structured_llm",
      outputLocale: "zh-CN",
    });
    expect(fake.last("set").args[0]).toMatchObject({
      status: "generating",
      generation_mode: "structured_llm",
      output_locale: "zh-CN",
    });
    await repo.startRegeneration("artifact-1", "run-4");
    expect(fake.last("set").args[0]).not.toHaveProperty("generation_mode");

    fake.enqueue([{ id: "artifact-1" }], []);
    await expect(
      repo.startRegenerationIfLive(scope, "artifact-1", "run-5", {
        generationMode: "template",
        outputLocale: "en",
      }),
    ).resolves.toBe(true);
    await expect(
      repo.startRegenerationIfLive(scope, "artifact-1", "run-5", {
        generationMode: "template",
        outputLocale: "en",
      }),
    ).resolves.toBe(false);
    const regenerateGuard = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(regenerateGuard.sql).toContain(
      '"app"."execution_artifacts"."status" <> \'archived\'',
    );

    await repo.setGenerated("artifact-1", {
      status: "draft",
      currentRevision: 3,
      validationState: "valid",
      contentHash: "hash-3",
    });
    expect(fake.last("set").args[0]).toMatchObject({
      current_revision: 3,
      content_hash: "hash-3",
    });
    fake.enqueue([{ id: "artifact-1" }], []);
    await expect(
      repo.setGeneratedIfRevision(scope, "artifact-1", {
        status: "draft",
        currentRevision: 4,
        expectedRevision: 3,
        expectedStatus: "ready",
        validationState: "valid",
        contentHash: "hash-4",
      }),
    ).resolves.toBe(true);
    await expect(
      repo.setGeneratedIfRevision(scope, "artifact-1", {
        status: "draft",
        currentRevision: 4,
        expectedRevision: 3,
        expectedStatus: "ready",
        validationState: "valid",
        contentHash: "hash-4",
      }),
    ).resolves.toBe(false);
    const manualRevisionCas = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(manualRevisionCas.sql).toContain(
      '"app"."execution_artifacts"."status" =',
    );
    expect(manualRevisionCas.params).toEqual(expect.arrayContaining(["ready"]));
    fake.enqueue([{ id: "artifact-1" }], []);
    await expect(
      repo.setGeneratedForGenerationRun(scope, "artifact-1", "run-4", {
        status: "draft",
        currentRevision: 4,
        expectedRevision: 3,
        validationState: "valid",
        contentHash: "hash-4",
      }),
    ).resolves.toBe(true);
    await expect(
      repo.setGeneratedForGenerationRun(scope, "artifact-1", "stale-run", {
        status: "draft",
        currentRevision: 4,
        expectedRevision: 3,
        validationState: "valid",
        contentHash: "hash-4",
      }),
    ).resolves.toBe(false);

    await repo.setStatus(scope, "artifact-1", "ready");
    fake.enqueue([{ id: "artifact-1" }], []);
    await expect(
      repo.setStatusIfRevision(scope, "artifact-1", "ready", 4, "draft"),
    ).resolves.toBe(true);
    await expect(
      repo.setStatusIfRevision(scope, "artifact-1", "ready", 3, "draft"),
    ).resolves.toBe(false);
    const statusCas = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(statusCas.sql).toContain(
      '"app"."execution_artifacts"."status" =',
    );
    expect(statusCas.params).toEqual(expect.arrayContaining(["draft"]));
    await repo.setFailed("artifact-1");
    expect(fake.last("set").args[0]).toMatchObject({ status: "failed" });
    fake.enqueue([{ id: "artifact-1" }], []);
    await expect(
      repo.setFailedForGenerationRun(scope, "artifact-1", "run-4", 4),
    ).resolves.toBe(true);
    await expect(
      repo.setFailedForGenerationRun(scope, "artifact-1", "stale-run", 3),
    ).resolves.toBe(false);

    const revision = { id: "revision-1", revision: 4 };
    fake.enqueue([revision]);
    await expect(
      repo.insertRevision({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        artifactId: "artifact-1",
        revision: 4,
        outputLocale: "zh-CN",
        contentFormat: "markdown",
        contentText: "# Brief",
        contentJson: null,
        contentHash: "hash-4",
        generatedBy: "human",
        editorId: "user-1",
        analysisInvocationId: null,
        note: "Clarified audience",
        validationErrors: [],
      }),
    ).resolves.toBe(revision);
    expect(fake.last("values").args[0]).toMatchObject({
      artifact_id: "artifact-1",
      output_locale: "zh-CN",
      editor_id: "user-1",
    });
    fake.enqueue([revision], [], [revision]);
    await expect(
      repo.findRevision(scope, "artifact-1", 4),
    ).resolves.toBe(revision);
    await expect(
      repo.findRevision(scope, "artifact-1", 99),
    ).resolves.toBeNull();
    await expect(repo.listRevisions(scope, "artifact-1")).resolves.toEqual([
      revision,
    ]);

    const second = {
      id: "00000000-0000-4000-8000-000000000202",
      updated_at: "2026-07-17 12:00:00+08",
    };
    const third = {
      id: "00000000-0000-4000-8000-000000000203",
      updated_at: "2026-07-16 12:00:00+08",
    };
    fake.enqueue([artifact, second, third]);
    const page = await repo.listByProject(scope, { limit: 2, cursor: null });
    expect(page.rows).toEqual([artifact, second]);
    expect(page.nextCursor).toEqual(expect.any(String));
    fake.enqueue([second], []);
    await expect(
      repo.listByProject(scope, { limit: 2, cursor: page.nextCursor }),
    ).resolves.toEqual({ rows: [second], nextCursor: null });
    const artifactCursorQuery = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(artifactCursorQuery.params).toEqual(
      expect.arrayContaining([second.updated_at, second.id]),
    );
    await expect(
      repo.listByProject(scope, { limit: 2, cursor: "invalid" }),
    ).resolves.toEqual({ rows: [], nextCursor: null });

    fake.enqueue([]);
    await repo.listByProject(scope, {
      limit: 2,
      cursor: null,
      artifactType: "technical_ticket",
      status: "ready",
    });
    const artifactFilterQuery = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(artifactFilterQuery.sql).toContain(
      '"app"."execution_artifacts"."artifact_type" =',
    );
    expect(artifactFilterQuery.sql).toContain(
      '"app"."execution_artifacts"."status" =',
    );
    expect(artifactFilterQuery.params).toEqual(
      expect.arrayContaining(["technical_ticket", "ready"]),
    );
  });

  it("keyset-pages artifact revisions in descending revision order", async () => {
    const fake = fakeExecutor();
    const repo = new ExecutionArtifactsRepository(fake.executor);
    const revision3 = { artifact_id: "artifact-1", revision: 3 };
    const revision2 = { artifact_id: "artifact-1", revision: 2 };
    const revision1 = { artifact_id: "artifact-1", revision: 1 };

    fake.enqueue([revision3, revision2, revision1]);
    await expect(
      repo.listRevisionsPage(scope, "artifact-1", {
        limit: 2,
        cursor: null,
      }),
    ).resolves.toEqual({
      rows: [revision3, revision2],
      nextCursor: 2,
    });
    expect(fake.last("limit").args).toEqual([3]);

    fake.enqueue([revision1]);
    await expect(
      repo.listRevisionsPage(scope, "artifact-1", {
        limit: 2,
        cursor: 2,
      }),
    ).resolves.toEqual({ rows: [revision1], nextCursor: null });
    const cursorQuery = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(cursorQuery.sql).toContain(
      '"app"."artifact_revisions"."revision" <',
    );
    expect(cursorQuery.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "artifact-1",
        2,
      ]),
    );

    await expect(
      repo.listRevisionsPage(scope, "artifact-1", {
        limit: 0,
        cursor: null,
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      repo.listRevisionsPage(scope, "artifact-1", {
        limit: 2,
        cursor: 0,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("preserves human review state while findings regress and resolve", async () => {
    const fake = fakeExecutor();
    const repo = new FindingsRepository(fake.executor);
    const finding = {
      id: "finding-1",
      updated_at: "2026-07-18 12:00:00+08",
    };
    fake.enqueue([finding], []);
    await expect(repo.findByKey(scope, "key-1")).resolves.toBe(finding);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();

    fake.enqueue([finding]);
    await expect(
      repo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        findingKey: "key-1",
        ruleId: "technical.http_status",
        ruleVersion: 2,
        ruleFamily: "technical",
        intent: "fix",
        domain: "technical",
        titleKey: "finding.httpStatus",
        titleArgs: { status: 500 },
        summary: "A page failed",
        summaryLocale: "en",
        subjectRefs: ["/pricing"],
        severity: "high",
        confidence: "high",
        reviewState: "unreviewed",
        runId: "run-1",
        seenAt: "2026-07-18T00:00:00.000Z",
      }),
    ).resolves.toBe(finding);
    await repo.touchSeen("finding-1", {
      severity: "critical",
      confidence: "high",
      titleArgs: { status: 503 },
      summary: "The page regressed",
      summaryLocale: "en",
      subjectRefs: ["/pricing"],
      runId: "run-2",
      seenAt: "2026-07-19T00:00:00.000Z",
      regressed: true,
    });
    expect(fake.last("set").args[0]).toMatchObject({
      active: true,
      regressed: true,
      resolved_at: null,
    });

    const callsBefore = fake.calls.length;
    await expect(
      repo.resolveByKeysExcept(scope, [], [], "2026-07-20T00:00:00.000Z"),
    ).resolves.toEqual([]);
    expect(fake.calls).toHaveLength(callsBefore);
    fake.enqueue([{ id: "finding-1" }], [{ id: "finding-2" }]);
    await expect(
      repo.resolveByKeysExcept(
        scope,
        ["technical.http_status"],
        ["keep-key"],
        "2026-07-20T00:00:00.000Z",
      ),
    ).resolves.toEqual(["finding-1"]);
    await expect(
      repo.resolveByKeysExcept(
        scope,
        ["technical.http_status"],
        [],
        "2026-07-20T00:00:00.000Z",
      ),
    ).resolves.toEqual(["finding-2"]);

    fake.enqueue([{ id: "finding-1" }], []);
    await expect(
      repo.updateReview(scope, "finding-1", {
        reviewState: "confirmed",
        reviewRevision: 2,
        reason: "verified",
        note: null,
        expectedRevision: 1,
      }),
    ).resolves.toBe(true);
    await expect(
      repo.updateReview(scope, "finding-1", {
        reviewState: "dismissed",
        reviewRevision: 2,
        reason: "not_reproducible",
        note: "Concurrent edit",
        expectedRevision: 1,
      }),
    ).resolves.toBe(false);

    const second = {
      id: "00000000-0000-4000-8000-000000000302",
      updated_at: "2026-07-17 12:00:00+08",
    };
    const third = {
      id: "00000000-0000-4000-8000-000000000303",
      updated_at: "2026-07-16 12:00:00+08",
    };
    fake.enqueue([finding, second, third]);
    const page = await repo.list(scope, {
      limit: 2,
      cursor: null,
      activeOnly: true,
    });
    expect(page.rows).toEqual([finding, second]);
    expect(page.nextCursor).toEqual(expect.any(String));
    fake.enqueue([second], []);
    await expect(
      repo.list(scope, {
        limit: 2,
        cursor: page.nextCursor,
        activeOnly: false,
      }),
    ).resolves.toEqual({ rows: [second], nextCursor: null });
    const findingCursorQuery = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(findingCursorQuery.params).toEqual(
      expect.arrayContaining([second.updated_at, second.id]),
    );
    await expect(
      repo.list(scope, {
        limit: 2,
        cursor: "invalid",
        activeOnly: false,
      }),
    ).resolves.toEqual({ rows: [], nextCursor: null });

    fake.enqueue([]);
    await repo.list(scope, {
      limit: 2,
      cursor: null,
      activeOnly: false,
      domain: "geo_ai",
      reviewState: "confirmed",
    });
    const filterQuery = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(filterQuery.sql).toContain('"app"."findings"."domain" =');
    expect(filterQuery.sql).toContain('"app"."findings"."review_state" =');
    expect(filterQuery.params).toEqual(
      expect.arrayContaining(["geo_ai", "confirmed"]),
    );
  });
});

describe("project and source repositories", () => {
  it("round-trips project cursors and rebuilds the lifecycle projection", async () => {
    const fake = fakeExecutor();
    const repo = new ProjectsRepository(fake.executor);
    const project = {
      id: "project-1",
      stage: "planning" as const,
      updated_at: "2026-07-18T12:00:00.000Z",
    };
    const cursor = encodeProjectCursor(project);
    expect(decodeProjectCursor(cursor)).toEqual({
      updatedAt: project.updated_at,
      id: project.id,
    });
    expect(decodeProjectCursor("invalid")).toBeNull();

    fake.enqueue([project], [project], []);
    await expect(
      repo.insert({
        workspaceId: scope.workspaceId,
        clientName: "Acme",
        projectName: "Growth",
        defaultDeliveryLocale: "en",
        createdBy: "user-1",
      }),
    ).resolves.toBe(project);
    await expect(repo.findById(scope, "project-1")).resolves.toBe(project);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();

    const second = {
      id: "project-2",
      updated_at: "2026-07-17T12:00:00.000Z",
    };
    const third = {
      id: "project-3",
      updated_at: "2026-07-16T12:00:00.000Z",
    };
    fake.enqueue([project, second, third]);
    const page = await repo.listByWorkspace(scope, {
      limit: 2,
      cursor: null,
      archived: false,
    });
    expect(page.rows).toEqual([project, second]);
    expect(page.nextCursor).toEqual(expect.any(String));
    fake.enqueue([second], []);
    await expect(
      repo.listByWorkspace(scope, {
        limit: 2,
        cursor: page.nextCursor,
        archived: true,
      }),
    ).resolves.toEqual({ rows: [second], nextCursor: null });
    await expect(
      repo.listByWorkspace(scope, {
        limit: 2,
        cursor: "invalid",
        archived: false,
      }),
    ).resolves.toEqual({ rows: [], nextCursor: null });

    await repo.setCurrentIcpProfile(scope, "project-1", "icp-2");
    await repo.setDeliveryLocale(scope, "project-1", "zh-CN");
    fake.enqueue([{ id: "project-1" }], []);
    await expect(
      repo.setStage(scope, "project-1", "diagnosing"),
    ).resolves.toBe(true);
    await expect(
      repo.setStage(scope, "missing", "diagnosing"),
    ).resolves.toBe(false);
    const stageGuard = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(stageGuard.sql).toContain(
      '"app"."client_projects"."archived_at" is null',
    );
    fake.enqueue([{ id: "project-1" }], []);
    await expect(
      repo.setReadyToDiagnoseIfEligible(scope, "project-1"),
    ).resolves.toBe(true);
    await expect(
      repo.setReadyToDiagnoseIfEligible(scope, "project-2"),
    ).resolves.toBe(false);
    const readyGuard = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(readyGuard.sql).toContain(
      '"app"."client_projects"."archived_at" is null',
    );

    fake.enqueue([], [project]);
    await expect(
      repo.rebuildStageFromHistory(scope, "project-1"),
    ).resolves.toBe("planning");
    expect(fake.last("execute").args).toHaveLength(1);
    const rebuildGuard = new PgDialect().sqlToQuery(
      fake.last("execute").args[0] as never,
    );
    expect(rebuildGuard.sql).toContain(
      '"app"."client_projects"."archived_at" is null',
    );
    fake.enqueue([], []);
    await expect(
      repo.rebuildStageFromHistory(scope, "missing"),
    ).resolves.toBeNull();
  });

  it("deduplicates immutable ICP versions and batches workspace reads", async () => {
    const fake = fakeExecutor();
    const repo = new IcpProfilesRepository(fake.executor);
    const icp = { id: "icp-1", version: 3 };
    fake.enqueue([icp], [], [icp], []);
    await expect(repo.findById(scope, "icp-1")).resolves.toBe(icp);
    await expect(repo.findByContentHash(scope, "missing")).resolves.toBeNull();
    await expect(repo.mapByIds(scope, [])).resolves.toEqual(new Map());
    await expect(repo.mapByIds(scope, ["icp-1"])).resolves.toEqual(
      new Map([["icp-1", icp]]),
    );
    await expect(repo.maxVersion(scope)).resolves.toBe(0);
    fake.enqueue([{ version: 3 }], [icp]);
    await expect(repo.maxVersion(scope)).resolves.toBe(3);
    await expect(
      repo.insertVersion({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        version: 3,
        status: "complete",
        profile: { segments: ["enterprise"] },
        contentHash: "hash",
        createdBy: "user-1",
      }),
    ).resolves.toBe(icp);
  });

  it("keeps OAuth intents encrypted and single-use", async () => {
    const fake = fakeExecutor();
    const repo = new OAuthIntentsRepository(fake.executor);
    const intent = { id: "intent-1", status: "initiated" };
    fake.enqueue([intent], [intent], [], [intent]);
    await expect(
      repo.insert({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        initiatedBy: "user-1",
        provider: "gsc",
        stateHash: Buffer.from("state"),
        pkceVerifierCipher: Buffer.from("cipher"),
        redirectPath: "/sources",
        expiresAt: "2026-07-18T12:10:00.000Z",
      }),
    ).resolves.toBe(intent);
    expect(fake.last("values").args[0]).not.toHaveProperty("state");
    await expect(repo.findById(scope, "intent-1")).resolves.toBe(intent);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(
      repo.findLiveByStateHash("workspace-1", "gsc", Buffer.from("state")),
    ).resolves.toBe(intent);
    await repo.setPropertiesReady("intent-1", {
      tokenCipher: Buffer.from("token-cipher"),
      candidateProperties: [{ id: "property-1" }],
    });
    await repo.consume("intent-1");
    await repo.fail("intent-2", "STATE_EXPIRED");
    expect(fake.last("set").args[0]).toMatchObject({
      status: "failed",
      failure_code: "STATE_EXPIRED",
    });
  });

  it("manages project sites without N+1 reads", async () => {
    const fake = fakeExecutor();
    const repo = new SitesRepository(fake.executor);
    const site = { id: "site-1", project_id: "project-1" };
    fake.enqueue([site]);
    await expect(
      repo.insertPrimary({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        origin: "https://example.com",
        host: "example.com",
        marketCodes: ["US"],
        languageCodes: ["en"],
      }),
    ).resolves.toBe(site);
    await expect(repo.mapPrimariesByProjects(scope, [])).resolves.toEqual(
      new Map(),
    );
    fake.enqueue([site], [site], []);
    await expect(
      repo.mapPrimariesByProjects(scope, ["project-1"]),
    ).resolves.toEqual(new Map([["project-1", site]]));
    await expect(repo.findPrimary(scope)).resolves.toBe(site);
    await repo.updatePrimaryProjections(scope, {
      marketCodes: ["GB"],
      languageCodes: ["en-GB"],
    });
    expect(fake.last("set").args[0]).toEqual({
      market_codes: ["GB"],
      language_codes: ["en-GB"],
    });
  });

  it("maps connected sources and lifecycle updates", async () => {
    const fake = fakeExecutor();
    const repo = new SourceConnectionsRepository(fake.executor);
    const source = { id: "source-1", provider: "crawl" };
    fake.enqueue([source], [source], [{ id: "source-2" }]);
    await expect(
      repo.insertDefaultCrawl({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        createdBy: "user-1",
      }),
    ).resolves.toBe(source);
    await expect(
      repo.insertConnection({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        siteId: "site-1",
        provider: "gsc",
        connectionType: "oauth",
        state: "connected",
        externalRef: "property-1",
        scopes: ["webmasters.readonly"],
        config: { propertyType: "domain" },
        limitation: "Search Console only",
        connectedAt: true,
        createdBy: "user-1",
      }),
    ).resolves.toBe(source);
    expect(fake.last("values").args[0]).toMatchObject({
      external_ref: "property-1",
      scopes: ["webmasters.readonly"],
    });
    await repo.insertConnection({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      siteId: "site-1",
      provider: "csv",
      connectionType: "upload",
      state: "connected",
      limitation: "Manual upload",
      createdBy: "user-1",
    });
    expect(fake.last("values").args[0]).toMatchObject({ external_ref: null });
    expect(fake.last("values").args[0]).not.toHaveProperty("connected_at");

    fake.enqueue(
      [source],
      [],
      [source],
      [],
      [source],
      [],
      [source],
      [source],
      [source],
      [],
      [source],
    );
    await expect(repo.findById(scope, "source-1")).resolves.toBe(source);
    await expect(repo.findById(scope, "missing")).resolves.toBeNull();
    await expect(repo.findConnectedById(scope, "source-1")).resolves.toBe(source);
    await expect(repo.findConnectedById(scope, "missing")).resolves.toBeNull();
    await expect(
      repo.findActiveByIdForUpdate(scope, "source-1"),
    ).resolves.toBe(source);
    expect(fake.last("for").args).toEqual(["update"]);
    await expect(
      repo.findActiveByIdForUpdate(scope, "missing"),
    ).resolves.toBeNull();
    await expect(
      repo.findConnectedByIdForUpdate(scope, "source-1"),
    ).resolves.toBe(source);
    expect(fake.last("for").args).toEqual(["update"]);
    await expect(
      repo.findConnectedByProvider(scope, "crawl"),
    ).resolves.toBe(source);
    await expect(
      repo.findConnectedByProviderForUpdate(scope, "crawl"),
    ).resolves.toBe(source);
    expect(fake.last("for").args).toEqual(["update"]);
    await expect(
      repo.findConnectedByProvider(scope, "ga4"),
    ).resolves.toBeNull();
    await expect(repo.listByProject(scope)).resolves.toEqual([source]);
    await repo.updateState(scope, "source-1", "syncing");
    const updateStateGuard = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(updateStateGuard.sql).toContain(
      'from "app"."client_projects"',
    );
    expect(updateStateGuard.sql).toContain(
      '"app"."client_projects"."archived_at" is null',
    );
    await repo.setLastSnapshot("source-1", "snapshot-1", "available");
    const snapshotGuard = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(snapshotGuard.sql).toContain('from "app"."client_projects"');
    expect(snapshotGuard.sql).toContain(
      '"app"."client_projects"."archived_at" is null',
    );
    await repo.disconnect(scope, "source-1");
    expect(fake.last("set").args[0]).toMatchObject({ state: "disconnected" });

    fake.enqueue([{ id: "source-1" }], []);
    await expect(
      repo.recoverSyncingAfterCollectionFailure(scope, "source-1", "crawl"),
    ).resolves.toBe(true);
    await expect(
      repo.recoverSyncingAfterCollectionFailure(scope, "source-1", "crawl"),
    ).resolves.toBe(false);
    const recoverySet = fake.last("set").args[0] as Record<string, unknown>;
    expect(recoverySet).toMatchObject({
      limitation:
        "Source synchronization did not complete; no new snapshot was saved.",
    });
    const recoveryGuard = new PgDialect().sqlToQuery(
      fake.last("where").args[0] as never,
    );
    expect(recoveryGuard.sql).toContain(
      '"app"."source_connections"."state" =',
    );
    expect(recoveryGuard.sql).toContain(
      '"app"."source_connections"."disconnected_at" is null',
    );
    expect(recoveryGuard.sql).toContain('from "app"."client_projects"');
    expect(recoveryGuard.sql).toContain(
      '"app"."client_projects"."archived_at" is null',
    );
    expect(recoveryGuard.params).toEqual(
      expect.arrayContaining([
        scope.workspaceId,
        scope.projectId,
        "source-1",
        "syncing",
        "crawl",
      ]),
    );
  });

  it("locks and rotates encrypted source credentials", async () => {
    const fake = fakeExecutor();
    const repo = new SourceCredentialsRepository(fake.executor);
    const credential = { id: "credential-1" };
    fake.enqueue([], [credential]);
    await expect(
      repo.replace({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        sourceConnectionId: "source-1",
        encryptedPayload: Buffer.from("cipher"),
        keyVersion: "key-v2",
        cipherVersion: 2,
        expiresAt: "2026-07-18T13:00:00.000Z",
      }),
    ).resolves.toBe(credential);
    expect(fake.last("values").args[0]).toMatchObject({ cipher_version: 2 });
    fake.enqueue([], [credential]);
    await repo.replace({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      sourceConnectionId: "source-2",
      encryptedPayload: Buffer.from("cipher"),
      keyVersion: "key-v1",
      expiresAt: null,
    });
    expect(fake.last("values").args[0]).not.toHaveProperty("cipher_version");

    fake.enqueue([credential], [], [credential], []);
    await expect(
      repo.findByConnection(scope, "source-1"),
    ).resolves.toBe(credential);
    await expect(
      repo.findByConnection(scope, "missing"),
    ).resolves.toBeNull();
    await expect(
      repo.findByConnectionForUpdate(scope, "source-1"),
    ).resolves.toBe(credential);
    expect(fake.last("for").args).toEqual(["update"]);
    await expect(
      repo.findByConnectionForUpdate(scope, "missing"),
    ).resolves.toBeNull();

    fake.enqueue([credential], []);
    await expect(
      repo.updateAfterRefresh({
        scope,
        credentialId: "credential-1",
        sourceConnectionId: "source-1",
        encryptedPayload: Buffer.from("new-cipher"),
        keyVersion: "key-v3",
        cipherVersion: 3,
        expiresAt: "2026-07-18T14:00:00.000Z",
      }),
    ).resolves.toBe(credential);
    await expect(
      repo.updateAfterRefresh({
        scope,
        credentialId: "credential-1",
        sourceConnectionId: "source-2",
        encryptedPayload: Buffer.from("new-cipher"),
        keyVersion: "key-v3",
        cipherVersion: 3,
        expiresAt: "2026-07-18T14:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await repo.deleteByConnection("source-1");
    expect(fake.last("delete").method).toBe("delete");
  });
});
