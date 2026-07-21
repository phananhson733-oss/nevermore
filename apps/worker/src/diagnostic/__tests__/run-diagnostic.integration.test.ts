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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  ActionsRepository,
  AsyncRunsRepository,
  CollectionRunsRepository,
  DataSnapshotsRepository,
  DiagnosticRunsRepository,
  EvidenceRepository,
  FindingsRepository,
  ObservationsRepository,
  ProjectsRepository,
  ProviderDiscrepanciesRepository,
  SitesRepository,
  contentHash,
  type ObservationInsert,
  type PgBoss,
  type ProjectScope,
} from "@sf/db";
import { FINDING_REGISTRY, findingKey, type RuleId } from "@sf/engine";
import {
  LocalFsBlobStore,
  METRIC_CRAWL_PAGE,
  METRIC_CRAWL_ROBOTS,
  METRIC_GA4_LANDING,
  subjectUrlOf,
  type CrawlLinkProjection,
  type CrawlPageProjection,
  type CrawlRobotsProjection,
  type Ga4LandingProjection,
} from "@sf/sources";
import type { Logger } from "@sf/observability";
import type { WorkerContext } from "../../context.ts";
import { runDiagnostic } from "../run-diagnostic.ts";

/**
 * AC-026 / AC-028 — the diagnostic runner's cross-run resolution + identity
 * (spec §8.6, §9.2), exercised end-to-end against a real local Postgres:
 *  - a `completed` run (every rule ran) auto-resolves stale findings;
 *  - a `partial` run (a skipped dataset rule) resolves NOTHING;
 *  - a re-hit of a resolved finding flips it to `regressed`;
 *  - a cross-run re-hit preserves the human review priority/status and only
 *    MERGES new evidence into an existing non-dismissed Action.
 *
 * The runner hard-codes `ALL_RULES`, so a `completed` run is produced from a
 * fully-clean, full-coverage fixture where all 11 rules pass; a `partial` run is
 * produced by a crawl-only manifest (search/GA4/CSV rules are `skipped`).
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const OBSERVED_AT = new Date().toISOString();

const NOOP = (): void => undefined;
const testLogger: Logger = {
  context: { service: "worker", environment: "test" },
  child: () => testLogger,
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

interface Seed {
  readonly scope: ProjectScope;
  readonly siteId: string;
  readonly origin: string;
  readonly actor: string;
}

describeDb("diagnostic runner cross-run resolution (spec §8.6, §9.2)", () => {
  let handle: DbHandle;
  let ctx: WorkerContext;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
    ctx = {
      db: handle.db,
      boss: {} as unknown as PgBoss, // the diagnostic runner never enqueues
      blobStore: new LocalFsBlobStore(
        mkdtempSync(path.join(os.tmpdir(), "sf-diagnostic-test-")),
      ),
      credentialKey: Buffer.alloc(32),
      appOrigin: "http://localhost:3000",
      googleOAuth: { clientId: "test-client", clientSecret: "test-secret" },
      openai: { apiKey: "sk-test", model: "gpt-4o-mini" },
      findingSummariesEnabled: true,
      logger: testLogger,
    };
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("AC-026: a completed (all-rules-ran) run auto-resolves a stale finding", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, cleanProfile(seed.origin));
    const snapshotId = await seedSnapshot(
      handle,
      seed,
      cleanObservations(seed.origin),
    );

    const priorRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl"]),
      "completed",
    );
    const stale = await seedFinding(handle, seed, priorRunId, "TECH-HTTP-001", [
      "http_status:404",
    ]);

    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl", "gsc", "ga4", "csv"]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const run = await new DiagnosticRunsRepository(handle.db).findById(
      seed.scope,
      runId,
    );
    expect(run).not.toBeNull();
    const runStatus = await runStatusOf(handle, seed.scope, runId);
    expect(runStatus).toBe("completed");

    const resolved = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      stale.key,
    );
    expect(resolved?.active).toBe(false);
    expect(resolved?.resolved_at).not.toBeNull();
  });

  it("AC-026: a partial run (skipped dataset) resolves NOTHING", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshotId = await seedSnapshot(handle, seed, [
      crawlPage(su(`${seed.origin}/`), mkPage({ fetchUrl: `${seed.origin}/` })),
    ]);

    const priorRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl"]),
      "completed",
    );
    const stale = await seedFinding(handle, seed, priorRunId, "TECH-HTTP-001", [
      "http_status:404",
    ]);

    // Only crawl is declared available → GSC/GA4/CSV rules are `skipped` → partial.
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl"]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(await runStatusOf(handle, seed.scope, runId)).toBe("partial");
    const untouched = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      stale.key,
    );
    expect(untouched?.active).toBe(true);
    expect(untouched?.resolved_at).toBeNull();
  });

  it("AC-026: a re-hit of a resolved finding flips it to regressed", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshotId = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/gone`),
        mkPage({
          fetchUrl: `${seed.origin}/gone`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);

    const priorRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl"]),
      "completed",
    );
    const finding = await seedFinding(
      handle,
      seed,
      priorRunId,
      "TECH-HTTP-001",
      ["http_status:404"],
    );
    // Resolve it (as a prior clean run would have).
    await new FindingsRepository(handle.db).resolveByKeysExcept(
      seed.scope,
      ["TECH-HTTP-001"],
      [],
      new Date().toISOString(),
    );
    const before = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      finding.key,
    );
    expect(before?.active).toBe(false);

    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl"]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const after = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      finding.key,
    );
    expect(after?.active).toBe(true);
    expect(after?.regressed).toBe(true);
    expect(after?.resolved_at).toBeNull();
  });

  it("AC-028: a cross-run re-hit preserves the human review state and merges evidence into the existing Action", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshotId = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/gone`),
        mkPage({
          fetchUrl: `${seed.origin}/gone`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);

    const priorRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl"]),
      "completed",
    );
    const finding = await seedFinding(
      handle,
      seed,
      priorRunId,
      "TECH-HTTP-001",
      ["http_status:404"],
    );
    // The operator confirmed this finding (review revision advanced by a human).
    const reviewed = await new FindingsRepository(handle.db).updateReview(
      seed.scope,
      finding.id,
      {
        reviewState: "confirmed",
        reviewRevision: 2,
        reason: null,
        note: null,
        expectedRevision: 0,
      },
    );
    expect(reviewed).toBe(true);

    const existingEvidenceRef = randomUUID();
    const action = await new ActionsRepository(handle.db).insert({
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      sourceFindingId: finding.id,
      sourceDiagnosticRunId: priorRunId,
      actionKey: contentHash({ action: finding.id }),
      templateId: "tech-http-fix",
      templateVersion: 1,
      title: "Fix broken pages",
      description: "Repair the 404 responses.",
      contentLocale: "en",
      priorityBand: "high",
      roadmapLane: "now",
      status: "planned",
      effort: "small",
      risk: "low",
      expectedOutcome: "The pages return 200.",
      evidenceRefs: [existingEvidenceRef],
      createdBy: seed.actor,
    });

    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl"]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    // Human review projection is preserved on the re-hit (never reset).
    const rehit = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      finding.key,
    );
    expect(rehit?.review_state).toBe("confirmed");
    expect(rehit?.review_revision).toBe(2);

    // The Action's human priority/status are untouched; only evidence is merged.
    const mergedAction = await new ActionsRepository(handle.db).findById(
      seed.scope,
      action.id,
    );
    expect(mergedAction?.priority_band).toBe("high");
    expect(mergedAction?.status).toBe("planned");
    const refs = mergedAction?.evidence_refs as string[];
    expect(refs).toContain(existingEvidenceRef);
    expect(refs.length).toBeGreaterThan(1);
  });

  it("caps confidence only when an unresolved discrepancy overlaps this frozen manifest finding/evidence", async () => {
    const seed = await seedProject(handle);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const conflictingSubject = su(`${seed.origin}/conflicting`);
    const cleanSubject = su(`${seed.origin}/clean-500`);
    const frozenSnapshotId = await seedSnapshot(handle, seed, [
      crawlPage(
        conflictingSubject,
        mkPage({
          fetchUrl: conflictingSubject,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
      crawlPage(
        cleanSubject,
        mkPage({
          fetchUrl: cleanSubject,
          status: 500,
          finalStatus: 500,
          robotsIndexable: false,
        }),
      ),
    ]);
    const comparisonSnapshotId = await seedSnapshot(handle, seed, [
      crawlPage(
        conflictingSubject,
        mkPage({ fetchUrl: conflictingSubject }),
      ),
    ]);
    const frozenRows = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [frozenSnapshotId]);
    const comparisonRows = await new ObservationsRepository(
      handle.db,
    ).listBySnapshotIds(seed.scope, [comparisonSnapshotId]);
    const left = frozenRows.find(
      (row) => row.subject_ref === conflictingSubject,
    );
    const right = comparisonRows.find(
      (row) => row.subject_ref === conflictingSubject,
    );
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    await new ProviderDiscrepanciesRepository(handle.db).insert(seed.scope, {
      metricKey: METRIC_CRAWL_PAGE,
      subjectType: "url",
      subjectRef: conflictingSubject,
      // Deliberately reverse lexical order; the repository canonicalizes it.
      leftObservationId: right!.id,
      rightObservationId: left!.id,
    });

    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(frozenSnapshotId, ["crawl"]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    const conflictingFinding = await new FindingsRepository(
      handle.db,
    ).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", [
        "http_status:404",
      ]),
    );
    const cleanFinding = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", [
        "http_status:500",
      ]),
    );
    expect(conflictingFinding?.confidence).toBe("medium");
    expect(cleanFinding?.confidence).toBe("high");

    // A later run freezes a third snapshot. Although it has the same subjects,
    // neither side of the recorded pair belongs to that manifest, so confidence
    // must not be downgraded by stale/non-frozen data.
    const unrelatedSnapshotId = await seedSnapshot(handle, seed, [
      crawlPage(
        conflictingSubject,
        mkPage({
          fetchUrl: conflictingSubject,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
      crawlPage(
        cleanSubject,
        mkPage({
          fetchUrl: cleanSubject,
          status: 500,
          finalStatus: 500,
          robotsIndexable: false,
        }),
      ),
    ]);
    const unrelatedRunId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(unrelatedSnapshotId, ["crawl"]),
      "queued",
    );
    await runDiagnostic(ctx, {
      runId: unrelatedRunId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });
    const refreshed = await new FindingsRepository(handle.db).findByKey(
      seed.scope,
      findingKey(seed.scope.projectId, "TECH-HTTP-001", [
        "http_status:404",
      ]),
    );
    expect(refreshed?.confidence).toBe("high");
  });

  it("finishes an accepted diagnostic after archive while keeping the project stage frozen", async () => {
    const seed = await seedProject(handle);
    const projects = new ProjectsRepository(handle.db);
    const icpId = await seedIcp(handle, seed, minimalProfile());
    const snapshotId = await seedSnapshot(handle, seed, [
      crawlPage(
        su(`${seed.origin}/archived-diagnostic`),
        mkPage({
          fetchUrl: `${seed.origin}/archived-diagnostic`,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
    ]);
    await projects.setStage(
      { workspaceId: seed.scope.workspaceId },
      seed.scope.projectId,
      "diagnosing",
    );
    const runId = await seedDiagnosticRun(
      handle,
      seed,
      icpId,
      manifestOf(snapshotId, ["crawl"]),
      "queued",
    );
    await handle.pool.query(
      `update app.client_projects
          set archived_at = now()
        where workspace_id = $1
          and id = $2`,
      [seed.scope.workspaceId, seed.scope.projectId],
    );

    await runDiagnostic(ctx, {
      runId,
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
    });

    expect(await runStatusOf(handle, seed.scope, runId)).toBe("partial");
    expect(
      await new DiagnosticRunsRepository(handle.db).listRuleResults(runId),
    ).not.toHaveLength(0);
    await expect(
      projects.findById(
        { workspaceId: seed.scope.workspaceId },
        seed.scope.projectId,
      ),
    ).resolves.toMatchObject({
      stage: "diagnosing",
      archived_at: expect.any(String),
    });
  });
});

// --- seeding helpers --------------------------------------------------------

async function seedProject(handle: DbHandle): Promise<Seed> {
  const actor = randomUUID();
  const [ws] = await handle.db
    .insert(workspaces)
    .values({ name: `WS-${randomUUID()}` })
    .returning();
  const workspaceId = ws!.id;
  const project = await new ProjectsRepository(handle.db).insert({
    workspaceId,
    clientName: "Diag",
    projectName: "Diag",
    defaultDeliveryLocale: "en",
    createdBy: actor,
  });
  const host = `diag-${randomUUID().slice(0, 8)}.example`;
  const origin = `https://${host}`;
  const site = await new SitesRepository(handle.db).insertPrimary({
    workspaceId,
    projectId: project.id,
    origin,
    host,
    marketCodes: ["US"],
    languageCodes: ["en"],
  });
  return {
    scope: { workspaceId, projectId: project.id },
    siteId: site.id,
    origin,
    actor,
  };
}

async function seedIcp(
  handle: DbHandle,
  seed: Seed,
  profile: Record<string, unknown>,
): Promise<string> {
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: seed.scope.workspaceId,
      project_id: seed.scope.projectId,
      version: 1,
      status: "complete",
      profile,
      content_hash: contentHash({ icp: randomUUID() }),
      created_by: seed.actor,
    })
    .returning();
  return icp!.id;
}

/** Insert a crawl snapshot holding the given observations (shared collection run). */
async function seedSnapshot(
  handle: DbHandle,
  seed: Seed,
  observations: readonly ObservationInsert[],
): Promise<string> {
  const collectionRunId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: seed.scope.workspaceId,
    project_id: seed.scope.projectId,
    kind: "collection",
    status: "completed",
    initiated_by: seed.actor,
    started_at: OBSERVED_AT,
    completed_at: OBSERVED_AT,
  });
  await new CollectionRunsRepository(handle.db).insertPlaceholder({
    runId: collectionRunId,
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    sourceConnectionId: null,
    provider: "crawl",
    operation: "site_graph",
    methodVersion: "crawl.site_graph.v1",
    parametersHash: contentHash({ c: collectionRunId }),
  });
  const snapshot = await new DataSnapshotsRepository(handle.db).insert({
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    collectionRunId,
    sourceConnectionId: null,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: "0.2.0",
    methodVersion: "crawl.site_graph.v1",
    capturedAt: OBSERVED_AT,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "test crawl snapshot",
    rawObjectKey: null,
    rowCount: observations.length,
    checksum: contentHash({ s: collectionRunId }),
  });
  await new ObservationsRepository(handle.db).insertMany(
    seed.scope,
    snapshot.id,
    "crawl",
    observations,
  );
  return snapshot.id;
}

