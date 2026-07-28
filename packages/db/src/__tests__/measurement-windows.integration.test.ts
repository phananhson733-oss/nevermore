import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { MeasurementWindow } from "@sf/contracts";

import { createDbHandle, type DbHandle } from "../client.ts";
import { AsyncRunsRepository } from "../repositories/async-runs.ts";
import { CollectionRunsRepository } from "../repositories/collection-runs.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";
import {
  MeasurementRunAlreadyCompletedError,
  MeasurementWindowsRepository,
  measurementWindowResultHash,
  type AppendMeasurementWindowInput,
  type CreateMeasurementRunTransaction,
} from "../repositories/measurement-windows.ts";
import { runMigrations } from "../migrate.ts";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  dataSnapshots,
  measurementGa4Campaigns,
  measurementUtmIdentities,
  measurementWindows,
  normalizedObservations,
  sitePages,
  sites,
  sourceConnections,
  workspaces,
} from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

const artifactContentHash = "a".repeat(64);
const contentChecksum = "b".repeat(64);
const beforeWindow = {
  startAt: "2026-05-23T12:00:00.000Z",
  endAt: "2026-06-20T12:00:00.000Z",
} as const;
const afterWindow = {
  startAt: "2026-06-20T12:00:00.000Z",
  endAt: "2026-07-18T12:00:00.000Z",
} as const;
const measurementStartAfter = "2026-07-22T12:00:00.000Z";
const baselineObservedAt = "2026-06-20T13:00:00.000Z";
const outcomeObservedAt = "2026-07-18T13:00:00.000Z";
const changeObservedAt = "2026-06-20T12:00:00.000Z";
const recordedAt = "2026-07-22T13:00:00.000Z";
const canonicalUrl =
  "https://measurement-integration.example/customer-onboarding/";

async function cleanupWorkspaceFixture(
  handle: DbHandle,
  workspaceId: string,
): Promise<void> {
  const client = await handle.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");

    const workspaceRelations = await client.query<{
      qualified_name: string;
    }>(
      `
        SELECT format('%I.%I', namespace.nspname, relation.relname)
          AS qualified_name
        FROM pg_catalog.pg_class relation
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = relation.relnamespace
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = relation.oid
        WHERE namespace.nspname = 'app'
          AND relation.relkind IN ('r', 'p')
          AND attribute.attname = 'workspace_id'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
        ORDER BY relation.relname
      `,
    );

    for (const relation of workspaceRelations.rows) {
      await client.query(
        `DELETE FROM ${relation.qualified_name} WHERE workspace_id = $1`,
        [workspaceId],
      );
    }
    await client.query("DELETE FROM app.workspaces WHERE id = $1", [
      workspaceId,
    ]);

    await client.query("SET LOCAL session_replication_role = origin");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const residualWorkspace = await handle.pool.query(
    "SELECT 1 FROM app.workspaces WHERE id = $1",
    [workspaceId],
  );
  if (residualWorkspace.rowCount !== 0) {
    throw new Error("measurement integration fixture cleanup was incomplete");
  }
}

