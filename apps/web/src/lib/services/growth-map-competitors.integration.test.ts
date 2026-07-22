import { randomBytes, randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import {
  CompetitorsRepository,
  contentHash,
  createDbHandle,
  type DbHandle,
  type DbTx,
} from "@sf/db";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  dataSnapshots,
  icpProfiles,
  importPreviews,
  normalizedObservations,
  sites,
  sourceConnections,
  workspaces,
} from "@sf/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getProjectAuditCompetitor,
  listProjectAuditCompetitors,
} from "./growth-map-competitors.ts";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const OBSERVED_AT = "2026-07-22T09:00:00.000Z";

interface ProjectFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly actorId: string;
  readonly host: string;
}

interface CompetitorFixture {
  readonly competitorId: string;
  readonly profileOriginId: string;
  readonly csvOriginId: string;
  readonly manualOriginId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly candidateId: string;
  readonly evidenceRefId: string;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly importPreviewId: string;
  readonly privateProfilePayload: string;
  readonly privateRawObjectKey: string;
  readonly privateObservationPayload: string;
}

interface ProfileOriginFixture {
  readonly profileOriginId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly candidateId: string;
  readonly evidenceRefId: string;
}

async function inRolledBackFixture(
  handle: DbHandle,
  test: (tx: DbTx) => Promise<void>,
): Promise<void> {
  const rollback = new Error(`rollback-competitor-fixture-${randomUUID()}`);
  try {
    await handle.db.transaction(async (tx) => {
      await test(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function seedProject(
  tx: DbTx,
  workspaceId: string,
  label: string,
): Promise<ProjectFixture> {
  const projectId = randomUUID();
  const siteId = randomUUID();
  const actorId = randomUUID();
  const host = `${label.toLowerCase()}-${projectId}.example.com`;
  await tx.insert(clientProjects).values({
    id: projectId,
    workspace_id: workspaceId,
    client_name: `${label} client`,
    project_name: `${label} project`,
    default_delivery_locale: "zh-CN",
    created_by: actorId,
  });
  await tx.insert(sites).values({
    id: siteId,
    workspace_id: workspaceId,
    project_id: projectId,
    origin: `https://${host}`,
    host,
    market_codes: ["US"],
    language_codes: ["en-US"],
    is_primary: true,
  });
  return { workspaceId, projectId, siteId, actorId, host };
}

async function seedCanonicalCompetitor(
  tx: DbTx,
  project: ProjectFixture,
): Promise<CompetitorFixture> {
  const domain = "canonical-competitor.example";
  const name = "Canonical Competitor";
  const profileId = randomUUID();
  const profileVersion = 1;
  const candidateId = randomUUID();
  const evidenceRefId = randomUUID();
  const privateProfilePayload = `private-profile-${randomUUID()}`;
  const evidenceRefs = [
    { evidenceRefId, kind: "userEdit" as const },
  ];
  const profile = {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: project.siteId,
    sourcePageUrl: `https://${project.host}/`,
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    competitorCandidates: [
      {
        candidateId,
        name,
        domain,
        relationship: "direct",
        analysisScope: ["keyword_gap", "positioning"],
        similarity: null,
        reason: "Customer-confirmed direct competitor.",
        reviewStatus: "approved",
        confidence: "high",
      },
    ],
    fieldProvenance: [
      {
        path: "/competitorCandidates/0",
        derivation: "declared",
        confidence: "high",
        evidenceRefs,
        limitation: "Confirmed by the customer.",
        observedAt: null,
      },
    ],
    privateProfilePayload,
  };
  await tx.insert(icpProfiles).values({
    id: profileId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    version: profileVersion,
    status: "complete",
    profile,
    content_hash: contentHash(profile),
    created_by: project.actorId,
  });
  await tx
    .update(clientProjects)
    .set({
      current_icp_profile_id: profileId,
      confirmed_icp_profile_id: profileId,
    })
    .where(eq(clientProjects.id, project.projectId));

  const repository = new CompetitorsRepository(tx);
  const scope = {
    workspaceId: project.workspaceId,
    projectId: project.projectId,
  };
  const importPreviewId = randomUUID();
  const sourceConnectionId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const observationId = randomUUID();
  const privateRawObjectKey = `private/csv/${randomUUID()}.csv`;
  const privateObservationPayload = `private-observation-${randomUUID()}`;
  await tx.insert(importPreviews).values({
    id: importPreviewId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    created_by: project.actorId,
    token_hash: randomBytes(32),
    template_id: "keyword_gap_v1",
    raw_object_key: privateRawObjectKey,
    file_checksum: contentHash({ importPreviewId }),
    row_count: 1,
    detected_columns: [],
    suggested_mapping: {},
    preview_rows: [],
    validation_errors: [],
    validation_warnings: [],
    status: "consumed",
    expires_at: "2026-07-23T09:00:00.000Z",
    consumed_at: OBSERVED_AT,
  });
  await tx.insert(sourceConnections).values({
    id: sourceConnectionId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    provider: "csv",
    connection_type: "file_import",
    state: "available",
    external_ref: importPreviewId,
    limitation: "Customer-provided keyword-gap CSV.",
    connected_at: OBSERVED_AT,
    created_by: project.actorId,
  });
  await tx.insert(asyncRuns).values({
    id: collectionRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    kind: "collection",
    status: "running",
    initiated_by: project.actorId,
    started_at: OBSERVED_AT,
  });
  await tx.insert(collectionRuns).values({
    id: collectionRunId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    source_connection_id: sourceConnectionId,
    import_preview_id: importPreviewId,
    provider: "csv",
    operation: "keyword_gap_import",
    method_version: "csv.keyword_gap.v1",
    parameters_hash: contentHash({ collectionRunId, importPreviewId }),
  });
  await tx.insert(dataSnapshots).values({
    id: snapshotId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    site_id: project.siteId,
    collection_run_id: collectionRunId,
    source_connection_id: sourceConnectionId,
    provider: "csv",
    dataset_key: "csv.keyword_gap.v1",
    schema_version: "0.3.0",
    method_version: "csv.keyword_gap.v1",
    captured_at: OBSERVED_AT,
    source_window: { start: null, end: null },
    availability: "available",
    limitation: "Customer-provided keyword-gap CSV.",
    raw_object_key: privateRawObjectKey,
    row_count: 1,
    checksum: contentHash({ snapshotId, observationId }),
    summary: { privateImportPayload: privateRawObjectKey },
  });
  await tx.insert(normalizedObservations).values({
    id: observationId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    snapshot_id: snapshotId,
    site_page_id: null,
    provider: "csv",
    metric_key: "csv.keyword_gap.v1",
    subject_type: "keyword_cluster",
    subject_ref: "customer-onboarding",
    observed_at: OBSERVED_AT,
    availability: "available",
    value_json: {
      keyword: "customer onboarding",
      clusterKey: "customer-onboarding",
      searchVolume: 100,
      currentUrl: null,
      currentRank: null,
      competitorDomain: domain,
      competitorRank: 4,
      marketCode: "US",
      languageCode: "en-US",
      privateProviderPayload: privateObservationPayload,
    },
    origin: "user_provided",
    method: "observed",
    grade: "C",
    support: "supports",
    limitation: "Customer-provided keyword-gap CSV.",
  });
  const csv = await repository.upsertOrigin(scope, {
    originKind: "csv_keyword_gap",
    domain,
    name: null,
    snapshotId,
    observationId,
    importPreviewId,
    sourcePointer: "/valueJson/competitorDomain",
  });
  const productProfile = await repository.upsertOrigin(scope, {
    originKind: "product_profile",
    domain,
    name,
    productProfileId: profileId,
    profileVersion,
    candidateId,
    fieldProvenancePath: "/competitorCandidates/0",
    evidenceRefs,
    sourceReviewStatus: "approved",
    sourceRelationship: "direct",
    sourceAnalysisScope: ["keyword_gap", "positioning"],
  });
  const manualOriginId = randomUUID();
  const manual = await repository.upsertOrigin(scope, {
    originKind: "manual",
    domain,
    name,
    manualEntryId: manualOriginId,
  });
  expect(csv.competitorId).toBe(productProfile.competitorId);
  expect(manual.competitorId).toBe(productProfile.competitorId);

  return {
    competitorId: productProfile.competitorId,
    profileOriginId: productProfile.occurrenceId,
    csvOriginId: csv.occurrenceId,
    manualOriginId: manual.occurrenceId,
    profileId,
    profileVersion,
    candidateId,
    evidenceRefId,
    snapshotId,
    observationId,
    importPreviewId,
    privateProfilePayload,
    privateRawObjectKey,
    privateObservationPayload,
  };
}

async function confirmNextProfileOrigin(
  tx: DbTx,
  project: ProjectFixture,
  competitor: CompetitorFixture,
): Promise<ProfileOriginFixture> {
  const profileId = randomUUID();
  const profileVersion = competitor.profileVersion + 1;
  const candidateId = randomUUID();
  const evidenceRefId = randomUUID();
  const evidenceRefs = [
    { evidenceRefId, kind: "userEdit" as const },
  ];
  const profile = {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: project.siteId,
    sourcePageUrl: `https://${project.host}/`,
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    competitorCandidates: [
      {
        candidateId,
        name: "Canonical Competitor",
        domain: "canonical-competitor.example",
        relationship: "direct",
        analysisScope: ["keyword_gap", "positioning"],
        similarity: null,
        reason: "Customer-confirmed direct competitor in V2.",
        reviewStatus: "approved",
        confidence: "high",
      },
    ],
    fieldProvenance: [
      {
        path: "/competitorCandidates/0",
        derivation: "declared",
        confidence: "high",
        evidenceRefs,
        limitation: "Confirmed by the customer in V2.",
        observedAt: null,
      },
    ],
  };
  await tx.insert(icpProfiles).values({
    id: profileId,
    workspace_id: project.workspaceId,
    project_id: project.projectId,
    version: profileVersion,
    status: "complete",
    profile,
    content_hash: contentHash(profile),
    created_by: project.actorId,
  });
  await tx
    .update(clientProjects)
    .set({
      current_icp_profile_id: profileId,
      confirmed_icp_profile_id: profileId,
    })
    .where(eq(clientProjects.id, project.projectId));

  const origin = await new CompetitorsRepository(tx).upsertOrigin(
    {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
    },
    {
      originKind: "product_profile",
      domain: "canonical-competitor.example",
      name: "Canonical Competitor",
      productProfileId: profileId,
      profileVersion,
      candidateId,
      fieldProvenancePath: "/competitorCandidates/0",
      evidenceRefs,
      sourceReviewStatus: "approved",
      sourceRelationship: "direct",
      sourceAnalysisScope: ["keyword_gap", "positioning"],
    },
  );
  expect(origin.competitorId).toBe(competitor.competitorId);
  return {
    profileOriginId: origin.occurrenceId,
    profileId,
    profileVersion,
    candidateId,
    evidenceRefId,
  };
}

describeDb("Growth Map Competitor Library real Postgres projection", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("projects exact canonical origins with project isolation and no private raw leakage", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: `Competitor read integration ${workspaceId}`,
      });
      const localProject = await seedProject(tx, workspaceId, "Local");
      const foreignProject = await seedProject(tx, workspaceId, "Foreign");
      const local = await seedCanonicalCompetitor(tx, localProject);
      const foreignManualId = randomUUID();
      const foreign = await new CompetitorsRepository(tx).upsertOrigin(
        {
          workspaceId,
          projectId: foreignProject.projectId,
        },
        {
          originKind: "manual",
          domain: "foreign-only-competitor.example",
          name: "Foreign Competitor",
          manualEntryId: foreignManualId,
        },
      );
      const scope = { workspaceId };

      const list = await listProjectAuditCompetitors(
        scope,
        localProject.projectId,
        { limit: 50, cursor: null },
        tx,
      );
      expect(list.projectId).toBe(localProject.projectId);
      expect(list.data).toHaveLength(1);
      const item = list.data[0]!;
      expect(item).toMatchObject({
        projectId: localProject.projectId,
        competitorId: local.competitorId,
        domain: "canonical-competitor.example",
        name: null,
        reviewStatus: "candidate",
        relationship: null,
        analysisScope: [],
        revision: 0,
        lastObservedAt: OBSERVED_AT,
        serpOverlap: {
          availability: "unavailable",
          value: null,
          limitation: expect.stringMatching(/canonical.*writer/i),
        },
        aiCitationInsight: {
          availability: "unavailable",
          value: null,
          limitation: expect.stringMatching(/canonical.*writer/i),
        },
        coverage: {
          availability: "partial",
          limitations: expect.arrayContaining([
            expect.stringMatching(
              /Product Profile source is approved.*still awaiting.*review/i,
            ),
          ]),
        },
      });
      expect(item.originOccurrences).toEqual(
        expect.arrayContaining([
          {
            occurrenceId: local.profileOriginId,
            originKind: "product_profile",
            productProfileId: local.profileId,
            profileVersion: local.profileVersion,
            candidateId: local.candidateId,
            fieldProvenancePath: "/competitorCandidates/0",
            evidenceRefs: [
              { evidenceRefId: local.evidenceRefId, kind: "userEdit" },
            ],
            observedAt: null,
          },
          {
            occurrenceId: local.csvOriginId,
            originKind: "csv_keyword_gap",
            snapshotId: local.snapshotId,
            observationId: local.observationId,
            sourcePointer: "/valueJson/competitorDomain",
            importPreviewId: local.importPreviewId,
            evidenceRefs: [],
            observedAt: OBSERVED_AT,
          },
          {
            occurrenceId: local.manualOriginId,
            originKind: "manual",
            manualEntryId: local.manualOriginId,
            evidenceRefs: [],
            observedAt: null,
          },
        ]),
      );

      const detail = await getProjectAuditCompetitor(
        scope,
        localProject.projectId,
        local.competitorId,
        tx,
      );
      expect(detail).toEqual({ projectId: localProject.projectId, data: item });

      const serialized = JSON.stringify({ list, detail });
      expect(serialized).not.toContain(foreign.competitorId);
      expect(serialized).not.toContain("foreign-only-competitor.example");
      expect(serialized).not.toContain(local.privateProfilePayload);
      expect(serialized).not.toContain(local.privateRawObjectKey);
      expect(serialized).not.toContain(local.privateObservationPayload);
      expect(serialized).not.toContain("privateProfilePayload");
      expect(serialized).not.toContain("privateProviderPayload");

      await expect(
        getProjectAuditCompetitor(
          scope,
          localProject.projectId,
          foreign.competitorId,
          tx,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });
  });

  it("preserves mixed CSV and Product Profile V1 history after V2 becomes confirmed", async () => {
    await inRolledBackFixture(handle, async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(workspaces).values({
        id: workspaceId,
        name: `Historical competitor origin ${workspaceId}`,
      });
      const project = await seedProject(tx, workspaceId, "Historical");
      const v1 = await seedCanonicalCompetitor(tx, project);
      const v2 = await confirmNextProfileOrigin(tx, project, v1);

      const list = await listProjectAuditCompetitors(
        { workspaceId },
        project.projectId,
        { limit: 50, cursor: null },
        tx,
      );

      expect(list.data).toHaveLength(1);
      expect(list.data[0]?.originOccurrences).toHaveLength(4);
      expect(list.data[0]?.originOccurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            occurrenceId: v1.csvOriginId,
            originKind: "csv_keyword_gap",
          }),
          {
            occurrenceId: v1.profileOriginId,
            originKind: "product_profile",
            productProfileId: v1.profileId,
            profileVersion: v1.profileVersion,
            candidateId: v1.candidateId,
            fieldProvenancePath: "/competitorCandidates/0",
            evidenceRefs: [
              { evidenceRefId: v1.evidenceRefId, kind: "userEdit" },
            ],
            observedAt: null,
          },
          {
            occurrenceId: v2.profileOriginId,
            originKind: "product_profile",
            productProfileId: v2.profileId,
            profileVersion: v2.profileVersion,
            candidateId: v2.candidateId,
            fieldProvenancePath: "/competitorCandidates/0",
            evidenceRefs: [
              { evidenceRefId: v2.evidenceRefId, kind: "userEdit" },
            ],
            observedAt: null,
          },
        ]),
      );
    });
  });
});