async function seedDiagnosticRun(
  handle: DbHandle,
  seed: Seed,
  icpProfileId: string,
  inputManifest: Record<string, unknown>,
  status: "queued" | "completed",
): Promise<string> {
  const runId = randomUUID();
  await handle.db.insert(asyncRuns).values({
    id: runId,
    workspace_id: seed.scope.workspaceId,
    project_id: seed.scope.projectId,
    kind: "diagnostic",
    status,
    initiated_by: seed.actor,
    ...(status === "completed"
      ? { started_at: OBSERVED_AT, completed_at: OBSERVED_AT }
      : {}),
  });
  await new DiagnosticRunsRepository(handle.db).insert({
    runId,
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    siteId: seed.siteId,
    icpProfileId,
    icpProfileVersion: 1,
    ruleSetVersion: "mvp.rules.0.2.0",
    promptSetVersion: "mvp.prompts.0.2.0",
    outputLocale: "en",
    inputManifest,
    inputHash: contentHash({ r: runId }),
  });
  return runId;
}

async function seedFinding(
  handle: DbHandle,
  seed: Seed,
  runId: string,
  ruleId: RuleId,
  subjectRefs: readonly string[],
): Promise<{ id: string; key: string }> {
  const meta = FINDING_REGISTRY[ruleId];
  const key = findingKey(seed.scope.projectId, ruleId, subjectRefs);
  const row = await new FindingsRepository(handle.db).insert({
    workspaceId: seed.scope.workspaceId,
    projectId: seed.scope.projectId,
    findingKey: key,
    ruleId,
    ruleVersion: 1,
    ruleFamily: meta.ruleFamily,
    intent: meta.intent,
    domain: meta.domain,
    titleKey: meta.titleKey,
    titleArgs: {},
    summary: "seeded prior-run finding",
    summaryLocale: "en",
    subjectRefs: [...subjectRefs],
    severity: "high",
    confidence: "high",
    reviewState: "unreviewed",
    runId,
    seenAt: OBSERVED_AT,
  });
  const [evidenceId] = await new EvidenceRepository(handle.db).insertMany(
    {
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      diagnosticRunId: runId,
    },
    [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: [...subjectRefs],
        claim: "Seeded prior-run finding observation.",
        observedAt: OBSERVED_AT,
        limitation: "Disposable diagnostic integration fixture.",
      },
    ],
  );
  await new EvidenceRepository(handle.db).linkObservations(
    {
      workspaceId: seed.scope.workspaceId,
      projectId: seed.scope.projectId,
      diagnosticRunId: runId,
    },
    [{ findingId: row.id, evidenceId: evidenceId!, role: "primary" }],
  );
  return { id: row.id, key };
}

