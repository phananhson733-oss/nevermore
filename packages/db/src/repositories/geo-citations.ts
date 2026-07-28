import { randomUUID } from "node:crypto";
import {
  GeoCitationCollectionBatch as GeoCitationCollectionBatchSchema,
  GeoCitationEvidenceResponse as GeoCitationEvidenceResponseSchema,
  Uuid,
  type GeoCitationCollectionBatch,
  type GeoCitationEvidenceResponse,
} from "@sf/contracts";
import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { DbTx } from "../client.ts";
import {
  contentHash,
  type CanonicalValue,
} from "../hash.ts";
import { canonicalUtcTimestamptz } from "../instant.ts";
import {
  collectionRuns,
  dataSnapshots,
  geoCitationOccurrences,
  geoQueryObservations,
  measurementGeoDimensions,
  measurementWindows,
  normalizedObservations,
  sitePages,
  sites,
} from "../schema.ts";
import {
  AsyncRunsRepository,
  type RunAttempt,
} from "./async-runs.ts";
import {
  projectPredicate,
  Repository,
  type Executor,
  type ProjectScope,
} from "./base.ts";
import { CollectionRunsRepository } from "./collection-runs.ts";
import { SourceConnectionsRepository } from "./source-connections.ts";

const GEO_DATASET_KEY = "geo.answer_citations.v1";
const GEO_METRIC_KEY = "geo.page_citations.v1";
const GEO_SCHEMA_VERSION = "1";

interface TransactionalExecutor {
  transaction<T>(run: (tx: DbTx) => Promise<T>): Promise<T>;
}

export interface GeoCitationAuthorityClock {
  readonly newId: () => string;
}

const SYSTEM_CLOCK: GeoCitationAuthorityClock = {
  newId: randomUUID,
};

export interface AppendGeoCitationBatchInput {
  readonly attempt: RunAttempt;
  readonly batch: GeoCitationCollectionBatch;
}

export interface AppendGeoCitationBatchResult {
  readonly snapshotId: string;
  readonly normalizedObservationIds: readonly string[];
  readonly replayed: boolean;
}

export type GeoCitationAuthorityErrorCode =
  | "GEO_SCOPE_INVALID"
  | "GEO_RUN_AUTHORITY_INVALID"
  | "GEO_SOURCE_AUTHORITY_INVALID"
  | "GEO_PAGE_SCOPE_INVALID"
  | "GEO_REPLAY_CONFLICT"
  | "GEO_TRANSACTION_REQUIRED"
  | "GEO_SERVER_ID_INVALID"
  | "GEO_TERMINALIZATION_FAILED"
  | "GEO_EVIDENCE_INTEGRITY_INVALID";

export class GeoCitationAuthorityError extends Error {
  override readonly name = "GeoCitationAuthorityError";

  constructor(readonly code: GeoCitationAuthorityErrorCode) {
    super(
      {
        GEO_SCOPE_INVALID:
          "GEO citation batch does not match its project scope",
        GEO_RUN_AUTHORITY_INVALID:
          "GEO citation batch does not match its claimed Collection Run",
        GEO_SOURCE_AUTHORITY_INVALID:
          "GEO citation batch does not match an active canonical GEO source",
        GEO_PAGE_SCOPE_INVALID:
          "GEO citation evidence does not match exact canonical SitePage identities",
        GEO_REPLAY_CONFLICT:
          "The Collection Run already owns different immutable GEO evidence",
        GEO_TRANSACTION_REQUIRED:
          "GEO citation authority requires one atomic database transaction",
        GEO_SERVER_ID_INVALID:
          "GEO citation authority generated an invalid server identity",
        GEO_TERMINALIZATION_FAILED:
          "GEO citation Collection Run ownership changed during finalization",
        GEO_EVIDENCE_INTEGRITY_INVALID:
          "Persisted GEO citation evidence failed its immutable projection",
      }[code],
    );
  }
}

interface CanonicalBatch {
  readonly parsed: GeoCitationCollectionBatch;
  readonly checksum: string;
}

