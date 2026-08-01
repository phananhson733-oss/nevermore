import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

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

import {
  buildProductProfileDraft,
  PRODUCT_PROFILE_PROMPT_SET_VERSION,
  type ProductProfileSemanticCandidateEnvelope,
} from "@sf/artifacts";
import {
  createInitialProductProfileDraft,
  PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
  PRODUCT_PROFILE_SYNTHESIS_VERSION,
  type ConfirmedProductProfile,
  type ProductProfileSynthesisInputManifest,
} from "@sf/contracts";
import {
  AnalysisInvocationsRepository,
  AsyncRunsRepository,
  CollectionRunsRepository,
  CompetitorsRepository,
  contentHash,
  DataSnapshotsRepository,
  IcpProfilesRepository,
  normalizedUrlHash,
  PageSnapshotsRepository,
  ProductProfileRunsRepository,
  SitePagesRepository,
  SourceConnectionsRepository,
  type CanonicalValue,
  type DbTx,
  type Executor,
} from "@sf/db";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSafeTestDatabaseUrl } from "../../../../../packages/db/src/test-database-safety.ts";
import {
  buildProductProfileCompetitorOriginInput,
  projectConfirmedProductProfileCompetitors,
} from "./product-profile-competitor-projection";
import { confirmProductProfile } from "./product-profile";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