async function runStatusOf(
  handle: DbHandle,
  scope: ProjectScope,
  runId: string,
): Promise<string> {
  const run = await new AsyncRunsRepository(handle.db).findById(scope, runId);
  return run?.status ?? "missing";
}

// --- fixture builders -------------------------------------------------------

function manifestOf(
  snapshotId: string,
  providers: readonly string[],
): Record<string, unknown> {
  return {
    snapshots: providers.map((provider) => ({
      snapshotId,
      provider,
      availability: "available",
      capturedAt: OBSERVED_AT,
    })),
  };
}

/** An English ICP whose single conversion target is the (commercial) pricing page. */
function cleanProfile(origin: string): Record<string, unknown> {
  return {
    productName: "Acme",
    oneLineDescription: "B2B widgets for busy teams.",
    siteLanguageCodes: ["en"],
    defaultDeliveryLocale: "en",
    marketCodes: ["US"],
    offers: [],
    useCases: [],
    differentiators: [],
    priorityUrls: [],
    primaryConversion: {
      label: "Buy",
      type: "purchase",
      targetUrl: `${origin}/pricing`,
    },
  };
}

function minimalProfile(): Record<string, unknown> {
  return {
    productName: "Acme",
    oneLineDescription: "Widgets.",
    siteLanguageCodes: ["en"],
    defaultDeliveryLocale: "en",
    marketCodes: ["US"],
  };
}

