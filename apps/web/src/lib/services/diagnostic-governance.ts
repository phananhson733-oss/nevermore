import {
  canonicalUtcTimestamptz,
  CompetitorsRepository,
  KeywordOccurrencesRepository,
  KeywordsRepository,
  MAX_COMPETITOR_ORIGIN_BATCH_TOTAL,
  MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
  MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ,
  MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ,
  MAX_KEYWORD_OCCURRENCE_BATCH_TOTAL,
  MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
  type CompetitorEntityRow,
  type CompetitorOriginRow,
  type Executor,
  type KeywordEntityRow,
  type KeywordOccurrenceForEntityRow,
  type KeywordOccurrenceRow,
  type ProjectScope,
} from "@sf/db";
import {
  GOVERNANCE_PROJECTION_VERSION,
  parseGovernanceProjectionV1,
  type GovernanceCompetitorFactV1,
  type GovernanceKeywordFactV1,
  type GovernanceProjectionV1,
} from "@sf/engine";

/**
 * These ceilings bound both database work and the immutable JSON manifest.
 * Occurrence/origin reads request one sentinel row beyond the accepted limit
 * whenever their repositories expose no independent `hasMore` count.
 */
export const DIAGNOSTIC_GOVERNANCE_LIMITS = Object.freeze({
  keywordEntities: MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ - 1,
  keywordOccurrencesPerEntity: MAX_KEYWORD_OCCURRENCE_PAGE_SIZE - 1,
  keywordOccurrenceRefsTotal: MAX_KEYWORD_OCCURRENCE_BATCH_TOTAL,
  competitorEntities: MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ - 1,
  competitorOriginsPerEntity: MAX_COMPETITOR_ORIGIN_PAGE_SIZE - 1,
  competitorOriginRefsTotal: MAX_COMPETITOR_ORIGIN_BATCH_TOTAL,
  manifestBytes: 8 * 1024 * 1024,
});

function corruptGovernance(message: string): never {
  throw new Error(`Diagnostic governance library is corrupt: ${message}`);
}

function governanceTooLarge(message: string): never {
  throw new RangeError(`Diagnostic governance library exceeds its hard cap: ${message}`);
}

function assertProjectRow(
  row: { readonly workspace_id: string; readonly project_id: string },
  scope: ProjectScope,
  label: string,
): void {
  if (
    row.workspace_id !== scope.workspaceId ||
    row.project_id !== scope.projectId
  ) {
    corruptGovernance(`${label} is outside the requested project scope`);
  }
}

function assertUniqueId(
  seen: Set<string>,
  id: string,
  label: string,
): void {
  if (seen.has(id)) {
    corruptGovernance(`${label} identity is duplicated`);
  }
  seen.add(id);
}

async function readKeywordEntities(
  repository: KeywordsRepository,
  scope: ProjectScope,
): Promise<KeywordEntityRow[]> {
  const rows = await repository.listDiagnosticEligible(scope, {
    limit: MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ,
  });
  if (rows.length > DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities) {
    governanceTooLarge(
      `more than ${DIAGNOSTIC_GOVERNANCE_LIMITS.keywordEntities} eligible keyword entities`,
    );
  }
  const entityIds = new Set<string>();
  for (const row of rows) {
    assertProjectRow(row, scope, "keyword entity");
    assertUniqueId(entityIds, row.id, "keyword entity");
    if (
      row.status !== "approved" ||
      row.mapping_review_state !== "confirmed" ||
      row.cluster_key === null
    ) {
      corruptGovernance(
        "keyword entity is not approved, confirmed, and clustered",
      );
    }
  }
  return rows;
}

function assertOccurrenceMatchesEntity(
  row: KeywordOccurrenceRow,
  entity: KeywordEntityRow,
  scope: ProjectScope,
): void {
  assertProjectRow(row, scope, "keyword occurrence");
  if (
    row.display_keyword !== entity.display_keyword ||
    row.normalized_keyword !== entity.normalized_keyword ||
    row.market !== entity.market ||
    row.language_tag !== entity.language_tag ||
    row.query_kind !== entity.query_kind
  ) {
    corruptGovernance("keyword occurrence does not match its entity identity");
  }
  const hasSnapshot = row.data_snapshot_id !== null;
  const hasObservation = row.normalized_observation_id !== null;
  if (hasSnapshot !== hasObservation) {
    corruptGovernance(
      "keyword occurrence has incomplete snapshot/observation lineage",
    );
  }
  if (
    row.source_kind === "manual"
      ? hasSnapshot ||
        row.source_pointer !== null ||
        !row.source_ref.startsWith("manual:")
      : !hasSnapshot ||
        row.source_pointer === null ||
        !row.source_ref.startsWith("observation:")
  ) {
    corruptGovernance("keyword occurrence provenance is inconsistent");
  }
}

