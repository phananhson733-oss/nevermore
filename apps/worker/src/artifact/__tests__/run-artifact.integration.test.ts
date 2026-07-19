import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["OPENAI_API_KEY"] ??= "sk-test";
process.env["OPENAI_MODEL"] ??= "gpt-4o-mini";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  ActionsRepository,
  AsyncRunsRepository,
  DiagnosticRunsRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
  ProjectsRepository,
  SitesRepository,
  contentHash,
  type PgBoss,
  type JobWithMetadata,
  type ProjectScope,
} from "@sf/db";
import { FINDING_REGISTRY } from "@sf/engine";
import { LocalFsBlobStore } from "@sf/sources";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { runArtifact } from "../run-artifact.ts";
import { prepareRunDelivery } from "../../handlers/recovery.ts";

/**
 * AC-031 / AC-034 — the artifact runner (spec §10.1, §10.3), driven end-to-end
 * against a real local Postgres in TEMPLATE mode (no network):
 *  - a fresh artifact create produces revision 1 in `draft`, never `ready`;
 *  - a regenerate APPENDS an immutable revision 2 and returns to `draft`, never
 *    overwriting revision 1 (the append-only revision ledger).
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface ArtifactFixture {
  readonly scope: ProjectScope;
  readonly actor: string;
  readonly artifactId: string;
  readonly actionId: string;
}

describeDb("artifact runner (spec §10)", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
    ctx = {
      db: handle.db,
      boss: {} as unknown as PgBoss, // the artifact runner never enqueues
      blobStore: new LocalFsBlobStore(
        mkdtempSync(path.join(os.tmpdir(), "sf-artifact-test-")),
      ),
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test-client", clientSecret: "test-secret" },
      openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
      logger: testLogger,
    };
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("AC-031: a template artifact create produces revision 1 in draft (never ready)", async () => {
    const fx = await seedArtifact(handle);
    const runId = await queueArtifactRun(handle, fx);
    const repo = new ExecutionArtifactsRepository(handle.db);
    await repo.startRegeneration(fx.artifactId, runId, {
      generationMode: "template",
      outputLocale: "en",
    });

    await runArtifact(ctx, {
      runId,
      workspaceId: fx.scope.workspaceId,
      projectId: fx.scope.projectId,
    });

    const artifact = await repo.findById(fx.scope, fx.artifactId);
    expect(artifact?.current_revision).toBe(1);
    expect(artifact?.status).toBe("draft");
    expect(artifact?.validation_state).toBe("valid");

    const rev1 = await repo.findRevision(fx.scope, fx.artifactId, 1);
    expect(rev1).not.toBeNull();
    expect(rev1?.content_format).toBe("markdown");
    expect(rev1?.generated_by).toBe("template");

    const run = await new AsyncRunsRepository(handle.db).findById(
      fx.scope,
      runId,
    );
    expect(run?.status).toBe("completed");
    expect(run?.result_type).toBe("artifact");
    expect(run?.result_id).toBe(fx.artifactId);
  });

  it("AC-034: a regenerate appends an immutable revision 2 and returns to draft", async () => {
    const fx = await seedArtifact(handle);
    const repo = new ExecutionArtifactsRepository(handle.db);

    // First generation → revision 1.
    const firstRunId = await queueArtifactRun(handle, fx);
    await repo.startRegeneration(fx.artifactId, firstRunId, {
      generationMode: "template",
      outputLocale: "en",
    });
    await runArtifact(ctx, {
      runId: firstRunId,
      workspaceId: fx.scope.workspaceId,
      projectId: fx.scope.projectId,
    });
    const rev1 = await repo.findRevision(fx.scope, fx.artifactId, 1);
    expect(rev1).not.toBeNull();
    const rev1Hash = rev1?.content_hash;

    // Regenerate: point the artifact at a fresh run (status → generating).
    const secondRunId = await queueArtifactRun(handle, fx);
    await repo.startRegeneration(fx.artifactId, secondRunId);
    await runArtifact(ctx, {
      runId: secondRunId,
      workspaceId: fx.scope.workspaceId,
      projectId: fx.scope.projectId,
    });

    const artifact = await repo.findById(fx.scope, fx.artifactId);
    expect(artifact?.current_revision).toBe(2);
    expect(artifact?.status).toBe("draft");

    const revisions = await repo.listRevisions(fx.scope, fx.artifactId);
    expect(revisions.map((r) => r.revision).sort()).toEqual([1, 2]);

    // Revision 1 is immutable — the regenerate must not overwrite it.
    const rev1After = await repo.findRevision(fx.scope, fx.artifactId, 1);
    expect(rev1After?.content_hash).toBe(rev1Hash);
    const rev2 = await repo.findRevision(fx.scope, fx.artifactId, 2);
    expect(rev2?.generated_by).toBe("template");
  });

  it("AC-032: persists a failed model invocation and does not create a fake fallback revision", async () => {
    const fx = await seedArtifact(handle, {
      generationMode: "structured_llm",
    });
    const runId = await queueArtifactRun(
      handle,
      fx,
      "structured_llm",
    );
    await new ExecutionArtifactsRepository(handle.db).startRegeneration(
      fx.artifactId,
      runId,
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    try {
      await runArtifact(ctx, {
        runId,
        workspaceId: fx.scope.workspaceId,
        projectId: fx.scope.projectId,
      });
    } finally {
      fetchSpy.mockRestore();
    }

    const artifact = await new ExecutionArtifactsRepository(handle.db).findById(
      fx.scope,
      fx.artifactId,
    );
    expect(artifact?.status).toBe("failed");
    expect(artifact?.current_revision).toBe(0);

    const invocations = await handle.pool.query<{
      status: string;
      error_code: string | null;
    }>(
      `SELECT status, error_code
         FROM app.analysis_invocations
        WHERE async_run_id = $1`,
      [runId],
    );
    expect(invocations.rows).toEqual([
      { status: "failed", error_code: "AUTH_FAILED" },
    ]);

    const run = await new AsyncRunsRepository(handle.db).findById(
      fx.scope,
      runId,
    );
    expect(run?.status).toBe("failed");
  });

  it("marks both canonical run and owned artifact failed when the final 429 retry exhausts", async () => {
    const fx = await seedArtifact(handle, {
      generationMode: "structured_llm",
    });
    const runId = await queueArtifactRun(handle, fx, "structured_llm");
    const artifacts = new ExecutionArtifactsRepository(handle.db);
    await artifacts.startRegeneration(fx.artifactId, runId);
    const runs = new AsyncRunsRepository(handle.db);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await runs.claim(runId)).not.toBeNull();
      await runs.resetToQueued(runId);
    }
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    try {
      await expect(
        prepareRunDelivery(ctx, finalMetadataJob(runId, fx.scope), (payload) =>
          runArtifact(ctx, payload),
        ),
      ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    } finally {
      fetchSpy.mockRestore();
    }

    expect(await runs.findById(fx.scope, runId)).toMatchObject({
      status: "failed",
      attempt_count: 3,
      last_error_code: "QUEUE_RETRY_EXHAUSTED",
    });
    expect(await artifacts.findById(fx.scope, fx.artifactId)).toMatchObject({
      status: "failed",
      latest_generation_run_id: runId,
    });
  });

  it("never fails an artifact in another project even when canonical payload is corrupt", async () => {
    const owner = await seedArtifact(handle);
    const foreign = await seedArtifact(handle);
    const runId = await queueArtifactRun(handle, owner);
    const artifacts = new ExecutionArtifactsRepository(handle.db);
    // Deliberately construct the strongest adversarial fixture: the foreign
    // artifact points at this run id, while the canonical request is corrupted
    // to name that artifact. The project predicate must still reject it.
    await artifacts.startRegeneration(foreign.artifactId, runId);
    await handle.pool.query(
      `UPDATE app.async_runs
          SET request_payload = jsonb_set(request_payload, '{artifactId}', to_jsonb($2::text))
        WHERE id = $1`,
      [runId, foreign.artifactId],
    );
    const failure = new Error("final transient fixture");

    await expect(
      prepareRunDelivery(ctx, finalMetadataJob(runId, owner.scope), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(
      await artifacts.findById(foreign.scope, foreign.artifactId),
    ).toMatchObject({
      status: "generating",
      latest_generation_run_id: runId,
    });
  });

  it("does not overwrite a manual revision committed while an older generation is in flight", async () => {
    const fx = await seedArtifact(handle, {
      generationMode: "structured_llm",
    });
    const runId = await queueArtifactRun(handle, fx, "structured_llm");
    const artifacts = new ExecutionArtifactsRepository(handle.db);
    await artifacts.startRegeneration(fx.artifactId, runId, {
      generationMode: "structured_llm",
      outputLocale: "en",
    });

    const response = deferred<Response>();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => response.promise);
    const oldGeneration = runArtifact(ctx, {
      runId,
      workspaceId: fx.scope.workspaceId,
      projectId: fx.scope.projectId,
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const manualText = "# Manual revision\n\nOperator-owned customer content.";
    const manualHash = contentHash({ text: manualText });
    await handle.db.transaction(async (tx) => {
      const repo = new ExecutionArtifactsRepository(tx);
      const locked = await repo.findByIdForUpdate(fx.scope, fx.artifactId);
      expect(locked?.current_revision).toBe(0);
      expect(
        await repo.setGeneratedIfRevision(fx.scope, fx.artifactId, {
          status: "draft",
          currentRevision: 1,
          expectedRevision: 0,
          validationState: "valid",
          contentHash: manualHash,
        }),
      ).toBe(true);
      await repo.insertRevision({
        workspaceId: fx.scope.workspaceId,
        projectId: fx.scope.projectId,
        artifactId: fx.artifactId,
        revision: 1,
        contentFormat: "markdown",
        contentText: manualText,
        contentJson: null,
        contentHash: manualHash,
        generatedBy: "operator",
        editorId: fx.actor,
        analysisInvocationId: null,
        note: "manual edit won",
        validationErrors: [],
      });
    });

    response.resolve(validChatResponse("# Stale generated revision"));
    try {
      await oldGeneration;
    } finally {
      fetchSpy.mockRestore();
    }

    expect(await artifacts.findById(fx.scope, fx.artifactId)).toMatchObject({
      status: "draft",
      current_revision: 1,
      content_hash: manualHash,
    });
    const revisions = await artifacts.listRevisions(fx.scope, fx.artifactId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revision: 1,
      generated_by: "operator",
      content_text: manualText,
    });
    expect(
      await new AsyncRunsRepository(handle.db).findById(fx.scope, runId),
    ).toMatchObject({
      status: "cancelled",
      last_error_code: "ARTIFACT_GENERATION_SUPERSEDED",
    });
  });

  it("does not let an older permanent failure mark a newer generation failed", async () => {
    const fx = await seedArtifact(handle, {
      generationMode: "structured_llm",
    });
    const oldRunId = await queueArtifactRun(handle, fx, "structured_llm");
    const artifacts = new ExecutionArtifactsRepository(handle.db);
    await artifacts.startRegeneration(fx.artifactId, oldRunId, {
      generationMode: "structured_llm",
      outputLocale: "en",
    });

    const response = deferred<Response>();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => response.promise);
    const oldGeneration = runArtifact(ctx, {
      runId: oldRunId,
      workspaceId: fx.scope.workspaceId,
      projectId: fx.scope.projectId,
    });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const newRunId = await queueArtifactRun(handle, fx, "template");
    await artifacts.startRegeneration(fx.artifactId, newRunId, {
      generationMode: "template",
      outputLocale: "en",
    });
    response.resolve(new Response("customer/model secret", { status: 401 }));
    try {
      await oldGeneration;
    } finally {
      fetchSpy.mockRestore();
    }

    expect(await artifacts.findById(fx.scope, fx.artifactId)).toMatchObject({
      status: "generating",
      current_revision: 0,
      latest_generation_run_id: newRunId,
    });
    expect(
      await new AsyncRunsRepository(handle.db).findById(fx.scope, oldRunId),
    ).toMatchObject({
      status: "cancelled",
      last_error_code: "ARTIFACT_GENERATION_SUPERSEDED",
    });

    await runArtifact(ctx, {
      runId: newRunId,
      workspaceId: fx.scope.workspaceId,
      projectId: fx.scope.projectId,
    });
    expect(await artifacts.findById(fx.scope, fx.artifactId)).toMatchObject({
      status: "draft",
      current_revision: 1,
      latest_generation_run_id: newRunId,
    });
  });
});

// --- seeding ----------------------------------------------------------------

async function seedArtifact(
  handle: DbHandle,
  options?: {
    readonly generationMode?: "template" | "structured_llm";
  },
): Promise<ArtifactFixture> {
  const actor = randomUUID();
  const [ws] = await handle.db
    .insert(workspaces)
    .values({ name: `WS-${randomUUID()}` })
    .returning();
  const workspaceId = ws!.id;
  const project = await new ProjectsRepository(handle.db).insert({
    workspaceId,
    clientName: "Art",
    projectName: "Art",
    defaultDeliveryLocale: "en",
    createdBy: actor,
  });
  const scope: ProjectScope = { workspaceId, projectId: project.id };
  const host = `art-${randomUUID().slice(0, 8)}.example`;
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId,
    projectId: project.id,
    origin: `https://${host}`,
    host,
    marketCodes: ["US"],
    languageCodes: ["en"],
  });

  // A finding + action are the artifact's allowlisted prompt source (spec §10.2).
  const icpId = await seedIcp(handle, scope, actor);
  const diagRunId = await seedDiagnosticRun(
    handle,
    scope,
    site.id,
    actor,
    icpId,
  );
  const finding = await seedFinding(handle, scope, diagRunId);
  const action = await new ActionsRepository(handle.db).insert({
    workspaceId,
    projectId: project.id,
    sourceFindingId: finding.id,
    actionKey: contentHash({ action: finding.id }),
    templateId: "tech-http-fix",
    templateVersion: 1,
    title: "Fix broken pages",
    description: "Repair the 404 responses on the affected URLs.",
    contentLocale: "en",
    priorityBand: "high",
    roadmapLane: "now",
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: "The affected pages return HTTP 200.",
    evidenceRefs: [],
    createdBy: actor,
  });

  const artifactId = randomUUID();
  const seedRunId = await queueArtifactRun(handle, {
    scope,
    actor,
    artifactId,
    actionId: action.id,
  });
  await new ExecutionArtifactsRepository(handle.db).insert({
    id: artifactId,
    workspaceId,
    projectId: project.id,
    actionId: action.id,
    artifactType: "content_brief",
    generationMode: options?.generationMode ?? "template",
    outputLocale: "en",
    latestGenerationRunId: seedRunId,
    createdBy: actor,
  });

  return { scope, actor, artifactId, actionId: action.id };
}

async function queueArtifactRun(
  handle: DbHandle,
  fx: Pick<ArtifactFixture, "scope" | "actor" | "artifactId" | "actionId">,
  generationMode: "template" | "structured_llm" = "template",
): Promise<string> {
  const runId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: fx.scope.workspaceId,
    project_id: fx.scope.projectId,
    kind: "artifact_generation",
    status: "queued",
    initiated_by: fx.actor,
    request_payload: {
      artifactId: fx.artifactId,
      actionId: fx.actionId,
      artifactType: "content_brief",
      generationMode,
      outputLocale: "en",
      operatorInstructions: null,
    },
  });
  return runId;
}

async function seedIcp(
  handle: DbHandle,
  scope: ProjectScope,
  actor: string,
): Promise<string> {
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "Acme", siteLanguageCodes: ["en"] },
      content_hash: contentHash({ icp: randomUUID() }),
      created_by: actor,
    })
    .returning();
  return icp!.id;
}

async function seedDiagnosticRun(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  actor: string,
  icpProfileId: string,
): Promise<string> {
  const runId = randomUUID();
  const at = new Date().toISOString();
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    kind: "diagnostic",
    status: "completed",
    initiated_by: actor,
    started_at: at,
    completed_at: at,
  });
  await new DiagnosticRunsRepository(handle.db).insert({
    runId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    icpProfileId,
    icpProfileVersion: 1,
    ruleSetVersion: "mvp.rules.0.2.0",
    promptSetVersion: "mvp.prompts.0.2.0",
    outputLocale: "en",
    inputManifest: { snapshots: [] },
    inputHash: contentHash({ r: runId }),
  });
  return runId;
}

async function seedFinding(
  handle: DbHandle,
  scope: ProjectScope,
  runId: string,
): Promise<{ id: string }> {
  const meta = FINDING_REGISTRY["TECH-HTTP-001"];
  const row = await new FindingsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    findingKey: contentHash({ finding: randomUUID() }),
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
    ruleFamily: meta.ruleFamily,
    intent: meta.intent,
    domain: meta.domain,
    titleKey: meta.titleKey,
    titleArgs: {},
    summary: "Broken pages returned 404.",
    summaryLocale: "en",
    subjectRefs: ["http_status:404"],
    severity: "high",
    confidence: "high",
    reviewState: "confirmed",
    runId,
    seenAt: new Date().toISOString(),
  });
  return { id: row.id };
}

function finalMetadataJob(
  runId: string,
  scope: ProjectScope,
): JobWithMetadata<{
  runId: string;
  workspaceId: string;
  projectId: string;
}> {
  return {
    id: runId,
    name: "artifact.generate",
    data: { runId, ...scope },
    expireInSeconds: 300,
    heartbeatSeconds: 60,
    signal: new AbortController().signal,
    priority: 0,
    state: "active",
    retryLimit: 2,
    retryCount: 2,
    retryDelay: 0,
    retryBackoff: true,
    startAfter: new Date(),
    startedOn: new Date(),
    singletonKey: null,
    singletonOn: null,
    deleteAfterSeconds: 600,
    createdOn: new Date(),
    completedOn: null,
    keepUntil: new Date(),
    policy: "standard",
    heartbeatOn: new Date(),
    blocked: false,
    blocking: false,
    pendingDependencies: 0,
    deadLetter: "",
    output: {},
    sourceName: null,
    sourceId: null,
    sourceCreatedOn: null,
    sourceRetryCount: null,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function validChatResponse(markdown: string): Response {
  return Response.json({
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify({
            markdown,
            evidenceRefs: [],
            citedNumbers: [],
          }),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });
}