/**
 * A fully-clean, full-coverage crawl fixture: a healthy commercial page (the
 * conversion target) with structured entity + proof coverage, two non-commercial
 * pages that give it 2 internal inlinks, and one GA4 landing row with a usable
 * baseline. Every one of the 11 rules passes → the run is `completed`.
 */
function cleanObservations(origin: string): ObservationInsert[] {
  const pricing = su(`${origin}/pricing`);
  const home = su(`${origin}/`);
  const about = su(`${origin}/about`);
  return [
    crawlRobots(origin),
    crawlPage(
      pricing,
      mkPage({
        fetchUrl: `${origin}/pricing`,
        title: "Pricing",
        h1: ["Pricing"],
        jsonLdTypes: ["Organization"],
        paragraphs: [
          "Acme Corp helped 1,200 teams and grew revenue by 40% last year.",
        ],
      }),
    ),
    crawlPage(
      home,
      mkPage({ fetchUrl: `${origin}/`, internalOutlinks: [link(pricing)] }),
    ),
    crawlPage(
      about,
      mkPage({
        fetchUrl: `${origin}/about`,
        internalOutlinks: [link(pricing)],
      }),
    ),
    ga4Landing(`${origin}/landing`, {
      sessions: 100,
      engagedSessions: null,
      engagementRate: null,
      keyEvents: 5,
      keyEventUnavailableReason: null,
    }),
  ];
}