function keywordFact(
  scope: ProjectScope,
  entity: KeywordEntityRow,
  rows: readonly KeywordOccurrenceForEntityRow[],
  seenOccurrenceIds: Set<string>,
): GovernanceKeywordFactV1 {
  if (
    rows.length > DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrencesPerEntity
  ) {
    governanceTooLarge(
      `more than ${DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrencesPerEntity} occurrences for keyword ${entity.id}`,
    );
  }
  if (rows.length === 0) {
    corruptGovernance("eligible keyword entity has no immutable occurrence");
  }
  const occurrenceRefs = rows.map((row) => {
    if (row.keyword_entity_id !== entity.id) {
      corruptGovernance(
        "keyword occurrence batch does not match its entity identity",
      );
    }
    assertOccurrenceMatchesEntity(row, entity, scope);
    assertUniqueId(seenOccurrenceIds, row.id, "keyword occurrence");
    return {
      occurrenceId: row.id,
      snapshotId: row.data_snapshot_id,
      observationId: row.normalized_observation_id,
    };
  });

  return {
    keywordEntityId: entity.id,
    displayKeyword: entity.display_keyword,
    normalizedKeyword: entity.normalized_keyword,
    marketCode: entity.market,
    languageTag: entity.language_tag,
    revision: entity.mapping_revision,
    status: entity.status,
    queryKind: entity.query_kind,
    intent: entity.intent,
    buyerStage: entity.buyer_stage,
    clusterKey: entity.cluster_key,
    mappingDecision: entity.mapping_decision,
    mappedSitePageId: entity.mapped_site_page_id,
    mappingReviewState: entity.mapping_review_state,
    lastSeenAt: canonicalUtcTimestamptz(entity.last_seen_at),
    occurrenceRefs,
    // `/valueJson/keyword` proves only keyword identity. Never manufacture
    // optional metric pointers from an occurrence that did not persist them.
    metricRefs: [],
  };
}

async function readCompetitorEntities(
  repository: CompetitorsRepository,
  scope: ProjectScope,
): Promise<CompetitorEntityRow[]> {
  const rows = await repository.listDiagnosticEligible(scope, {
    limit: MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ,
  });
  if (rows.length > DIAGNOSTIC_GOVERNANCE_LIMITS.competitorEntities) {
    governanceTooLarge(
      `more than ${DIAGNOSTIC_GOVERNANCE_LIMITS.competitorEntities} eligible competitor entities`,
    );
  }
  const entityIds = new Set<string>();
  for (const row of rows) {
    assertProjectRow(row, scope, "competitor entity");
    assertUniqueId(entityIds, row.id, "competitor entity");
    if (row.review_status !== "approved") {
      corruptGovernance("competitor entity is not approved");
    }
    if (
      !Number.isSafeInteger(row.origin_count) ||
      row.origin_count < 0
    ) {
      corruptGovernance("competitor origin count is invalid");
    }
    if (
      row.origin_count >
      DIAGNOSTIC_GOVERNANCE_LIMITS.competitorOriginsPerEntity
    ) {
      governanceTooLarge(
        `more than ${DIAGNOSTIC_GOVERNANCE_LIMITS.competitorOriginsPerEntity} origins for competitor ${row.id}`,
      );
    }
  }
  return rows;
}

function assertCompetitorOrigin(
  row: CompetitorOriginRow,
  entity: CompetitorEntityRow,
  scope: ProjectScope,
): void {
  assertProjectRow(row, scope, "competitor origin");
  if (row.competitor_id !== entity.id) {
    corruptGovernance("competitor origin does not match its entity identity");
  }
  const hasSnapshot = row.data_snapshot_id !== null;
  const hasObservation = row.normalized_observation_id !== null;
  if (hasSnapshot !== hasObservation) {
    corruptGovernance(
      "competitor origin has incomplete snapshot/observation lineage",
    );
  }
  if (
    row.origin_kind === "csv_keyword_gap" ||
    row.origin_kind === "serp_overlap" ||
    row.origin_kind === "ai_citation"
      ? !hasSnapshot
      : hasSnapshot
  ) {
    corruptGovernance("competitor origin provenance is inconsistent");
  }
}

function competitorFact(
  scope: ProjectScope,
  entity: CompetitorEntityRow,
  rows: readonly CompetitorOriginRow[],
  seenOriginIds: Set<string>,
): GovernanceCompetitorFactV1 {
  if (
    rows.length >
    DIAGNOSTIC_GOVERNANCE_LIMITS.competitorOriginsPerEntity
  ) {
    governanceTooLarge(
      `more than ${DIAGNOSTIC_GOVERNANCE_LIMITS.competitorOriginsPerEntity} origins for competitor ${entity.id}`,
    );
  }
  if (rows.length !== entity.origin_count) {
    corruptGovernance(
      "competitor origin count does not match its immutable origin rows",
    );
  }
  const originRefs = rows.map((row) => {
    assertCompetitorOrigin(row, entity, scope);
    assertUniqueId(seenOriginIds, row.id, "competitor origin");
    return {
      occurrenceId: row.id,
      originKind: row.origin_kind,
      snapshotId: row.data_snapshot_id,
      observationId: row.normalized_observation_id,
    };
  });
  return {
    competitorEntityId: entity.id,
    domain: entity.domain,
    reviewStatus: entity.review_status,
    revision: entity.revision,
    relationship: entity.relationship,
    analysisScopes: entity.analysis_scope,
    originRefs,
  };
}