async function inRolledBackFixture(
  handle: DbHandle,
  test: (tx: DbTx) => Promise<void>,
): Promise<void> {
  const rollback = new Error(`rollback-competitor-projection-fixture-${randomUUID()}`);
  try {
    await handle.db.transaction(async (tx) => {
      await test(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

function confirmedProfile(project?: ProjectFixture): ConfirmedProductProfile {
  const publicHost =
    project === undefined
      ? "relayops.gengrowth.ai"
      : `p${project.projectId.slice(0, 8)}.projection.gengrowth.ai`;
  const draft = createInitialProductProfileDraft({
    sourceSiteId: project?.siteId ?? "00000000-0000-4000-8000-000000000003",
    sourcePageUrl:
      project === undefined
        ? `https://${publicHost}/product`
        : `https://${publicHost}/product`,
    businessHint: "B2B onboarding software",
  });
  return {
    ...draft,
    productName: "RelayOps",
    oneLiner: "Automate customer onboarding operations.",
    category: "Customer onboarding",
    productType: "B2B SaaS",
    businessModels: ["subscription"],
    valueProposition: "Help operations teams standardize onboarding.",
    coreFeatures: ["Workflow automation"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        candidateId: "00000000-0000-4000-8000-000000000010",
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies with 50-500 employees",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize customer onboarding"],
        triggers: ["Onboarding volume increased"],
        pains: ["Manual handoffs"],
        jtbd: ["Reduce time to value"],
        outcomes: ["Faster activation"],
        barriers: ["Fragmented systems"],
        qualificationSignals: ["Dedicated customer operations team"],
        disqualifiers: [],
      },
    ],
    competitorCandidates: [
      {
        candidateId: "00000000-0000-4000-8000-000000000011",
        name: "Competitor one",
        domain: "one.example",
        relationship: "direct",
        analysisScope: ["keyword_gap", "positioning"],
        similarity: 0.7,
        reason: "Grounded in product pages.",
        reviewStatus: "approved",
        confidence: "high",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000000012",
        name: "Competitor two",
        domain: "two.example",
        relationship: null,
        analysisScope: [],
        similarity: null,
        reason: "Candidate only.",
        reviewStatus: "candidate",
        confidence: "medium",
      },
    ],
    fieldProvenance: [
      ...draft.fieldProvenance,
      {
        path: "/competitorCandidates",
        derivation: "declared",
        confidence: "high",
        evidenceRefs: [
          {
            evidenceRefId: "00000000-0000-4000-8000-000000000020",
            kind: "userEdit",
          },
        ],
        limitation: "Customer-reviewed pool.",
        observedAt: null,
      },
      {
        path: "/competitorCandidates/0",
        derivation: "declared",
        confidence: "high",
        evidenceRefs: [
          {
            evidenceRefId: "00000000-0000-4000-8000-000000000021",
            kind: "userEdit",
          },
        ],
        limitation: "Exact candidate edit.",
        observedAt: null,
      },
    ],
    missingFields: draft.missingFields.filter(
      (path) => path !== "/competitorCandidates",
    ),
    conflictingFields: [],
  };
}

function productionSemanticCandidate(): ProductProfileSemanticCandidateEnvelope {
  const grounding = {
    confidence: "high" as const,
    sourcePageKeys: ["page-1"],
    usesBusinessHint: false,
  };
  return {
    productName: { value: "RelayOps", ...grounding },
    oneLiner: {
      value: "Automate customer onboarding operations.",
      ...grounding,
    },
    category: { value: "Customer onboarding", ...grounding },
    productType: { value: "B2B SaaS", ...grounding },
    valueProposition: {
      value: "Help operations teams standardize onboarding.",
      ...grounding,
    },
    businessModels: [{ value: "subscription", ...grounding }],
    coreFeatures: [{ value: "Workflow automation", ...grounding }],
    targetMarkets: [
      { marketCode: "US", priority: "primary", ...grounding },
    ],
    targetAudiences: [
      {
        targetCompanyOrAudience: "B2B SaaS companies with 50-500 employees",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize customer onboarding"],
        triggers: ["Onboarding volume increased"],
        pains: ["Manual handoffs"],
        jtbd: ["Reduce time to value"],
        outcomes: ["Faster activation"],
        barriers: ["Fragmented systems"],
        qualificationSignals: ["Dedicated customer operations team"],
        disqualifiers: [],
        ...grounding,
      },
    ],
    competitorCandidates: [
      {
        name: "Generated competitor",
        domain: "generated.example",
        relationship: "direct",
        analysisScope: ["keyword_gap", "positioning"],
        similarity: 0.8,
        reason: "Grounded in a production-shaped page candidate.",
        ...grounding,
      },
    ],
    conflicts: [],
    unknownPaths: [],
  };
}

function productionGeneratedProfile(
  project: ProjectFixture,
  lineage: {
    readonly sourceSnapshotId: string;
    readonly analysisInvocationId: string;
    readonly pageSnapshotId: string;
  } = {
    sourceSnapshotId: randomUUID(),
    analysisInvocationId: randomUUID(),
    pageSnapshotId: randomUUID(),
  },
) {
  const generated = buildProductProfileDraft({
    base: createInitialProductProfileDraft({
      sourceSiteId: project.siteId,
      sourcePageUrl: project.sourcePageUrl,
    }),
    candidate: productionSemanticCandidate(),
    sourceSnapshotId: lineage.sourceSnapshotId,
    analysisInvocationId: lineage.analysisInvocationId,
    generatedAt: "2026-07-22T08:30:00Z",
    pageEvidence: { "page-1": lineage.pageSnapshotId },
  });
  const audience = generated.targetAudiences[0];
  const competitor = generated.competitorCandidates[0];
  const provenance = generated.fieldProvenance.find(
    (entry) => entry.path === "/competitorCandidates/0",
  );
  if (!audience || !competitor || !provenance) {
    throw new Error("production generator did not retain its semantic identities");
  }
  // Selecting the Primary ICP is the user review that precedes confirmation;
  // the generator-owned canonical evidence references stay byte-for-byte intact.
  audience.reviewStatus = "primary";
  return { generated, competitor, provenance };
}

describe("product-profile competitor projection", () => {
  it("prefers exact candidate provenance over the pool anchor", () => {
    const profile = confirmedProfile();
    expect(
      buildProductProfileCompetitorOriginInput(
        { id: "00000000-0000-4000-8000-000000000100", version: 4 },
        profile,
        0,
      ),
    ).toMatchObject({
      productProfileId: "00000000-0000-4000-8000-000000000100",
      profileVersion: 4,
      candidateId: "00000000-0000-4000-8000-000000000011",
      fieldProvenancePath: "/competitorCandidates/0",
      evidenceRefs: [
        {
          evidenceRefId: "00000000-0000-4000-8000-000000000021",
          kind: "userEdit",
        },
      ],
      sourceReviewStatus: "approved",
      sourceRelationship: "direct",
      sourceAnalysisScope: ["keyword_gap", "positioning"],
    });
  });

  it("falls back to one pool-level provenance anchor only when exact candidate provenance is absent", () => {
    const profile = confirmedProfile();
    profile.fieldProvenance = profile.fieldProvenance.filter(
      (entry) => entry.path !== "/competitorCandidates/0",
    );
    expect(
      buildProductProfileCompetitorOriginInput(
        { id: "00000000-0000-4000-8000-000000000100", version: 4 },
        profile,
        1,
      ),
    ).toMatchObject({
      candidateId: "00000000-0000-4000-8000-000000000012",
      fieldProvenancePath: "/competitorCandidates",
      sourceReviewStatus: "candidate",
      sourceRelationship: null,
      sourceAnalysisScope: [],
    });
  });

  it("fails closed when no exact or pool-level traceable provenance exists", () => {
    const profile = confirmedProfile();
    profile.fieldProvenance = profile.fieldProvenance.filter(
      (entry) => !entry.path.startsWith("/competitorCandidates"),
    );
    expect(() =>
      buildProductProfileCompetitorOriginInput(
        { id: "00000000-0000-4000-8000-000000000100", version: 4 },
        profile,
        0,
      ),
    ).toThrowError(/no exact traceable provenance/i);
  });

});

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly actorId: string;
  readonly sourcePageUrl: string;
}

async function createProject(db: Executor): Promise<ProjectFixture> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const actorId = randomUUID();
  await db.execute(sql`INSERT INTO app.workspaces (id, name) VALUES (${workspaceId}, ${`Projection ${workspaceId}`})`);
  await db.execute(sql`INSERT INTO app.client_projects (
      id, workspace_id, client_name, project_name,
      default_delivery_locale, created_by
    ) VALUES (${projectId},${workspaceId},${`Client ${projectId}`},${`Project ${projectId}`},'zh-CN',${actorId})`);
  const host = `p${projectId.slice(0, 8)}.projection.gengrowth.ai`;
  const sourcePageUrl = `https://${host}/product`;
  await db.execute(sql`INSERT INTO app.sites (
      id, workspace_id, project_id, origin, host,
      market_codes, language_codes, is_primary
    ) VALUES (${siteId},${workspaceId},${projectId},${`https://${host}`},${host},ARRAY['US'],ARRAY['en-US'],true)`);
  return { workspaceId, projectId, siteId, actorId, sourcePageUrl };
}

async function createConfirmableProductionDraft(
  db: DbHandle["db"],
  project: ProjectFixture,
) {
  const scope = {
    workspaceId: project.workspaceId,
    projectId: project.projectId,
  };
  const profiles = new IcpProfilesRepository(db);
  const baseDraft = createInitialProductProfileDraft({
    sourceSiteId: project.siteId,
    sourcePageUrl: project.sourcePageUrl,
  });
  const base = await profiles.insertVersion({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    version: 1,
    status: "draft",
    profile: baseDraft,
    contentHash: contentHash({
      status: "draft",
      profile: baseDraft as unknown as CanonicalValue,
    }),
    createdBy: project.actorId,
  });

  const source = await new SourceConnectionsRepository(db).insertDefaultCrawl({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    siteId: project.siteId,
    createdBy: project.actorId,
  });
  const collectionRun = await new AsyncRunsRepository(db).insertQueued({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    kind: "collection",
    activeKey: `profile-source:${randomUUID()}`,
    initiatedBy: project.actorId,
    contractVersion: "0.3.0",
  });
  const methodVersion = "crawl.site_graph.v2";
  await new CollectionRunsRepository(db).insertPlaceholder({
    runId: collectionRun.id,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    siteId: project.siteId,
    sourceConnectionId: source.id,
    provider: "crawl",
    operation: "site_graph",
    methodVersion,
    parametersHash: contentHash({ collectionRunId: collectionRun.id }),
  });
  const capturedAt = "2026-07-22T08:00:00.000Z";
  const snapshot = await new DataSnapshotsRepository(db).insert({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    siteId: project.siteId,
    collectionRunId: collectionRun.id,
    sourceConnectionId: source.id,
    provider: "crawl",
    datasetKey: "crawl.site_graph.v1",
    schemaVersion: methodVersion,
    methodVersion,
    capturedAt,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Disposable production-shaped Product Profile source snapshot.",
    rawObjectKey: null,
    rowCount: 1,
    checksum: contentHash({ snapshotFor: collectionRun.id }),
  });
  const sitePage = await new SitePagesRepository(db).upsertNormalizedUrl({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    siteId: project.siteId,
    normalizedUrl: project.sourcePageUrl,
    templateKey: null,
  });
  const extract = {
    schemaVersion: "crawl.page-extract.v1",
    subjectUrl: project.sourcePageUrl,
    depth: 0,
    projection: {
      fetchUrl: project.sourcePageUrl,
      status: 200,
      finalStatus: 200,
      title: "RelayOps customer onboarding",
    },
  };
  const pageSnapshot = await new PageSnapshotsRepository(db).create({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    sitePageId: sitePage.id,
    dataSnapshotId: snapshot.id,
    contentHash: contentHash(extract),
    extract,
    capturedAt,
  });
  await new CollectionRunsRepository(db).finalize(collectionRun.id, {
    rowCount: 1,
    sourceWindow: { start: null, end: null },
    providerUsage: { pagesCollected: 1 },
    stopReason: "fixture_complete",
  });

  const synthesisRun = await new AsyncRunsRepository(db).insertQueued({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    kind: "product_profile_synthesis",
    activeKey: `product-profile:${randomUUID()}`,
    initiatedBy: project.actorId,
    contractVersion: "0.3.0",
  });
  const inputManifest: ProductProfileSynthesisInputManifest = {
    schemaVersion: PRODUCT_PROFILE_SYNTHESIS_INPUT_SCHEMA_VERSION,
    selectionPolicyVersion: PRODUCT_PROFILE_SELECTION_POLICY_VERSION,
    projectId: project.projectId,
    siteId: project.siteId,
    sourcePageUrl: project.sourcePageUrl,
    baseProfile: {
      id: base.id,
      version: base.version,
      contentHash: base.content_hash,
      status: "draft",
    },
    crawlSnapshot: {
      id: snapshot.id,
      collectionRunId: collectionRun.id,
      sourceConnectionId: source.id,
      provider: "crawl",
      datasetKey: "crawl.site_graph.v1",
      schemaVersion: snapshot.schema_version,
      methodVersion: snapshot.method_version,
      capturedAt,
      checksum: snapshot.checksum,
      availability: "available",
      rowCount: 1,
      limitation: snapshot.limitation,
    },
    pages: [
      {
        pageSnapshotId: pageSnapshot.id,
        sitePageId: sitePage.id,
        dataSnapshotId: snapshot.id,
        normalizedUrl: project.sourcePageUrl,
        normalizedUrlHash: normalizedUrlHash(project.sourcePageUrl),
        contentHash: pageSnapshot.content_hash,
        capturedAt,
      },
    ],
  };
  const profileRun = new ProductProfileRunsRepository(db);
  await profileRun.insertPlaceholder({
    runId: synthesisRun.id,
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    siteId: project.siteId,
    baseIcpProfileId: base.id,
    baseIcpProfileVersion: base.version,
    baseIcpProfileContentHash: base.content_hash,
    sourceSnapshotId: snapshot.id,
    synthesisVersion: PRODUCT_PROFILE_SYNTHESIS_VERSION,
    promptSetVersion: PRODUCT_PROFILE_PROMPT_SET_VERSION,
    inputManifest,
    inputHash: contentHash(inputManifest as unknown as CanonicalValue),
  });
  const promptInputHash = contentHash({
    promptSetVersion: PRODUCT_PROFILE_PROMPT_SET_VERSION,
    pageSnapshotId: pageSnapshot.id,
  });
  await profileRun.setPromptInputHash(scope, synthesisRun.id, promptInputHash);
  const analysisInvocationId = await new AnalysisInvocationsRepository(db).insert({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    asyncRunId: synthesisRun.id,
    task: "product_profile_synthesis",
    provider: "openai",
    model: "gpt-test",
    promptSetVersion: PRODUCT_PROFILE_PROMPT_SET_VERSION,
    inputHash: promptInputHash,
    outputHash: contentHash({ generatedFor: synthesisRun.id }),
    status: "succeeded",
    inputTokens: 100,
    outputTokens: 80,
    costUsd: 0.01,
    latencyMs: 50,
    errorCode: null,
  });
  const generated = productionGeneratedProfile(project, {
    sourceSnapshotId: snapshot.id,
    analysisInvocationId,
    pageSnapshotId: pageSnapshot.id,
  });
  const draft = await profiles.insertVersion({
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    version: 2,
    status: "draft",
    profile: generated.generated,
    contentHash: contentHash({
      status: "draft",
      profile: generated.generated as unknown as CanonicalValue,
    }),
    createdBy: project.actorId,
  });
  await profileRun.setResult(scope, synthesisRun.id, draft.id);
  await db.execute(sql`UPDATE app.client_projects
      SET current_icp_profile_id = ${draft.id}
      WHERE workspace_id = ${project.workspaceId} AND id = ${project.projectId}`);
  return { draft, ...generated };
}

async function createConfirmedProfile(
  db: DbHandle["db"],
  project: ProjectFixture,
  profile: ConfirmedProductProfile = confirmedProfile(project),
): Promise<{
  readonly id: string;
  readonly version: number;
  readonly profile: ConfirmedProductProfile;
}> {
  const id = randomUUID();
  const version = 1;
  await db.execute(sql`INSERT INTO app.icp_profiles (
      id, workspace_id, project_id, version, status, profile, content_hash, created_by
    ) VALUES (
      ${id},
      ${project.workspaceId},
      ${project.projectId},
      ${version},
      'complete',
      ${profile},
      ${contentHash({
        status: "complete",
        profile: profile as unknown as CanonicalValue,
      })},
      ${project.actorId}
    )`);
  await db.execute(sql`UPDATE app.client_projects
      SET current_icp_profile_id = ${id}, confirmed_icp_profile_id = ${id}
      WHERE workspace_id = ${project.workspaceId} AND id = ${project.projectId}`);
  return { id, version, profile };
}

async function createCsvCompetitorOrigin(
  db: DbHandle["db"],
  project: ProjectFixture,
  domain: string,
): Promise<void> {
  const repository = new CompetitorsRepository(db);
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  const importPreviewId = randomUUID();
  const sourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const capturedAt = "2026-07-22T08:00:00.000Z";

  await db.execute(sql`INSERT INTO app.import_previews (
      id, workspace_id, project_id, site_id, created_by,
      token_hash, template_id, raw_object_key, file_checksum,
      row_count, detected_columns, suggested_mapping, preview_rows,
      validation_errors, validation_warnings, status, expires_at, consumed_at
    ) VALUES (
      ${importPreviewId},${project.workspaceId},${project.projectId},${project.siteId},${project.actorId},${Buffer.alloc(32)},'keyword_gap_v1',${`raw/${importPreviewId}.csv`},${contentHash({ importPreviewId })},1,
      '[]'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
      'consumed',${"2026-07-23T08:00:00.000Z"},${capturedAt}
    )`);
  await db.execute(sql`INSERT INTO app.source_connections (
      id, workspace_id, project_id, site_id, provider,
      connection_type, state, external_ref, limitation,
      connected_at, created_by
    ) VALUES (
      ${sourceConnectionId},${project.workspaceId},${project.projectId},${project.siteId},'csv','file_import','available',${importPreviewId},
      'Customer-provided keyword-gap CSV.',${capturedAt},${project.actorId}
    )`);
  await db.execute(sql`INSERT INTO app.async_runs (
      id, workspace_id, project_id, kind, status, initiated_by, started_at
    ) VALUES (${collectionRunId},${project.workspaceId},${project.projectId},'collection','running',${project.actorId},${capturedAt})`);
  await db.execute(sql`INSERT INTO app.collection_runs (
      id, workspace_id, project_id, site_id, source_connection_id,
      import_preview_id, provider, operation, method_version, parameters_hash
    ) VALUES (
      ${collectionRunId},${project.workspaceId},${project.projectId},${project.siteId},${sourceConnectionId},${importPreviewId},'csv','keyword_gap_import',
      'csv.keyword_gap.v1',${contentHash({ collectionRunId })}
    )`);
  await db.execute(sql`INSERT INTO app.data_snapshots (
      id, workspace_id, project_id, site_id, collection_run_id,
      source_connection_id, provider, dataset_key, schema_version,
      method_version, captured_at, source_window, availability,
      limitation, row_count, checksum, summary
    ) VALUES (
      ${snapshotId},${project.workspaceId},${project.projectId},${project.siteId},${collectionRunId},${sourceConnectionId},'csv','csv.keyword_gap.v1','0.3.0',
      'csv.keyword_gap.v1',${capturedAt},'{"start":null,"end":null}'::jsonb,
      'available','Customer-provided keyword-gap CSV.',1,${contentHash({ snapshotId })},'{}'::jsonb
    )`);
  await db.execute(sql`INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, provider,
      metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    ) VALUES (
      ${observationId},${project.workspaceId},${project.projectId},${snapshotId},'csv','csv.keyword_gap.v1','keyword_cluster',
      'competitor-library',${capturedAt},'available',${{
        keyword: "customer onboarding",
        clusterKey: "customer-onboarding",
        searchVolume: 100,
        currentUrl: null,
        currentRank: null,
        competitorDomain: domain,
        competitorRank: 4,
        marketCode: "US",
        languageCode: "en-US",
      }},'user_provided','C',
      'context','Customer-provided keyword-gap CSV.'
    )`);

  await repository.upsertOrigin(
    { workspaceId: project.workspaceId, projectId: project.projectId },
    {
      originKind: "csv_keyword_gap",
      domain,
      name: null,
      snapshotId,
      observationId,
      importPreviewId,
      sourcePointer: "/valueJson/competitorDomain",
    },
  );
}

describeDb("product-profile competitor projection integration", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    // This file is DB-backed, so it belongs to the `integration` project, whose
    // setup already refuses anything but a disposable loopback database. It
    // used to sit in the `unit` project behind a hardcoded database NAME from
    // one machine, which meant `pnpm test` went red the moment DATABASE_URL was
    // exported, and its assertions ran in no gate at all when it was not.
    requireSafeTestDatabaseUrl(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("accepts typed competitor evidence identities minted by the production profile generator", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const project = await createProject(tx);
      const generated = productionGeneratedProfile(project);

      expect(generated.competitor.candidateId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(generated.provenance.evidenceRefs).not.toHaveLength(0);
      for (const reference of generated.provenance.evidenceRefs) {
        expect(reference.evidenceRefId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );
      }

      const accepted = await tx.execute(sql<{ accepted: boolean }>`
        SELECT app.is_typed_product_profile_evidence_refs(
          ${JSON.stringify(generated.provenance.evidenceRefs)}::jsonb
        ) AS accepted
      `);
      expect(accepted.rows[0]?.accepted).toBe(true);
    });
  });

  it("confirms and projects a production UUIDv8 competitor through the real ICP confirmation service", async () => {
    // The service owns its own database transaction/connection, so this one
    // committed fixture deliberately lives in the disposable integration DB.
    const project = await createProject(handle.db);
    const generated = await createConfirmableProductionDraft(handle.db, project);
    const scope = {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    };

    const confirmed = await confirmProductProfile(
      { workspaceId: project.workspaceId },
      project.projectId,
      project.actorId,
      { baseVersion: generated.draft.version },
    );

    expect(confirmed).toMatchObject({
      status: "complete",
      isCurrent: true,
      isConfirmed: true,
    });
    expect(
      confirmed.profile.fieldProvenance.find(
        (entry) => entry.path === "/competitorCandidates/0",
      )?.evidenceRefs,
    ).toEqual(generated.provenance.evidenceRefs);

    const repository = new CompetitorsRepository(handle.db);
    const page = await repository.listByProject(scope, {
      limit: 10,
      cursor: null,
    });
    expect(page.rows).toHaveLength(1);
    const origins = await repository.listOrigins(
      scope,
      page.rows[0]!.id,
      10,
    );
    expect(origins).toHaveLength(1);
    expect(origins[0]).toMatchObject({
      origin_kind: "product_profile",
      product_profile_id: confirmed.id,
      profile_version: confirmed.version,
      candidate_id: generated.competitor.candidateId,
      evidence_refs: generated.provenance.evidenceRefs,
    });
  });

  it("writes exact product_profile origins and stays idempotent across replay", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const project = await createProject(tx);
      const confirmed = await createConfirmedProfile(tx, project);
      const scope = {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
      };

      await projectConfirmedProductProfileCompetitors(
        tx,
        scope,
        { id: confirmed.id, version: confirmed.version },
        confirmed.profile,
      );
      await projectConfirmedProductProfileCompetitors(
        tx,
        scope,
        { id: confirmed.id, version: confirmed.version },
        confirmed.profile,
      );

      const repository = new CompetitorsRepository(tx);
      const page = await repository.listByProject(scope, { limit: 10, cursor: null });
      expect(page.rows).toHaveLength(2);
      const exact = page.rows.find((row) => row.domain === "one.example");
      const pool = page.rows.find((row) => row.domain === "two.example");
      expect(exact).toMatchObject({
        review_status: "approved",
        relationship: "direct",
        analysis_scope: ["keyword_gap", "positioning"],
        origin_count: 1,
      });
      expect(pool).toMatchObject({
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        origin_count: 1,
      });
      const exactOrigins = await repository.listOrigins(scope, exact!.id, 10);
      expect(exactOrigins).toHaveLength(1);
      expect(exactOrigins[0]).toMatchObject({
        origin_kind: "product_profile",
        product_profile_id: confirmed.id,
        profile_version: confirmed.version,
        candidate_id: "00000000-0000-4000-8000-000000000011",
        field_provenance_path: "/competitorCandidates/0",
      });
      const poolOrigins = await repository.listOrigins(scope, pool!.id, 10);
      expect(poolOrigins).toHaveLength(1);
      expect(poolOrigins[0]).toMatchObject({
        origin_kind: "product_profile",
        product_profile_id: confirmed.id,
        profile_version: confirmed.version,
        candidate_id: "00000000-0000-4000-8000-000000000012",
        field_provenance_path: "/competitorCandidates",
      });
    });
  });

  it("does not auto-promote existing csv-first candidate governance when a confirmed profile arrives later", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const project = await createProject(tx);
      await createCsvCompetitorOrigin(tx, project, "one.example");
      const confirmed = await createConfirmedProfile(tx, project);
      const scope = {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
      };

      await projectConfirmedProductProfileCompetitors(
        tx,
        scope,
        { id: confirmed.id, version: confirmed.version },
        confirmed.profile,
      );

      const repository = new CompetitorsRepository(tx);
      const page = await repository.listByProject(scope, { limit: 10, cursor: null });
      const exact = page.rows.find((row) => row.domain === "one.example");
      expect(exact).toMatchObject({
        review_status: "candidate",
        relationship: null,
        analysis_scope: [],
        origin_count: 2,
      });
      const origins = await repository.listOrigins(scope, exact!.id, 10);
      expect(origins.map((origin) => origin.origin_kind).sort()).toEqual([
        "csv_keyword_gap",
        "product_profile",
      ]);
    });
  });
});