function canonicalBatch(
  input: GeoCitationCollectionBatch,
): CanonicalBatch {
  const parsed = GeoCitationCollectionBatchSchema.parse(input);
  const value = {
    ...parsed,
    capturedAt: canonicalUtcTimestamptz(parsed.capturedAt),
    coveredWindow: {
      startAt: canonicalUtcTimestamptz(
        parsed.coveredWindow.startAt,
      ),
      endAt: canonicalUtcTimestamptz(
        parsed.coveredWindow.endAt,
      ),
    },
    queries: parsed.queries.map((query) => ({
      ...query,
      collectedAt: canonicalUtcTimestamptz(query.collectedAt),
    })),
  };
  const canonical = GeoCitationCollectionBatchSchema.parse(value);
  return {
    parsed: canonical,
    checksum: contentHash(
      canonical as unknown as CanonicalValue,
    ),
  };
}

function nextId(clock: GeoCitationAuthorityClock): string {
  const id = clock.newId();
  if (!Uuid.safeParse(id).success) {
    throw new GeoCitationAuthorityError(
      "GEO_SERVER_ID_INVALID",
    );
  }
  return id;
}

function platformKey(
  value: GeoCitationCollectionBatch["queries"][number]["platform"],
): string {
  return value.kind === "known" ? value.key : value.providerKey;
}