/**
 * Freeze the current project-scoped Keyword and Competitor libraries once,
 * while the diagnostic run transaction is still open. The worker consumes
 * only this parsed projection and must never re-read these mutable libraries.
 */
export async function freezeDiagnosticGovernance(
  exec: Executor,
  scope: ProjectScope,
): Promise<GovernanceProjectionV1> {
  const keywordRepository = new KeywordsRepository(exec);
  const occurrenceRepository = new KeywordOccurrencesRepository(exec);
  const competitorRepository = new CompetitorsRepository(exec);

  const keywordEntities = await readKeywordEntities(
    keywordRepository,
    scope,
  );
  const keywordById = new Map(
    keywordEntities.map((entity) => [entity.id, entity] as const),
  );
  const occurrenceRows = await occurrenceRepository.listForEntityIds(
    scope,
    keywordEntities.map((entity) => entity.id),
    {
      limitPerEntity: MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
      totalLimit:
        DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrenceRefsTotal,
    },
  );
  if (
    occurrenceRows.length >
    DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrenceRefsTotal
  ) {
    governanceTooLarge(
      `more than ${DIAGNOSTIC_GOVERNANCE_LIMITS.keywordOccurrenceRefsTotal} keyword occurrence refs`,
    );
  }
  const occurrencesByEntity = new Map<
    string,
    KeywordOccurrenceForEntityRow[]
  >();
  for (const row of occurrenceRows) {
    if (!keywordById.has(row.keyword_entity_id)) {
      corruptGovernance(
        "keyword occurrence batch contains an unrequested entity",
      );
    }
    const rows = occurrencesByEntity.get(row.keyword_entity_id) ?? [];
    rows.push(row);
    occurrencesByEntity.set(row.keyword_entity_id, rows);
  }
  const seenOccurrenceIds = new Set<string>();
  const keywordClusters = new Map<string, GovernanceKeywordFactV1[]>();
  for (const entity of keywordEntities) {
    const fact = keywordFact(
      scope,
      entity,
      occurrencesByEntity.get(entity.id) ?? [],
      seenOccurrenceIds,
    );
    // The dedicated repository read admits only reviewed legacy cluster facts.
    // No Topic identity/revision is asserted until that authority is migrated.
    const groupingKey = entity.cluster_key;
    if (groupingKey === null) {
      corruptGovernance("eligible keyword entity has no cluster identity");
    }
    const facts = keywordClusters.get(groupingKey) ?? [];
    facts.push(fact);
    keywordClusters.set(groupingKey, facts);
  }

  const competitorEntities = await readCompetitorEntities(
    competitorRepository,
    scope,
  );
  const competitorById = new Map(
    competitorEntities.map((entity) => [entity.id, entity] as const),
  );
  const originRows =
    await competitorRepository.listOriginsForCompetitorIds(
      scope,
      competitorEntities.map((entity) => entity.id),
      {
        limitPerEntity: MAX_COMPETITOR_ORIGIN_PAGE_SIZE,
        totalLimit:
          DIAGNOSTIC_GOVERNANCE_LIMITS.competitorOriginRefsTotal,
      },
    );
  if (
    originRows.length >
    DIAGNOSTIC_GOVERNANCE_LIMITS.competitorOriginRefsTotal
  ) {
    governanceTooLarge(
      `more than ${DIAGNOSTIC_GOVERNANCE_LIMITS.competitorOriginRefsTotal} competitor origin refs`,
    );
  }
  const originsByCompetitor = new Map<string, CompetitorOriginRow[]>();
  for (const row of originRows) {
    if (!competitorById.has(row.competitor_id)) {
      corruptGovernance(
        "competitor origin batch contains an unrequested entity",
      );
    }
    const rows = originsByCompetitor.get(row.competitor_id) ?? [];
    rows.push(row);
    originsByCompetitor.set(row.competitor_id, rows);
  }
  const seenOriginIds = new Set<string>();
  const competitors: GovernanceCompetitorFactV1[] = [];
  for (const entity of competitorEntities) {
    competitors.push(
      competitorFact(
        scope,
        entity,
        originsByCompetitor.get(entity.id) ?? [],
        seenOriginIds,
      ),
    );
  }

  const projection = parseGovernanceProjectionV1({
    projectionVersion: GOVERNANCE_PROJECTION_VERSION,
    keywordClusters: [...keywordClusters].map(([clusterKey, keywords]) => ({
      clusterKey,
      keywords,
    })),
    competitors,
  });
  const manifestBytes = Buffer.byteLength(
    JSON.stringify(projection),
    "utf8",
  );
  if (manifestBytes > DIAGNOSTIC_GOVERNANCE_LIMITS.manifestBytes) {
    governanceTooLarge(
      `projection is ${manifestBytes} bytes (maximum ${DIAGNOSTIC_GOVERNANCE_LIMITS.manifestBytes})`,
    );
  }
  return projection;
}
