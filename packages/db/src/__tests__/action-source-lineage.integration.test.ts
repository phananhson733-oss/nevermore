import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type Db, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import { ActionsRepository } from "../repositories/actions.ts";
import { EvidenceRepository } from "../repositories/evidence.ts";
import { FindingsRepository } from "../repositories/findings.ts";
import {
  actions,
  asyncRuns,
  clientProjects,
  diagnosticRuns,
  icpProfiles,
  sites,
  workspaces,
} from "../schema.ts";

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

interface ProjectFixture {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly icpProfileId: string;
}

interface FindingFixture extends ProjectFixture {
  readonly findingId: string;
  readonly sourceDiagnosticRunId: string;
}

async function createProjectFixture(db: Db): Promise<ProjectFixture> {
  const actorId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const icpProfileId = randomUUID();

  await db.insert(workspaces).values({
    id: workspaceId,
    name: `Action lineage ${workspaceId}`,
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
  await db.insert(icpProfiles).values({
    id: icpProfileId,
    workspace_id: workspaceId,
    project_id: projectId,
    version: 1,
    status: "complete",
    profile: { fixtureId: randomUUID() },
    content_hash: contentHash({ fixtureId: randomUUID() }),
    created_by: actorId,
  });

  return { actorId, workspaceId, projectId, siteId, icpProfileId };
}

async function createDiagnosticRun(
  db: Db,
  fixture: ProjectFixture,
): Promise<string> {
  const runId = randomUUID();
  const now = new Date().toISOString();
  await db.insert(asyncRuns).values({
    id: runId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "diagnostic",
    status: "completed",
    active_key: null,
    initiated_by: fixture.actorId,
    started_at: now,
    completed_at: now,
  });
  await db.insert(diagnosticRuns).values({
    id: runId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    site_id: fixture.siteId,
    icp_profile_id: fixture.icpProfileId,
    icp_profile_version: 1,
    rule_set_version: "mvp.rules.0.2.0",
    prompt_set_version: "mvp.prompts.0.2.0",
    output_locale: "en",
    input_manifest: { fixtureId: randomUUID() },
    input_hash: contentHash({ runId }),
  });
  return runId;
}

async function linkFindingObservation(
  db: Db,
  fixture: ProjectFixture,
  findingId: string,
  diagnosticRunId: string,
): Promise<void> {
  const observedAt = new Date().toISOString();
  const [evidenceId] = await new EvidenceRepository(db).insertMany(
    {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      diagnosticRunId,
    },
    [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "A",
        availability: "available",
        support: "supports",
        subjectRefs: ["https://example.test/page"],
        claim: "Observed source lineage.",
        observedAt,
        limitation: "Disposable integration fixture.",
      },
    ],
  );
  await new EvidenceRepository(db).linkObservations(
    {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      diagnosticRunId,
    },
    [{ findingId, evidenceId: evidenceId!, role: "primary" }],
  );
}

async function createFindingFixture(db: Db): Promise<FindingFixture> {
  const project = await createProjectFixture(db);
  const sourceDiagnosticRunId = await createDiagnosticRun(db, project);
  const seenAt = new Date().toISOString();
  const finding = await new FindingsRepository(db).insert({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    findingKey: contentHash({ fixtureId: randomUUID() }),
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
    ruleFamily: "http-status",
    intent: "restore_or_redirect",
    domain: "technical_seo",
    titleKey: "finding.http_status",
    titleArgs: { status: 404 },
    summary: "A traced integration finding.",
    summaryLocale: "en",
    subjectRefs: ["http_status:404"],
    severity: "high",
    confidence: "high",
    reviewState: "confirmed",
    runId: sourceDiagnosticRunId,
    seenAt,
  });
  await linkFindingObservation(
    db,
    project,
    finding.id,
    sourceDiagnosticRunId,
  );
  return {
    ...project,
    findingId: finding.id,
    sourceDiagnosticRunId,
  };
}

function actionInsert(fixture: FindingFixture, sourceDiagnosticRunId: string) {
  return {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    sourceFindingId: fixture.findingId,
    sourceDiagnosticRunId,
    actionKey: contentHash({ fixtureId: randomUUID() }),
    templateId: `template.${randomUUID()}`,
    templateVersion: 1,
    title: "Repair traced issue",
    description: "Repair the issue recorded by the frozen diagnostic run.",
    contentLocale: "en",
    priorityBand: "high",
    roadmapLane: "now",
    status: "candidate",
    effort: "small",
    risk: "low",
    expectedOutcome: "The traced issue is resolved.",
    evidenceRefs: [],
    createdBy: fixture.actorId,
  };
}

describeDb("Action source DiagnosticRun lineage", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("persists the exact DiagnosticRun that observed the source finding", async () => {
    const fixture = await createFindingFixture(handle.db);
    const action = await new ActionsRepository(handle.db).insert(
      actionInsert(fixture, fixture.sourceDiagnosticRunId),
    );

    expect(action.source_finding_id).toBe(fixture.findingId);
    expect(action.source_diagnostic_run_id).toBe(
      fixture.sourceDiagnosticRunId,
    );
  });

  it("rejects an unobserved run and a run from another project", async () => {
    const fixture = await createFindingFixture(handle.db);
    const unobservedRunId = await createDiagnosticRun(handle.db, fixture);
    await expectPgCode(
      new ActionsRepository(handle.db).insert(
        actionInsert(fixture, unobservedRunId),
      ),
      "23514",
    );

    const otherProject = await createProjectFixture(handle.db);
    const otherRunId = await createDiagnosticRun(handle.db, otherProject);
    await expectPgCode(
      new ActionsRepository(handle.db).insert(actionInsert(fixture, otherRunId)),
      "23514",
    );
  });

  it("requires the run that is current when the Action is first inserted", async () => {
    const fixture = await createFindingFixture(handle.db);
    const laterRunId = await createDiagnosticRun(handle.db, fixture);
    await linkFindingObservation(
      handle.db,
      fixture,
      fixture.findingId,
      laterRunId,
    );
    await new FindingsRepository(handle.db).touchSeen(fixture.findingId, {
      severity: "medium",
      confidence: "high",
      titleArgs: { status: 404 },
      summary: "The finding was observed again.",
      summaryLocale: "en",
      subjectRefs: ["http_status:404"],
      runId: laterRunId,
      seenAt: new Date().toISOString(),
      regressed: false,
    });

    await expectPgCode(
      new ActionsRepository(handle.db).insert(
        actionInsert(fixture, fixture.sourceDiagnosticRunId),
      ),
      "23514",
    );
    const action = await new ActionsRepository(handle.db).insert(
      actionInsert(fixture, laterRunId),
    );
    expect(action.source_diagnostic_run_id).toBe(laterRunId);
  });

  it("does not treat a cross-run evidence link as a real observation", async () => {
    const fixture = await createFindingFixture(handle.db);
    const laterRunId = await createDiagnosticRun(handle.db, fixture);
    const [earlierEvidenceId] = await new EvidenceRepository(
      handle.db,
    ).insertMany(
      {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        diagnosticRunId: fixture.sourceDiagnosticRunId,
      },
      [
        {
          sourceProvider: "crawl",
          origin: "direct_public",
          method: "observed",
          grade: "B",
          availability: "available",
          support: "context",
          subjectRefs: ["https://example.test/corrupt"],
          claim: "Evidence belongs to the earlier run.",
          observedAt: new Date().toISOString(),
          limitation: "Deliberately corrupt relationship fixture.",
        },
      ],
    );
    await new EvidenceRepository(handle.db).linkObservations(
      {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        diagnosticRunId: laterRunId,
      },
      [
        {
          findingId: fixture.findingId,
          evidenceId: earlierEvidenceId!,
          role: "primary",
        },
      ],
    );
    await new FindingsRepository(handle.db).touchSeen(fixture.findingId, {
      severity: "medium",
      confidence: "high",
      titleArgs: { status: 404 },
      summary: "The corrupt link claims a later observation.",
      summaryLocale: "en",
      subjectRefs: ["http_status:404"],
      runId: laterRunId,
      seenAt: new Date().toISOString(),
      regressed: false,
    });

    await expectPgCode(
      new ActionsRepository(handle.db).insert(
        actionInsert(fixture, laterRunId),
      ),
      "23514",
    );
  });

  it("keeps both source ids immutable while allowing overrides after finding drift", async () => {
    const fixture = await createFindingFixture(handle.db);
    const repo = new ActionsRepository(handle.db);
    const action = await repo.insert(
      actionInsert(fixture, fixture.sourceDiagnosticRunId),
    );
    const laterRunId = await createDiagnosticRun(handle.db, fixture);
    await linkFindingObservation(
      handle.db,
      fixture,
      fixture.findingId,
      laterRunId,
    );
    await new FindingsRepository(handle.db).touchSeen(fixture.findingId, {
      severity: "medium",
      confidence: "high",
      titleArgs: { status: 404 },
      summary: "The finding moved to a later run.",
      summaryLocale: "en",
      subjectRefs: ["http_status:404"],
      runId: laterRunId,
      seenAt: new Date().toISOString(),
      regressed: false,
    });

    await expect(
      repo.applyOverride(
        { workspaceId: fixture.workspaceId, projectId: fixture.projectId },
        action.id,
        {
          status: "planned",
          expectedRevision: 1,
          toRevision: 2,
        },
      ),
    ).resolves.toBe(true);
    const afterOverride = await handle.db.query.actions.findFirst({
      where: eq(actions.id, action.id),
    });
    expect(afterOverride).toMatchObject({
      revision: 2,
      status: "planned",
      source_finding_id: fixture.findingId,
      source_diagnostic_run_id: fixture.sourceDiagnosticRunId,
    });

    await expectPgCode(
      handle.db
        .update(actions)
        .set({ source_diagnostic_run_id: laterRunId })
        .where(eq(actions.id, action.id)),
      "23514",
    );
    await expectPgCode(
      handle.db
        .update(actions)
        .set({ source_finding_id: randomUUID() })
        .where(eq(actions.id, action.id)),
      "23514",
    );
  });
});