function querySetHash(
  queries: readonly GeoCitationCollectionBatch["queries"][number][],
): string {
  const cohort = queries
    .map((query) => ({
      query: query.query,
      platformKind: query.platform.kind,
      platformKey: platformKey(query.platform),
      model: query.model,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  return contentHash(cohort as unknown as CanonicalValue);
}

function trustFor(
  kind: GeoCitationCollectionBatch["queries"][number]["collector"]["kind"],
): {
  readonly origin: "vendor_observation" | "user_provided";
  readonly grade: "B" | "C";
} {
  return kind === "manual_verified"
    ? { origin: "user_provided", grade: "C" }
    : { origin: "vendor_observation", grade: "B" };
}

export class GeoCitationAuthorityRepository extends Repository {
  constructor(
    exec: Executor,
    private readonly clock: GeoCitationAuthorityClock = SYSTEM_CLOCK,
  ) {
    super(exec);
  }

  async appendBatch(
    scope: ProjectScope,
    input: AppendGeoCitationBatchInput,
  ): Promise<AppendGeoCitationBatchResult> {
    const transactional = this.exec as Executor &
      Partial<TransactionalExecutor>;
    if (typeof transactional.transaction !== "function") {
      throw new GeoCitationAuthorityError(
        "GEO_TRANSACTION_REQUIRED",
      );
    }
    return transactional.transaction((tx) =>
      new GeoCitationAuthorityRepository(
        tx,
        this.clock,
      ).appendBatchInTx(scope, input),
    );
  }

  async appendBatchInTx(
    scope: ProjectScope,
    input: AppendGeoCitationBatchInput,
  ): Promise<AppendGeoCitationBatchResult> {
    const batch = canonicalBatch(input.batch);
    if (
      batch.parsed.projectId !== scope.projectId ||
      input.attempt.workspaceId !== scope.workspaceId ||
      input.attempt.projectId !== scope.projectId ||
      input.attempt.runId !== batch.parsed.collectionRunId
    ) {
      throw new GeoCitationAuthorityError("GEO_SCOPE_INVALID");
    }

    const existing = await this.findSnapshotByRun(
      scope,
      batch.parsed.collectionRunId,
    );
    if (existing) {
      if (existing.checksum !== batch.checksum) {
        throw new GeoCitationAuthorityError(
          "GEO_REPLAY_CONFLICT",
        );
      }
      return {
        snapshotId: existing.id,
        normalizedObservationIds:
          await this.listNormalizedObservationIds(
            scope,
            existing.id,
          ),
        replayed: true,
      };
    }

    const runs = new AsyncRunsRepository(this.exec);
    const claimed = await runs.lockAttemptForUpdate(input.attempt);
    if (
      !claimed ||
      claimed.kind !== "collection" ||
      claimed.result_type !== "collection_run" ||
      claimed.result_id !== batch.parsed.collectionRunId
    ) {
      throw new GeoCitationAuthorityError(
        "GEO_RUN_AUTHORITY_INVALID",
      );
    }

    const [collection] = await this.exec
      .select()
      .from(collectionRuns)
      .where(
        and(
          projectPredicate(collectionRuns, scope),
          eq(
            collectionRuns.id,
            batch.parsed.collectionRunId,
          ),
          eq(collectionRuns.site_id, batch.parsed.siteId),
          eq(
            collectionRuns.source_connection_id,
            batch.parsed.sourceConnectionId,
          ),
          eq(collectionRuns.provider, "geo"),
          eq(
            collectionRuns.operation,
            "ai_citation_monitor",
          ),
          sql`${collectionRuns.row_count} is null`,
        ),
      )
      .limit(1);
    if (!collection) {
      throw new GeoCitationAuthorityError(
        "GEO_RUN_AUTHORITY_INVALID",
      );
    }

    const source =
      await new SourceConnectionsRepository(
        this.exec,
      ).findActiveByIdForUpdate(
        scope,
        batch.parsed.sourceConnectionId,
      );
    if (
      !source ||
      source.site_id !== batch.parsed.siteId ||
      source.provider !== "geo" ||
      source.state === "disconnected"
    ) {
      throw new GeoCitationAuthorityError(
        "GEO_SOURCE_AUTHORITY_INVALID",
      );
    }

    const [site] = await this.exec
      .select()
      .from(sites)
      .where(
        and(
          projectPredicate(sites, scope),
          eq(sites.id, batch.parsed.siteId),
          sql`${batch.parsed.marketCode} = any(${sites.market_codes})`,
          sql`${batch.parsed.languageTag} = any(${sites.language_codes})`,
        ),
      )
      .limit(1);
    if (!site) {
      throw new GeoCitationAuthorityError(
        "GEO_PAGE_SCOPE_INVALID",
      );
    }

    const pageIds = [
      ...new Set(
        batch.parsed.queries.map((query) => query.sitePageId),
      ),
    ];
    const pages = await this.exec
      .select({
        id: sitePages.id,
        normalizedUrl: sitePages.normalized_url,
      })
      .from(sitePages)
      .where(
        and(
          projectPredicate(sitePages, scope),
          eq(sitePages.site_id, batch.parsed.siteId),
          inArray(sitePages.id, pageIds),
        ),
      )
      .orderBy(asc(sitePages.id));
    const exactPages = new Map(
      pages.map((page) => [page.id, page.normalizedUrl]),
    );
    if (
      exactPages.size !== pageIds.length ||
      batch.parsed.queries.some(
        (query) =>
          exactPages.get(query.sitePageId) !== query.canonicalUrl ||
          query.citations.some(
            (citation) =>
              citation.citationUrl !== query.canonicalUrl ||
              new URL(citation.citationUrl).origin !== site.origin,
          ),
      )
    ) {
      throw new GeoCitationAuthorityError(
        "GEO_PAGE_SCOPE_INVALID",
      );
    }

    const snapshotId = nextId(this.clock);
    const collector = batch.parsed.queries[0]!.collector;
    const unavailableCount = batch.parsed.queries.filter(
      (query) => query.citationState === "unavailable",
    ).length;
    const snapshotAvailability =
      unavailableCount === 0 ? "available" : "partial";
    const citationCount = batch.parsed.queries.reduce(
      (count, query) => count + query.citations.length,
      0,
    );

    await this.exec.insert(dataSnapshots).values({
      id: snapshotId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      site_id: batch.parsed.siteId,
      collection_run_id: batch.parsed.collectionRunId,
      source_connection_id: batch.parsed.sourceConnectionId,
      provider: "geo",
      dataset_key: GEO_DATASET_KEY,
      schema_version: GEO_SCHEMA_VERSION,
      method_version: collection.method_version,
      captured_at: batch.parsed.capturedAt,
      source_window: batch.parsed.coveredWindow,
      availability: snapshotAvailability,
      limitation: batch.parsed.limitation,
      raw_object_key: null,
      row_count: batch.parsed.queries.length,
      checksum: batch.checksum,
      summary: {
        authority: "geo_citation_authority",
        marketCode: batch.parsed.marketCode,
        languageTag: batch.parsed.languageTag,
        collectorKind: collector.kind,
        collectorProviderKey: collector.providerKey,
        collectorVersion: collector.version,
        queryCount: batch.parsed.queries.length,
        unavailableQueryCount: unavailableCount,
        citationCount,
      },
    });

    const grouped = new Map<
      string,
      GeoCitationCollectionBatch["queries"]
    >();
    for (const query of batch.parsed.queries) {
      grouped.set(query.sitePageId, [
        ...(grouped.get(query.sitePageId) ?? []),
        query,
      ]);
    }

    const observationByPage = new Map<string, string>();
    const trust = trustFor(collector.kind);
    for (const [sitePageId, pageQueries] of grouped) {
      const observedQueries = pageQueries.filter(
        (query) => query.citationState !== "unavailable",
      );
      const citedQueries = observedQueries.filter(
        (query) => query.citationState === "cited",
      );
      const citations = citedQueries.reduce(
        (count, query) => count + query.citations.length,
        0,
      );
      const observationId = nextId(this.clock);
      observationByPage.set(sitePageId, observationId);
      const available = observedQueries.length > 0;
      await this.exec.insert(normalizedObservations).values({
        id: observationId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        snapshot_id: snapshotId,
        site_page_id: sitePageId,
        provider: "geo",
        metric_key: GEO_METRIC_KEY,
        subject_type: "url",
        subject_ref: exactPages.get(sitePageId)!,
        observed_at: batch.parsed.capturedAt,
        availability: available ? "available" : "partial",
        value_numeric: null,
        value_text: null,
        value_json: available
          ? {
              schemaVersion: GEO_SCHEMA_VERSION,
              marketCode: batch.parsed.marketCode,
              languageTag: batch.parsed.languageTag,
              querySetHash: querySetHash(pageQueries),
              trackedQueries: observedQueries.length,
              citedQueries: citedQueries.length,
              citations,
              attemptedQueries: pageQueries.length,
              unavailableQueries:
                pageQueries.length - observedQueries.length,
            }
          : null,
        unit: available ? "tracked_queries" : null,
        origin: trust.origin,
        method: "observed",
        grade: trust.grade,
        support: "context",
        limitation: batch.parsed.limitation,
      });
    }

    for (const query of batch.parsed.queries) {
      const queryId = nextId(this.clock);
      const observationId = observationByPage.get(
        query.sitePageId,
      );
      if (!observationId) {
        throw new GeoCitationAuthorityError(
          "GEO_EVIDENCE_INTEGRITY_INVALID",
        );
      }
      await this.exec.insert(geoQueryObservations).values({
        id: queryId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        site_id: batch.parsed.siteId,
        snapshot_id: snapshotId,
        normalized_observation_id: observationId,
        site_page_id: query.sitePageId,
        canonical_url: query.canonicalUrl,
        market_code: batch.parsed.marketCode,
        language_tag: batch.parsed.languageTag,
        query_text: query.query,
        query_hash: contentHash({
          query: query.query,
        } as CanonicalValue),
        platform_kind: query.platform.kind,
        platform_key: platformKey(query.platform),
        model: query.model,
        collector_kind: query.collector.kind,
        collector_provider_key: query.collector.providerKey,
        collector_version: query.collector.version,
        collected_at: query.collectedAt,
        citation_state: query.citationState,
        answer_evidence_excerpt:
          query.answerEvidence?.excerpt ?? null,
        answer_content_hash:
          query.answerEvidence?.contentHash ?? null,
        answer_selector: query.answerEvidence?.selector ?? null,
        evidence_statements: query.evidenceStatements ?? [],
        limitation: query.limitation,
      });
      for (const citation of query.citations) {
        await this.exec.insert(geoCitationOccurrences).values({
          id: nextId(this.clock),
          workspace_id: scope.workspaceId,
          project_id: scope.projectId,
          site_id: batch.parsed.siteId,
          snapshot_id: snapshotId,
          normalized_observation_id: observationId,
          query_observation_id: queryId,
          site_page_id: query.sitePageId,
          canonical_url: query.canonicalUrl,
          citation_url: citation.citationUrl,
          citation_ordinal: citation.citationOrdinal,
          answer_evidence_excerpt:
            citation.answerEvidenceExcerpt,
          cited_page_excerpt: citation.citedPageExcerpt,
          cited_page_content_hash:
            citation.citedPageContentHash,
          cited_paragraph_hash: citation.citedParagraphHash,
          cited_paragraph_selector:
            citation.citedParagraphSelector,
          cited_paragraph_index:
            citation.citedParagraphIndex,
          evidence_classification:
            citation.evidenceClassification,
        });
      }
    }

    await new CollectionRunsRepository(this.exec).finalize(
      batch.parsed.collectionRunId,
      {
        rowCount: batch.parsed.queries.length,
        sourceWindow: batch.parsed.coveredWindow,
        providerUsage: {
          queries: batch.parsed.queries.length,
          citations: citationCount,
        },
        stopReason:
          unavailableCount === 0
            ? null
            : "partial_query_availability",
      },
    );
    await new SourceConnectionsRepository(this.exec).setLastSnapshot(
      batch.parsed.sourceConnectionId,
      snapshotId,
      snapshotAvailability,
      batch.parsed.limitation,
    );
    const terminalized = await runs.setTerminal(input.attempt, {
      status:
        snapshotAvailability === "available"
          ? "completed"
          : "partial",
      resultType: "collection_run",
      resultId: batch.parsed.collectionRunId,
    });
    if (!terminalized) {
      throw new GeoCitationAuthorityError(
        "GEO_TERMINALIZATION_FAILED",
      );
    }

    return {
      snapshotId,
      normalizedObservationIds: [
        ...observationByPage.values(),
      ].sort(),
      replayed: false,
    };
  }

  async evidenceForMeasurementWindow(
    scope: ProjectScope,
    measurementWindowId: string,
  ): Promise<GeoCitationEvidenceResponse | null> {
    if (!Uuid.safeParse(measurementWindowId).success) return null;
    const [window] = await this.exec
      .select({
        projectId: measurementWindows.project_id,
        siteId: measurementWindows.site_id,
        sitePageId: measurementWindows.site_page_id,
        canonicalUrl: measurementWindows.canonical_url,
        limitation: measurementWindows.limitation,
        baselineSourceId:
          measurementGeoDimensions.baseline_source_ref,
        baselineSnapshotId:
          measurementGeoDimensions.baseline_snapshot_id,
        baselineObservationId:
          measurementGeoDimensions.baseline_observation_id,
        outcomeSourceId:
          measurementGeoDimensions.outcome_source_ref,
        outcomeSnapshotId:
          measurementGeoDimensions.outcome_snapshot_id,
        outcomeObservationId:
          measurementGeoDimensions.outcome_observation_id,
        geoLimitation: measurementGeoDimensions.limitation,
      })
      .from(measurementWindows)
      .innerJoin(
        measurementGeoDimensions,
        and(
          eq(
            measurementGeoDimensions.measurement_window_id,
            measurementWindows.id,
          ),
          eq(
            measurementGeoDimensions.workspace_id,
            measurementWindows.workspace_id,
          ),
          eq(
            measurementGeoDimensions.project_id,
            measurementWindows.project_id,
          ),
        ),
      )
      .where(
        and(
          projectPredicate(measurementWindows, scope),
          projectPredicate(measurementGeoDimensions, scope),
          eq(measurementWindows.id, measurementWindowId),
        ),
      )
      .limit(1);
    if (!window) return null;

    const phases = await Promise.all([
      this.evidencePhase(scope, {
        sourceConnectionId: window.baselineSourceId,
        snapshotId: window.baselineSnapshotId,
        normalizedObservationId:
          window.baselineObservationId,
      }),
      this.evidencePhase(scope, {
        sourceConnectionId: window.outcomeSourceId,
        snapshotId: window.outcomeSnapshotId,
        normalizedObservationId:
          window.outcomeObservationId,
      }),
    ]);
    return GeoCitationEvidenceResponseSchema.parse({
      projectId: window.projectId,
      siteId: window.siteId,
      measurementWindowId,
      sitePageId: window.sitePageId,
      canonicalUrl: window.canonicalUrl,
      interpretation: "observational_non_causal",
      phases: {
        baseline: phases[0],
        outcome: phases[1],
      },
      limitation:
        window.geoLimitation ?? window.limitation ?? null,
    });
  }

  private async findSnapshotByRun(
    scope: ProjectScope,
    collectionRunId: string,
  ) {
    const rows = await this.exec
      .select({
        id: dataSnapshots.id,
        checksum: dataSnapshots.checksum,
      })
      .from(dataSnapshots)
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          eq(
            dataSnapshots.collection_run_id,
            collectionRunId,
          ),
          eq(dataSnapshots.provider, "geo"),
          eq(dataSnapshots.dataset_key, GEO_DATASET_KEY),
        ),
      )
      .limit(2);
    if (rows.length > 1) {
      throw new GeoCitationAuthorityError(
        "GEO_EVIDENCE_INTEGRITY_INVALID",
      );
    }
    return rows[0] ?? null;
  }

  private async listNormalizedObservationIds(
    scope: ProjectScope,
    snapshotId: string,
  ): Promise<string[]> {
    const rows = await this.exec
      .select({ id: normalizedObservations.id })
      .from(normalizedObservations)
      .where(
        and(
          projectPredicate(normalizedObservations, scope),
          eq(normalizedObservations.snapshot_id, snapshotId),
          eq(normalizedObservations.provider, "geo"),
          eq(normalizedObservations.metric_key, GEO_METRIC_KEY),
        ),
      )
      .orderBy(asc(normalizedObservations.id));
    return rows.map((row) => row.id);
  }

  private async evidencePhase(
    scope: ProjectScope,
    identity: {
      readonly sourceConnectionId: string | null;
      readonly snapshotId: string | null;
      readonly normalizedObservationId: string | null;
    },
  ) {
    const values = [
      identity.sourceConnectionId,
      identity.snapshotId,
      identity.normalizedObservationId,
    ];
    if (values.every((value) => value === null)) return null;
    if (
      values.some(
        (value) => value === null || !Uuid.safeParse(value).success,
      )
    ) {
      throw new GeoCitationAuthorityError(
        "GEO_EVIDENCE_INTEGRITY_INVALID",
      );
    }
    const normalizedObservationId =
      identity.normalizedObservationId!;
    const [authority] = await this.exec
      .select({ observationId: normalizedObservations.id })
      .from(dataSnapshots)
      .innerJoin(
        normalizedObservations,
        and(
          eq(
            normalizedObservations.snapshot_id,
            dataSnapshots.id,
          ),
          eq(
            normalizedObservations.workspace_id,
            dataSnapshots.workspace_id,
          ),
          eq(
            normalizedObservations.project_id,
            dataSnapshots.project_id,
          ),
        ),
      )
      .where(
        and(
          projectPredicate(dataSnapshots, scope),
          projectPredicate(normalizedObservations, scope),
          eq(dataSnapshots.id, identity.snapshotId!),
          eq(
            dataSnapshots.source_connection_id,
            identity.sourceConnectionId!,
          ),
          eq(dataSnapshots.provider, "geo"),
          eq(dataSnapshots.dataset_key, GEO_DATASET_KEY),
          eq(
            normalizedObservations.id,
            normalizedObservationId,
          ),
          eq(normalizedObservations.provider, "geo"),
          eq(normalizedObservations.metric_key, GEO_METRIC_KEY),
          eq(normalizedObservations.availability, "available"),
        ),
      )
      .limit(1);
    if (!authority) {
      throw new GeoCitationAuthorityError(
        "GEO_EVIDENCE_INTEGRITY_INVALID",
      );
    }
    const queries = await this.exec
      .select()
      .from(geoQueryObservations)
      .where(
        and(
          projectPredicate(geoQueryObservations, scope),
          eq(
            geoQueryObservations.snapshot_id,
            identity.snapshotId!,
          ),
          eq(
            geoQueryObservations.normalized_observation_id,
            normalizedObservationId,
          ),
        ),
      )
      .orderBy(
        asc(geoQueryObservations.collected_at),
        asc(geoQueryObservations.id),
      );
    if (queries.length === 0) {
      throw new GeoCitationAuthorityError(
        "GEO_EVIDENCE_INTEGRITY_INVALID",
      );
    }
    const queryIds = queries.map((query) => query.id);
    const citations =
      queryIds.length === 0
        ? []
        : await this.exec
            .select()
            .from(geoCitationOccurrences)
            .where(
              and(
                projectPredicate(
                  geoCitationOccurrences,
                  scope,
                ),
                eq(
                  geoCitationOccurrences.snapshot_id,
                  identity.snapshotId!,
                ),
                eq(
                  geoCitationOccurrences.normalized_observation_id,
                  normalizedObservationId,
                ),
                inArray(
                  geoCitationOccurrences.query_observation_id,
                  queryIds,
                ),
              ),
            )
            .orderBy(
              asc(
                geoCitationOccurrences.query_observation_id,
              ),
              asc(geoCitationOccurrences.citation_ordinal),
              asc(geoCitationOccurrences.id),
            );
    const citationsByQuery = new Map<
      string,
      typeof citations
    >();
    for (const citation of citations) {
      citationsByQuery.set(citation.query_observation_id, [
        ...(citationsByQuery.get(
          citation.query_observation_id,
        ) ?? []),
        citation,
      ]);
    }

    return {
      sourceConnectionId: identity.sourceConnectionId!,
      snapshotId: identity.snapshotId!,
      normalizedObservationId,
      queries: queries.map((query) => ({
        id: query.id,
        query: query.query_text,
        platform:
          query.platform_kind === "known"
            ? {
                kind: "known" as const,
                key: query.platform_key,
              }
            : {
                kind: "other" as const,
                providerKey: query.platform_key,
              },
        model: query.model,
        collector: {
          kind: query.collector_kind,
          providerKey: query.collector_provider_key,
          version: query.collector_version,
        },
        collectedAt: canonicalUtcTimestamptz(
          query.collected_at,
        ),
        marketCode: query.market_code,
        languageTag: query.language_tag,
        citationState: query.citation_state,
        answerEvidence:
          query.answer_evidence_excerpt === null
            ? null
            : {
                excerpt: query.answer_evidence_excerpt,
                contentHash: query.answer_content_hash!,
                selector: query.answer_selector!,
              },
        limitation: query.limitation,
        citations: (
          citationsByQuery.get(query.id) ?? []
        ).map((citation) => ({
          id: citation.id,
          citationUrl: citation.citation_url,
          citationOrdinal: citation.citation_ordinal,
          answerEvidenceExcerpt:
            citation.answer_evidence_excerpt,
          citedPageExcerpt: citation.cited_page_excerpt,
          citedPageContentHash:
            citation.cited_page_content_hash,
          citedParagraphHash: citation.cited_paragraph_hash,
          citedParagraphSelector:
            citation.cited_paragraph_selector,
          citedParagraphIndex:
            citation.cited_paragraph_index,
          evidenceClassification:
            citation.evidence_classification,
        })),
        evidenceStatements:
          Array.isArray(query.evidence_statements) &&
          query.evidence_statements.length > 0
            ? query.evidence_statements
            : undefined,
      })),
    };
  }
}