describeDb("measurement window repository and database invariants", () => {
  let handle: DbHandle;
  const ids = {
    workspace: randomUUID(),
    project: randomUUID(),
    site: randomUUID(),
    sitePage: randomUUID(),
    actor: randomUUID(),
    action: randomUUID(),
    artifact: randomUUID(),
    artifactRevision: randomUUID(),
    publicationRun: randomUUID(),
    publicationAttempt: randomUUID(),
    deliveryReceipt: randomUUID(),
    changeReceipt: randomUUID(),
    gscSource: randomUUID(),
    ga4Source: randomUUID(),
    gscBaselineRun: randomUUID(),
    gscOutcomeRun: randomUUID(),
    ga4BaselineRun: randomUUID(),
    ga4OutcomeRun: randomUUID(),
    gscBaselineSnapshot: randomUUID(),
    gscOutcomeSnapshot: randomUUID(),
    ga4BaselineSnapshot: randomUUID(),
    ga4OutcomeSnapshot: randomUUID(),
    gscBaselineObservation: randomUUID(),
    gscOutcomeObservation: randomUUID(),
    ga4BaselineObservation: randomUUID(),
    ga4OutcomeObservation: randomUUID(),
    badMeasurementRun: randomUUID(),
    badMeasurement: randomUUID(),
    measurementRun: randomUUID(),
    measurement: randomUUID(),
    competingMeasurementRun: randomUUID(),
    competingMeasurement: randomUUID(),
    geoSource: randomUUID(),
    geoBaselineSnapshot: randomUUID(),
    geoOutcomeSnapshot: randomUUID(),
    directDefinition: randomUUID(),
    assistedDefinition: randomUUID(),
    utm: randomUUID(),
  } as const;

  function frozenFacts() {
    return {
      workspaceId: ids.workspace,
      projectId: ids.project,
      changeReceiptId: ids.changeReceipt,
      publicationAttemptId: ids.publicationAttempt,
      siteId: ids.site,
      sitePageId: ids.sitePage,
      target: {
        kind: "url" as const,
        targetRef: `site-page://${ids.sitePage}`,
        sitePageId: ids.sitePage,
      },
      actionId: ids.action,
      artifactId: ids.artifact,
      artifactRevisionId: ids.artifactRevision,
      artifactRevision: 1,
      artifactContentHash,
      contentChecksum,
      timelineDeliveryReceiptId: ids.deliveryReceipt,
      url: `${canonicalUrl}?ref=measurement`,
      canonicalUrl,
      beforeWindow,
      afterWindow,
      timezone: "America/New_York",
      interpretation: "observational_non_causal" as const,
      startAfter: measurementStartAfter,
    };
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);

    await handle.db.insert(workspaces).values({
      id: ids.workspace,
      name: `Measurement integration ${randomUUID()}`,
    });
    await handle.db.insert(clientProjects).values({
      id: ids.project,
      workspace_id: ids.workspace,
      client_name: "Measurement client",
      project_name: `Measurement project ${randomUUID()}`,
      default_delivery_locale: "en-US",
      created_by: ids.actor,
    });
    await handle.db.insert(sites).values({
      id: ids.site,
      workspace_id: ids.workspace,
      project_id: ids.project,
      origin: "https://measurement-integration.example",
      host: "measurement-integration.example",
      market_codes: ["US"],
      language_codes: ["en"],
    });
    await handle.db.insert(sitePages).values({
      id: ids.sitePage,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      normalized_url: canonicalUrl,
      normalized_url_hash: normalizedUrlHash(canonicalUrl),
    });
    await handle.db.insert(sourceConnections).values([
      {
        id: ids.gscSource,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        provider: "gsc",
        connection_type: "oauth",
        state: "connected",
        external_ref: "sc-domain:measurement-integration.example",
        scopes: ["webmasters.readonly"],
        limitation: "Integration fixture.",
        connected_at: baselineObservedAt,
        created_by: ids.actor,
      },
      {
        id: ids.ga4Source,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        provider: "ga4",
        connection_type: "oauth",
        state: "connected",
        external_ref: "properties/123456",
        scopes: ["analytics.readonly"],
        limitation: "Integration fixture.",
        connected_at: baselineObservedAt,
        created_by: ids.actor,
      },
    ]);

    const collectionFixtures = [
      {
        id: ids.gscBaselineRun,
        provider: "gsc",
        operation: "search_analytics",
        methodVersion: "gsc.search_analytics.v1",
        sourceId: ids.gscSource,
        snapshotId: ids.gscBaselineSnapshot,
        observationId: ids.gscBaselineObservation,
        observedAt: baselineObservedAt,
        sourceWindow: beforeWindow,
        datasetKey: "gsc.page_query_daily.v1",
        schemaVersion: "gsc.page.v1",
        metricKey: "gsc.page.v1",
      },
      {
        id: ids.gscOutcomeRun,
        provider: "gsc",
        operation: "search_analytics",
        methodVersion: "gsc.search_analytics.v1",
        sourceId: ids.gscSource,
        snapshotId: ids.gscOutcomeSnapshot,
        observationId: ids.gscOutcomeObservation,
        observedAt: outcomeObservedAt,
        sourceWindow: afterWindow,
        datasetKey: "gsc.page_query_daily.v1",
        schemaVersion: "gsc.page.v1",
        metricKey: "gsc.page.v1",
      },
      {
        id: ids.ga4BaselineRun,
        provider: "ga4",
        operation: "organic_landing",
        methodVersion: "ga4.organic_landing.v1",
        sourceId: ids.ga4Source,
        snapshotId: ids.ga4BaselineSnapshot,
        observationId: ids.ga4BaselineObservation,
        observedAt: baselineObservedAt,
        sourceWindow: beforeWindow,
        datasetKey: "ga4.organic_landing_daily.v1",
        schemaVersion: "ga4.landing.v1",
        metricKey: "ga4.landing.v1",
      },
      {
        id: ids.ga4OutcomeRun,
        provider: "ga4",
        operation: "organic_landing",
        methodVersion: "ga4.organic_landing.v1",
        sourceId: ids.ga4Source,
        snapshotId: ids.ga4OutcomeSnapshot,
        observationId: ids.ga4OutcomeObservation,
        observedAt: outcomeObservedAt,
        sourceWindow: afterWindow,
        datasetKey: "ga4.organic_landing_daily.v1",
        schemaVersion: "ga4.landing.v1",
        metricKey: "ga4.landing.v1",
      },
    ] as const;

    await handle.db.insert(asyncRuns).values(
      collectionFixtures.map((fixture) => ({
        id: fixture.id,
        workspace_id: ids.workspace,
        project_id: ids.project,
        kind: "collection",
        status: "running",
        result_type: "collection_run",
        result_id: fixture.id,
        initiated_by: ids.actor,
        started_at: baselineObservedAt,
      })),
    );
    await handle.db.insert(collectionRuns).values(
      collectionFixtures.map((fixture) => ({
        id: fixture.id,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        source_connection_id: fixture.sourceId,
        provider: fixture.provider,
        operation: fixture.operation,
        method_version: fixture.methodVersion,
        parameters_hash: "c".repeat(64),
      })),
    );
    await handle.db.insert(dataSnapshots).values(
      collectionFixtures.map((fixture) => ({
        id: fixture.snapshotId,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        collection_run_id: fixture.id,
        source_connection_id: fixture.sourceId,
        provider: fixture.provider,
        dataset_key: fixture.datasetKey,
        schema_version: fixture.schemaVersion,
        method_version: fixture.methodVersion,
        captured_at: fixture.observedAt,
        source_window: {
          start: fixture.sourceWindow.startAt,
          end: fixture.sourceWindow.endAt,
        },
        availability: "available",
        limitation:
          "Canonical provider evidence for integration verification.",
        row_count: 1,
        checksum: "d".repeat(64),
      })),
    );
    await handle.db.insert(normalizedObservations).values(
      collectionFixtures.map((fixture) => ({
        id: fixture.observationId,
        workspace_id: ids.workspace,
        project_id: ids.project,
        snapshot_id: fixture.snapshotId,
        site_page_id: ids.sitePage,
        provider: fixture.provider,
        metric_key: fixture.metricKey,
        subject_type: "url",
        subject_ref: canonicalUrl,
        observed_at: fixture.observedAt,
        availability: "available",
        value_json: {
          fixture: true,
          provider: fixture.provider,
        },
        origin: "first_party",
        grade: "A",
        support: "context",
        limitation:
          "Canonical provider evidence for integration verification.",
      })),
    );

    const collectionRunsRepository = new CollectionRunsRepository(handle.db);
    for (const fixture of collectionFixtures) {
      await collectionRunsRepository.finalize(fixture.id, {
        rowCount: 1,
        sourceWindow: {
          start: fixture.sourceWindow.startAt,
          end: fixture.sourceWindow.endAt,
        },
        providerUsage: {},
        stopReason: null,
      });
      await handle.pool.query(
        `UPDATE app.async_runs
            SET status = 'completed',
                completed_at = $2
          WHERE id = $1`,
        [fixture.id, fixture.observedAt],
      );
    }

    await handle.db.insert(asyncRuns).values([
      {
        id: ids.publicationRun,
        workspace_id: ids.workspace,
        project_id: ids.project,
        kind: "publication",
        status: "completed",
        result_type: "publication_attempt",
        result_id: ids.publicationAttempt,
        initiated_by: ids.actor,
        started_at: changeObservedAt,
        completed_at: changeObservedAt,
      },
      {
        id: ids.badMeasurementRun,
        workspace_id: ids.workspace,
        project_id: ids.project,
        kind: "measurement",
        status: "completed",
        active_key: `measurement:${ids.changeReceipt}`,
        contract_version: "2026-07-28",
        request_payload: {
          operation: "measurement_window",
          idempotencyKey: "measurement-integration-bad-source",
          requestHash: "4".repeat(64),
          frozenFacts: frozenFacts(),
        },
        result_type: "measurement_window",
        result_id: ids.badMeasurement,
        attempt_count: 1,
        initiated_by: ids.actor,
        started_at: outcomeObservedAt,
        completed_at: recordedAt,
      },
      {
        id: ids.measurementRun,
        workspace_id: ids.workspace,
        project_id: ids.project,
        kind: "measurement",
        status: "running",
        active_key: `measurement:${ids.changeReceipt}`,
        contract_version: "2026-07-28",
        request_payload: {
          operation: "measurement_window",
          idempotencyKey: "measurement-integration-primary",
          requestHash: "5".repeat(64),
          frozenFacts: frozenFacts(),
        },
        result_type: "measurement_window",
        result_id: ids.measurement,
        attempt_count: 1,
        initiated_by: ids.actor,
        started_at: outcomeObservedAt,
      },
    ]);

    const client = await handle.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `
          INSERT INTO app.actions (
            id, workspace_id, project_id, source_finding_id,
            source_diagnostic_run_id, action_key,
            template_id, title, description, content_locale, priority_band,
            roadmap_lane, status, effort, risk, expected_outcome, created_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, 'measurement-fixture', 'Fixture action',
            'Fixture authority row.', 'en-US', 'high', 'now', 'done',
            'small', 'low', 'Fixture only.', $7
          )
        `,
        [
          ids.action,
          ids.workspace,
          ids.project,
          randomUUID(),
          randomUUID(),
          "e".repeat(64),
          ids.actor,
        ],
      );
      await client.query(
        `
          INSERT INTO app.execution_artifacts (
            id, workspace_id, project_id, action_id, artifact_type, status,
            generation_mode, output_locale, current_revision,
            validation_state, content_hash, created_by
          ) VALUES (
            $1, $2, $3, $4, 'content_brief', 'ready', 'template', 'en-US',
            1, 'valid', $5, $6
          )
        `,
        [
          ids.artifact,
          ids.workspace,
          ids.project,
          ids.action,
          artifactContentHash,
          ids.actor,
        ],
      );
      await client.query(
        `
          INSERT INTO app.artifact_revisions (
            id, workspace_id, project_id, artifact_id, revision,
            output_locale, content_format, content_text, content_hash,
            generated_by
          ) VALUES (
            $1, $2, $3, $4, 1, 'en-US', 'markdown', '# Fixture', $5,
            'template'
          )
        `,
        [
          ids.artifactRevision,
          ids.workspace,
          ids.project,
          ids.artifact,
          artifactContentHash,
        ],
      );
      await client.query(
        `
          INSERT INTO app.publication_attempts (
            id, attempt_kind, preview_event_id, preview_event_kind,
            preview_facts_hash, workspace_id, project_id, site_id,
            async_run_id, destination_id, destination_ref,
            destination_revision, provider_kind, target_ref, action_id,
            artifact_id, artifact_revision_id, approved_artifact_revision,
            approved_artifact_content_hash, publication_approval_event_id,
            publication_approval_event_kind, side_effect_class,
            authorization_grant_id, authorization_purpose,
            authorization_snapshot, authorization_snapshot_hash, preview_ref,
            preview_checksum, content_checksum, remote_precondition,
            rollback_plan, idempotency_key, request_hash, requested_by
          ) VALUES (
            $1, 'publish', $2, 'issued', $3, $4, $5, $6, $7, $8,
            $9, 1, 'github', '/customer-onboarding/', $10, $11, $12, 1, $13,
            $14, 'approved', 'external_write', $15, 'publish', '{}'::jsonb,
            $16, 'measurement-integration-preview-reference-0001', $13, $17,
            '{"kind":"must_match"}'::jsonb,
            '{"providerKind":"github"}'::jsonb,
            'measurement-integration-publication', $18, $19
          )
        `,
        [
          ids.publicationAttempt,
          randomUUID(),
          "f".repeat(64),
          ids.workspace,
          ids.project,
          ids.site,
          ids.publicationRun,
          randomUUID(),
          randomUUID(),
          ids.action,
          ids.artifact,
          ids.artifactRevision,
          artifactContentHash,
          randomUUID(),
          randomUUID(),
          "1".repeat(64),
          contentChecksum,
          "2".repeat(64),
          ids.actor,
        ],
      );
      await client.query(
        `
          INSERT INTO app.publication_receipts (
            id, workspace_id, project_id, site_id, publication_attempt_id,
            receipt_kind, provider_kind, provider_request_id, remote_scope_ref,
            remote_object_kind, remote_object_id, remote_revision,
            delivery_url, artifact_content_hash, content_checksum,
            verification_state, remote_facts, evidence_refs, observed_at
          ) VALUES (
            $1, $2, $3, $4, $5, 'delivery_receipt', 'github',
            'measurement-delivery', 'github:repository:measurement',
            'github_pull_request', '42', 'head-sha',
            'https://github.example.test/pull/42', $6, $7,
            'provider_accepted', '{}'::jsonb, '[]'::jsonb, $8
          )
        `,
        [
          ids.deliveryReceipt,
          ids.workspace,
          ids.project,
          ids.site,
          ids.publicationAttempt,
          artifactContentHash,
          contentChecksum,
          "2026-06-20T10:00:00.000Z",
        ],
      );
      await client.query(
        `
          INSERT INTO app.publication_receipts (
            id, workspace_id, project_id, site_id, publication_attempt_id,
            receipt_kind, predecessor_delivery_receipt_id, provider_kind,
            provider_request_id, remote_scope_ref, remote_object_kind,
            remote_object_id, remote_revision, delivery_url,
            live_canonical_url, artifact_content_hash, content_checksum,
            verification_state, remote_facts, evidence_refs, observed_at
          ) VALUES (
            $1, $2, $3, $4, $5, 'change_receipt', $6, 'github',
            'measurement-change', 'github:repository:measurement',
            'github_merge', '42', 'merge-sha',
            'https://github.example.test/pull/42', $7, $8, $9,
            'verified_live', '{}'::jsonb,
            '["evidence://measurement/change"]'::jsonb, $10
          )
        `,
        [
          ids.changeReceipt,
          ids.workspace,
          ids.project,
          ids.site,
          ids.publicationAttempt,
          ids.deliveryReceipt,
          canonicalUrl,
          artifactContentHash,
          contentChecksum,
          changeObservedAt,
        ],
      );
      await client.query(
        "SET LOCAL session_replication_role = origin",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    try {
      if (handle) {
        // This fixture deliberately bypasses authority triggers to isolate the
        // measurement contract. Remove only its random workspace before the
        // shared CI database is handed to the backup/restore recovery drill.
        await cleanupWorkspaceFixture(handle, ids.workspace);
      }
    } finally {
      await handle?.end();
    }
  });

  function window(measurementWindowId: string): MeasurementWindow {
    const noMetric = { baseline: null, outcome: null };
    return {
      measurementWindowId,
      projectId: ids.project,
      siteId: ids.site,
      target: {
        kind: "url",
        targetRef: `site-page://${ids.sitePage}`,
        sitePageId: ids.sitePage,
      },
      actionId: ids.action,
      artifactId: ids.artifact,
      artifactRevisionId: ids.artifactRevision,
      artifactRevision: 1,
      artifactContentHash,
      publicationAttemptId: ids.publicationAttempt,
      verifiedChangeReceipt: {
        id: ids.changeReceipt,
        providerKind: "github",
        providerRequestId: "measurement-change",
        remoteScopeRef: "github:repository:measurement",
        remoteObjectId: "42",
        remoteRevision: "merge-sha",
        deliveryUrl: "https://github.example.test/pull/42",
        artifactContentHash,
        contentChecksum,
        remoteFacts: {},
        observedAt: changeObservedAt,
        receiptKind: "change_receipt",
        predecessorDeliveryReceiptId: ids.deliveryReceipt,
        remoteObjectKind: "github_merge",
        liveCanonicalUrl: canonicalUrl,
        verificationState: "verified_live",
        evidenceRefs: ["evidence://measurement/change"],
        limitation: null,
      },
      timelineDeliveryReceipt: {
        id: ids.deliveryReceipt,
        providerKind: "github",
        providerRequestId: "measurement-delivery",
        remoteScopeRef: "github:repository:measurement",
        remoteObjectId: "42",
        remoteRevision: "head-sha",
        deliveryUrl: "https://github.example.test/pull/42",
        artifactContentHash,
        contentChecksum,
        remoteFacts: {},
        observedAt: "2026-06-20T10:00:00.000Z",
        receiptKind: "delivery_receipt",
        predecessorDeliveryReceiptId: null,
        remoteObjectKind: "github_pull_request",
        liveCanonicalUrl: null,
        verificationState: "provider_accepted",
        evidenceRefs: [],
        limitation: null,
      },
      beforeWindow,
      afterWindow,
      timezone: "America/New_York",
      url: `${canonicalUrl}?ref=measurement`,
      canonicalUrl,
      interpretation: "observational_non_causal",
      state: "unavailable",
      technicalVerificationRef: null,
      limitation: "No provider returned comparable coverage.",
      dimensions: {
        gsc: {
          provider: "gsc",
          state: "unavailable",
          baselineSource: null,
          outcomeSource: null,
          sampleSize: {
            ...noMetric,
            unit: "impressions",
            coverage: "none",
          },
          limitation: "GSC coverage unavailable.",
          metrics: {
            clicks: noMetric,
            impressions: noMetric,
            ctr: noMetric,
            averagePosition: noMetric,
          },
        },
        ga4: {
          provider: "ga4",
          state: "unavailable",
          baselineSource: null,
          outcomeSource: null,
          sampleSize: {
            ...noMetric,
            unit: "sessions",
            coverage: "none",
          },
          limitation: "GA4 coverage unavailable.",
          directConversionDefinition: null,
          assistedConversionDefinition: null,
          metrics: {
            sessions: noMetric,
            engagedSessions: noMetric,
            directConversions: noMetric,
            assistedConversions: noMetric,
          },
          campaigns: [],
        },
        geo: {
          provider: "geo",
          state: "unavailable",
          baselineSource: null,
          outcomeSource: null,
          sampleSize: {
            ...noMetric,
            unit: "tracked_queries",
            coverage: "none",
          },
          limitation: "GEO coverage unavailable.",
          metrics: {
            trackedQueries: noMetric,
            citedQueries: noMetric,
            citations: noMetric,
            citationRate: noMetric,
          },
        },
      },
      recordedAt,
    };
  }

  function input(
    measurementWindowId = ids.measurement,
    asyncRunId = ids.measurementRun,
  ): AppendMeasurementWindowInput {
    return {
      asyncRunId,
      window: window(measurementWindowId),
      observationLineage: {
        gsc: {
          baselineObservationId: null,
          outcomeObservationId: null,
        },
        ga4: {
          baselineObservationId: null,
          outcomeObservationId: null,
        },
        geo: {
          baselineObservationId: null,
          outcomeObservationId: null,
        },
      },
    };
  }

  function badSourceInput(): AppendMeasurementWindowInput {
    const base = input(ids.badMeasurement, ids.badMeasurementRun);
    return {
      ...base,
      window: {
        ...base.window,
        state: "insufficient_data",
        limitation:
          "Only one canonical baseline provider phase is available.",
        dimensions: {
          ...base.window.dimensions,
          gsc: {
            provider: "gsc",
            state: "insufficient_data",
            baselineSource: {
              provider: "gsc",
              sourceRef: ids.gscSource,
              snapshotId: ids.gscBaselineSnapshot,
              coveredWindow: beforeWindow,
              observedAt: "2026-06-20T13:00:01.000Z",
              freshness: "current",
            },
            outcomeSource: null,
            sampleSize: {
              baseline: 100,
              outcome: null,
              unit: "impressions",
              coverage: "partial",
            },
            limitation:
              "Only the canonical baseline GSC phase is available.",
            metrics: {
              clicks: { baseline: 5, outcome: null },
              impressions: { baseline: 100, outcome: null },
              ctr: { baseline: 0.05, outcome: null },
              averagePosition: { baseline: 12, outcome: null },
            },
          },
        },
      },
      observationLineage: {
        ...base.observationLineage,
        gsc: {
          baselineObservationId: ids.gscBaselineObservation,
          outcomeObservationId: null,
        },
      },
    };
  }

  async function waitForBlockedAsyncRunInsert(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await handle.pool.query<{ waiting: boolean }>(
        `
          SELECT true AS waiting
            FROM pg_stat_activity
           WHERE datname = current_database()
             AND pid <> pg_backend_pid()
             AND wait_event_type = 'Lock'
             AND lower(query) LIKE '%insert into "app"."async_runs"%'
           LIMIT 1
        `,
      );
      if (result.rows[0]?.waiting === true) return;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    throw new Error(
      "Timed out waiting for the competing Measurement insert lock.",
    );
  }

  it("fails closed when caller-authored source time differs from the canonical Observation", async () => {
    const repo = new MeasurementWindowsRepository(handle.db);
    await expect(
      repo.appendFinal(
        { workspaceId: ids.workspace, projectId: ids.project },
        badSourceInput(),
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("serializes finalization against a new idempotency key without enqueueing a dead run", async () => {
    const scope = {
      workspaceId: ids.workspace,
      projectId: ids.project,
    };
    const expected = input();
    const attempt = {
      runId: ids.measurementRun,
      workspaceId: ids.workspace,
      projectId: ids.project,
      attemptCount: 1,
    } as const;
    let markFinalWriteReady!: () => void;
    const finalWriteReady = new Promise<void>((resolve) => {
      markFinalWriteReady = resolve;
    });
    let releaseFinalCommit!: () => void;
    const holdFinalCommit = new Promise<void>((resolve) => {
      releaseFinalCommit = resolve;
    });
    const finalization = handle.db.transaction(async (tx) => {
      const runs = new AsyncRunsRepository(tx);
      await expect(
        runs.lockAttemptForUpdate(attempt),
      ).resolves.toMatchObject({
        id: ids.measurementRun,
        status: "running",
        attempt_count: 1,
      });
      await expect(
        new MeasurementWindowsRepository(tx).appendFinalInTx(
          scope,
          expected,
        ),
      ).resolves.toEqual({
        window: expected.window,
        replayed: false,
      });
      await expect(
        runs.setTerminal(attempt, {
          status: "completed",
          resultType: "measurement_window",
          resultId: ids.measurement,
        }),
      ).resolves.toBe(true);
      markFinalWriteReady();
      await holdFinalCommit;
    });
    await Promise.race([
      finalWriteReady,
      finalization.then(
        () => {
          throw new Error(
            "Finalization committed before the concurrency barrier.",
          );
        },
        (error: unknown) => {
          throw error;
        },
      ),
    ]);

    const generatedIds = [
      ids.competingMeasurement,
      ids.competingMeasurementRun,
    ];
    const enqueue = vi.fn(async () => ids.competingMeasurementRun);
    let markFactsResolved!: () => void;
    const factsResolved = new Promise<void>((resolve) => {
      markFactsResolved = resolve;
    });
    const competingCommand: CreateMeasurementRunTransaction = {
      workspaceId: ids.workspace,
      projectId: ids.project,
      changeReceiptId: ids.changeReceipt,
      idempotencyKey: "measurement-integration-racing-key",
      requestHash: "6".repeat(64),
      requestedBy: ids.actor,
      contractVersion: "2026-07-28",
      resolveCurrentFacts: vi.fn(async () => {
        markFactsResolved();
        return frozenFacts();
      }),
    };
    const competing = new MeasurementWindowsRepository(handle.db, {
      enqueue,
      newId: () => generatedIds.shift()!,
    })
      .createRunAtomically(competingCommand)
      .then(
        (value) => ({ kind: "resolved" as const, value }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
    await Promise.race([
      factsResolved,
      competing.then((result) => {
        throw result.kind === "rejected"
          ? result.error
          : new Error(
              "Competing Measurement run resolved before the lock barrier.",
            );
      }),
    ]);
    try {
      await waitForBlockedAsyncRunInsert();
    } finally {
      releaseFinalCommit();
    }
    await finalization;
    const competingResult = await competing;

    expect(competingResult.kind).toBe("rejected");
    if (competingResult.kind === "rejected") {
      expect(competingResult.error).toBeInstanceOf(
        MeasurementRunAlreadyCompletedError,
      );
      expect(competingResult.error).toMatchObject({
        code: "MEASUREMENT_RUN_ALREADY_COMPLETED",
        existingRunId: ids.measurementRun,
        measurementWindowId: ids.measurement,
      });
    }
    expect(enqueue).not.toHaveBeenCalled();
    await expect(
      new AsyncRunsRepository(handle.db).findMeasurementByIdempotency(
        scope,
        competingCommand.idempotencyKey,
      ),
    ).resolves.toBeNull();

    const repo = new MeasurementWindowsRepository(handle.db);
    await expect(repo.appendFinal(scope, expected)).resolves.toEqual({
      window: expected.window,
      replayed: true,
    });
    await expect(repo.findById(scope, ids.measurement)).resolves.toEqual(
      expected.window,
    );
    await expect(repo.listRecent(scope, { limit: 1 })).resolves.toEqual([
      expected.window,
    ]);
    await expect(
      repo.findById(
        { workspaceId: randomUUID(), projectId: randomUUID() },
        ids.measurement,
      ),
    ).resolves.toBeNull();
    await expect(
      repo.listRecent(
        { workspaceId: randomUUID(), projectId: randomUUID() },
        { limit: 100 },
      ),
    ).resolves.toEqual([]);

    const [persisted] = await handle.db
      .select({
        resultHash: measurementWindows.result_hash,
      })
      .from(measurementWindows)
      .where(eq(measurementWindows.id, ids.measurement));
    expect(persisted?.resultHash).toBe(
      measurementWindowResultHash(expected),
    );
  });

  it("rejects Campaign metrics on a GA4 dimension with no coverage and blocks mutation", async () => {
    await handle.db.insert(measurementUtmIdentities).values({
      id: ids.utm,
      workspace_id: ids.workspace,
      project_id: ids.project,
      source: "linkedin",
      medium: "paid-social",
      campaign: "customer-onboarding",
      content: "carousel",
      identity_hash: "3".repeat(64),
    });
    await expect(
      handle.db.insert(measurementGa4Campaigns).values({
        measurement_window_id: ids.measurement,
        utm_identity_id: ids.utm,
        workspace_id: ids.workspace,
        project_id: ids.project,
        sessions_baseline: 0,
        sessions_outcome: 0,
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      handle.db
        .update(measurementWindows)
        .set({ limitation: "Attempted mutation." })
        .where(eq(measurementWindows.id, ids.measurement)),
    ).rejects.toMatchObject({ cause: { code: "55000" } });
  });
});