function crawlRobots(subjectRef: string): ObservationInsert {
  return {
    metricKey: METRIC_CRAWL_ROBOTS,
    subjectType: "site",
    subjectRef,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: {
      fetched: true,
      groups: [{ userAgent: "*", disallow: [], allow: [] }],
      sitemaps: [],
    } satisfies CrawlRobotsProjection,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "public robots.txt fetch",
  };
}

function su(url: string): string {
  const subject = subjectUrlOf(url);
  if (!subject) throw new Error(`unparseable url: ${url}`);
  return subject;
}

function link(targetSubjectUrl: string): CrawlLinkProjection {
  return { targetSubjectUrl, rel: null, anchorText: null };
}

function mkPage(o: {
  fetchUrl: string;
  status?: number;
  finalStatus?: number;
  robotsIndexable?: boolean;
  title?: string;
  h1?: readonly string[];
  jsonLdTypes?: readonly string[];
  paragraphs?: readonly string[];
  internalOutlinks?: readonly CrawlLinkProjection[];
}): CrawlPageProjection {
  return {
    fetchUrl: o.fetchUrl,
    status: o.status ?? 200,
    finalStatus: o.finalStatus ?? 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: o.robotsIndexable ?? true,
    robotsDirectives: [],
    title: o.title ?? null,
    metaDescription: null,
    h1: o.h1 ?? [],
    headings: [],
    wordCount: 100,
    internalOutlinks: o.internalOutlinks ?? [],
    jsonLd: { types: o.jsonLdTypes ?? [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: o.paragraphs ?? [],
    responseMs: 10,
    contentType: "text/html",
  };
}

function crawlPage(
  subjectRef: string,
  projection: CrawlPageProjection,
): ObservationInsert {
  return {
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "direct_public",
    grade: "B",
    support: "supports",
    limitation: "public crawl fetch",
  };
}

function ga4Landing(
  subjectRef: string,
  projection: Ga4LandingProjection,
): ObservationInsert {
  return {
    metricKey: METRIC_GA4_LANDING,
    subjectType: "url",
    subjectRef,
    observedAt: OBSERVED_AT,
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson: projection,
    unit: null,
    origin: "first_party",
    grade: "A",
    support: "supports",
    limitation: "ga4 landing metrics",
  };
}
