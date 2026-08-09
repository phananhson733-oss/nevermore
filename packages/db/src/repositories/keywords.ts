import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import {
  clientProjects,
  keywordEntities,
  keywordEntitySources,
  keywordOccurrences,
  keywordReviewDecisions,
  normalizedObservations,
} from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeNumericTimestampUuidCursor,
  decodeTimestampUuidCursor,
  encodeNumericTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";
import {
  MAX_KEYWORD_OCCURRENCE_PAGE_SIZE,
  type KeywordQueryKind,
} from "./keyword-occurrences.ts";

export type KeywordStatus = "candidate" | "approved" | "excluded" | "parked";
export type KeywordMappingDecision =
  | "unassigned"
  | "existing_page"
  | "new_asset";
export type KeywordMappingReviewState = "unreviewed" | "confirmed";

export interface KeywordEntityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly display_keyword: string;
  readonly normalized_keyword: string;
  readonly market: string;
  readonly language_tag: string;
  readonly query_kind: KeywordQueryKind;
  readonly status: KeywordStatus;
  readonly intent: string | null;
  readonly buyer_stage: string | null;
  readonly cluster_key: string | null;
  readonly mapping_decision: KeywordMappingDecision;
  readonly mapped_site_page_id: string | null;
  readonly mapping_review_state: KeywordMappingReviewState;
  readonly mapping_revision: number;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface KeywordEntityListPage {
  readonly rows: KeywordEntityRow[];
  readonly nextCursor: string | null;
}

export interface KeywordEntityListOptions {
  readonly limit: number;
  readonly cursor: string | null;
  readonly status?: KeywordStatus | null;
  readonly queryKind?: KeywordQueryKind | null;
  readonly market?: string | null;
  /** Keep only entities holding at least one occurrence of this source. */
  readonly sourceKind?: string | null;
}

export interface KeywordSourceCounts {
  readonly all: number;
  readonly csv_import: number;
  readonly dataforseo_ranked: number;
  readonly gsc_top_query: number;
  readonly product_profile: number;
  readonly interview_summary: number;
  readonly user_review: number;
  readonly manual: number;
}


export interface FrozenKeywordEntityListOptions {
  readonly limit: number;
  readonly cursor: string | null;
}

export interface DiagnosticKeywordEntityReadOptions {
  readonly limit: number;
}

export interface AiCitationCohortCandidateReadOptions {
  readonly market: string;
  readonly languageTag: string;
  readonly limit: number;
}

export interface AiCitationCohortCandidateRow {
  readonly entityId: string;
  readonly revision: number;
  readonly query: string;
  readonly normalizedQuery: string;
  readonly marketCode: string;
  readonly languageTag: string;
}

export interface KeywordReviewMappingInput {
  readonly expectedRevision: number;
  readonly status: KeywordStatus;
  readonly intent: string | null;
  readonly buyerStage: string | null;
  readonly clusterKey: string | null;
  readonly mappingDecision: KeywordMappingDecision;
  readonly mappedSitePageId: string | null;
  readonly mappingReviewState: KeywordMappingReviewState;
}

/**
 * One candidate keyword plus the immutable provider evidence that an automated
 * (system) governance pass is allowed to reason about. Every counter below is
 * derived from persisted Observation lineage only — nothing is inferred, and an
 * absent counter is 0 because no such immutable row exists, never because a
 * value was unavailable.
 */
export interface AutoGovernanceCandidateRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly display_keyword: string;
  readonly normalized_keyword: string;
  readonly market: string;
  readonly language_tag: string;
  readonly query_kind: KeywordQueryKind;
  readonly mapping_revision: number;
  /**
   * Occurrences whose `dataforseo_ranked` Observation carries a positive
   * `currentRank`, i.e. DataForSEO observed this site already ranking in the
   * SERP for the keyword.
   */
  readonly dataforseo_ranked_evidence: number;
  /**
   * Occurrences whose `gsc_top_query` Observation entry carries at least one
   * impression, i.e. Search Console observed this site actually served for the
   * query. Zero-impression GSC rows exist and are deliberately not evidence.
   */
  readonly gsc_impression_evidence: number;
  /** Distinct Site Pages attributed by those impression-bearing GSC rows. */
  readonly gsc_attributed_site_page_count: number;
  /** Only meaningful when `gsc_attributed_site_page_count` is exactly 1. */
  readonly gsc_attributed_site_page_id: string | null;
  /**
   * Immutable occurrence rows this keyword would contribute to the diagnostic
   * freeze once it becomes eligible. Counted uncapped, so a caller can both
   * spend its remaining occurrence budget correctly AND recognise a keyword
   * whose own history already exceeds the freeze's per-entity ceiling.
   */
  readonly occurrence_count: number;
}

/**
 * How much of the diagnostic freeze's hard budget the already-eligible library
 * consumes right now.
 *
 * Automated governance and the freeze run in ONE transaction, so a freeze that
 * overflows its ceiling rolls the approvals back too — and the next run reads
 * the same candidates in the same order and overflows again. Reading the load
 * first is what lets a run converge instead of wedging the Growth Audit.
 */
export interface DiagnosticGovernanceLoad {
  /** Keyword entities the freeze would read as diagnostic-eligible. */
  readonly eligibleEntities: number;
  /**
   * Occurrence refs those entities would contribute. The freeze reads at most
   * `MAX_KEYWORD_OCCURRENCE_PAGE_SIZE` rows per entity, so every entity is
   * counted under the same clamp instead of by its raw history length.
   */
  readonly occurrenceRefs: number;
}

export interface AutoGovernanceCandidateReadOptions {
  readonly limit: number;
}

export const MAX_KEYWORD_ENTITY_PAGE_SIZE = 100;
/** 5,000 accepted facts plus one overflow sentinel. */
export const MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ = 5_001;
/** Exactly 20 admitted queries plus one overflow sentinel. */
export const MAX_AI_CITATION_COHORT_CANDIDATE_READ = 21;
/**
 * Automated governance runs inside the already-open Growth Audit transaction,
 * so its read and its two bulk writes stay bounded well below the diagnostic
 * freeze ceiling. A project with more untouched candidates simply converges
 * over consecutive Analysis Refresh runs instead of holding one long lock.
 */
export const MAX_AUTO_GOVERNANCE_CANDIDATE_READ = 2_000;
/** Safety ceiling for one frozen keyword identity set (search + generative). */
export const MAX_KEYWORD_ENTITY_BATCH = 500;
/** Published Growth Map governance currently freezes at most 5,000 Keyword IDs. */
export const MAX_FROZEN_KEYWORD_ENTITY_BATCH =
  MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ - 1;
const MARKET = /^[A-Z]{2}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const entitySelection = {
  id: keywordEntities.id,
  workspace_id: keywordEntities.workspace_id,
  project_id: keywordEntities.project_id,
  display_keyword: keywordEntities.display_keyword,
  normalized_keyword: keywordEntities.normalized_keyword,
  market: keywordEntities.market,
  language_tag: keywordEntities.language_tag,
  query_kind: keywordEntities.query_kind,
  status: keywordEntities.status,
  intent: keywordEntities.intent,
  buyer_stage: keywordEntities.buyer_stage,
  cluster_key: keywordEntities.cluster_key,
  mapping_decision: keywordEntities.mapping_decision,
  mapped_site_page_id: keywordEntities.mapped_site_page_id,
  mapping_review_state: keywordEntities.mapping_review_state,
  mapping_revision: keywordEntities.mapping_revision,
  first_seen_at: keywordEntities.first_seen_at,
  last_seen_at: keywordEntities.last_seen_at,
  created_at: keywordEntities.created_at,
  updated_at: keywordEntities.updated_at,
} as const;

export class LegacyKeywordReviewDisabledError extends Error {
  readonly code = "LEGACY_KEYWORD_REVIEW_DISABLED";

  constructor() {
    super(
      "KeywordsRepository.reviewAndMap is retired; use KeywordGovernanceRepository.reviewKeyword so every review writes the append-only Decision ledger.",
    );
    this.name = "LegacyKeywordReviewDisabledError";
  }
}

function activeProjectPredicate(scope: ProjectScope) {
  return and(
    eq(clientProjects.id, scope.projectId),
    eq(clientProjects.workspace_id, scope.workspaceId),
    isNull(clientProjects.archived_at),
  );
}

function canonicalLanguageTag(languageTag: string): string {
  if (languageTag.trim() !== languageTag || languageTag.length > 255) {
    throw new RangeError("languageTag must be a canonical BCP-47 tag");
  }
  try {
    const canonical = Intl.getCanonicalLocales(languageTag)[0];
    if (!canonical || canonical !== languageTag) {
      throw new RangeError("languageTag must be a canonical BCP-47 tag");
    }
    return canonical;
  } catch {
    throw new RangeError("languageTag must be a canonical BCP-47 tag");
  }
}

export class KeywordsRepository extends Repository {
  /**
   * Admission read for the optional paid AI-citation sub-capability. Reading
   * one overflow sentinel lets the caller distinguish exactly 20 eligible
   * queries from a larger cohort without silently selecting a preferred 20.
   */
  async listAiCitationCohortCandidates(
    scope: ProjectScope,
    options: AiCitationCohortCandidateReadOptions,
  ): Promise<AiCitationCohortCandidateRow[]> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_AI_CITATION_COHORT_CANDIDATE_READ
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_AI_CITATION_COHORT_CANDIDATE_READ}`,
      );
    }
    if (!MARKET.test(options.market)) {
      throw new RangeError("market must be an uppercase ISO alpha-2 code");
    }
    const languageTag = canonicalLanguageTag(options.languageTag);
    const selection = {
      entityId: keywordEntities.id,
      revision: keywordEntities.mapping_revision,
      query: keywordEntities.display_keyword,
      normalizedQuery: keywordEntities.normalized_keyword,
      marketCode: keywordEntities.market,
      languageTag: keywordEntities.language_tag,
    } as const;
    return (await this.exec
      .select(selection)
      .from(keywordEntities)
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, keywordEntities.project_id),
          eq(clientProjects.workspace_id, keywordEntities.workspace_id),
        ),
      )
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          activeProjectPredicate(scope),
          eq(keywordEntities.status, "approved"),
          eq(keywordEntities.mapping_review_state, "confirmed"),
          eq(keywordEntities.query_kind, "generative_query"),
          eq(keywordEntities.market, options.market),
          eq(keywordEntities.language_tag, languageTag),
        ),
      )
      .orderBy(
        asc(keywordEntities.normalized_keyword),
        asc(keywordEntities.id),
      )
      .limit(options.limit)) as AiCitationCohortCandidateRow[];
  }

  async listDiagnosticEligible(
    scope: ProjectScope,
    options: DiagnosticKeywordEntityReadOptions,
  ): Promise<KeywordEntityRow[]> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_DIAGNOSTIC_KEYWORD_ENTITY_READ}`,
      );
    }
    return (await this.exec
      .select(entitySelection)
      .from(keywordEntities)
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, keywordEntities.project_id),
          eq(clientProjects.workspace_id, keywordEntities.workspace_id),
        ),
      )
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          activeProjectPredicate(scope),
          eq(keywordEntities.status, "approved"),
          eq(keywordEntities.mapping_review_state, "confirmed"),
          isNotNull(keywordEntities.cluster_key),
        ),
      )
      .orderBy(asc(keywordEntities.id))
      .limit(options.limit)) as KeywordEntityRow[];
  }

  /**
   * Count exactly what the diagnostic freeze would have to read for the
   * keywords that are ALREADY eligible, using the freeze's own membership rule
   * and its own per-entity occurrence clamp.
   *
   * This is a budget read, never a projection: it returns two integers and no
   * identity, so it cannot be mistaken for the frozen library itself.
   */
  async readDiagnosticGovernanceLoad(
    scope: ProjectScope,
  ): Promise<DiagnosticGovernanceLoad> {
    if (!UUID.test(scope.workspaceId) || !UUID.test(scope.projectId)) {
      throw new RangeError("scope must contain canonical UUIDs");
    }
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      with eligible as (
        select
          keyword.id,
          (
            select count(*)
            from ${keywordEntitySources} source
            where source.workspace_id = keyword.workspace_id
              and source.project_id = keyword.project_id
              and source.keyword_entity_id = keyword.id
          ) as occurrence_count
        from ${keywordEntities} keyword
        inner join ${clientProjects} project
          on project.id = keyword.project_id
         and project.workspace_id = keyword.workspace_id
        where keyword.workspace_id = ${scope.workspaceId}::uuid
          and keyword.project_id = ${scope.projectId}::uuid
          and project.archived_at is null
          and keyword.status = 'approved'
          and keyword.mapping_review_state = 'confirmed'
          and keyword.cluster_key is not null
      )
      select
        count(*)::int as eligible_entities,
        coalesce(
          sum(least(occurrence_count, ${MAX_KEYWORD_OCCURRENCE_PAGE_SIZE}::bigint)),
          0
        )::int as occurrence_refs
      from eligible
    `);
    const row = result.rows[0];
    const eligibleEntities = row?.["eligible_entities"];
    const occurrenceRefs = row?.["occurrence_refs"];
    if (
      typeof eligibleEntities !== "number" ||
      typeof occurrenceRefs !== "number" ||
      !Number.isSafeInteger(eligibleEntities) ||
      !Number.isSafeInteger(occurrenceRefs) ||
      eligibleEntities < 0 ||
      occurrenceRefs < 0
    ) {
      throw new Error(
        "diagnostic governance load read returned an invalid result",
      );
    }
    return { eligibleEntities, occurrenceRefs };
  }

  /**
   * Read untouched candidate keywords that carry immutable provider evidence an
   * automated governance pass may act on, together with that evidence.
   *
   * Three membership rules are enforced in SQL so no caller can weaken them:
   *   1. only `candidate` + `unreviewed` entities are returned, so a keyword
   *      that already carries any review outcome is never revisited;
   *   2. a keyword with ANY `user` Decision in its append-only ledger is
   *      excluded forever — a human decision outranks every system decision,
   *      including one taken after a later system invalidation; and
   *   3. a keyword with no qualifying evidence row at all is excluded BEFORE
   *      the page limit is applied. Filtering after the limit would let a large
   *      block of low-id evidence-free candidates permanently starve every
   *      evidence-bearing keyword behind them.
   *
   * Rule 3 is deliberately only a presence floor: zero evidence can never
   * justify an automated decision under any policy, so this can only ever be a
   * superset of what the caller accepts. The numeric thresholds themselves stay
   * with the caller that owns the policy, never in SQL.
   */
  async listAutoGovernanceCandidates(
    scope: ProjectScope,
    options: AutoGovernanceCandidateReadOptions,
  ): Promise<AutoGovernanceCandidateRow[]> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_AUTO_GOVERNANCE_CANDIDATE_READ
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_AUTO_GOVERNANCE_CANDIDATE_READ}`,
      );
    }
    if (!UUID.test(scope.workspaceId) || !UUID.test(scope.projectId)) {
      throw new RangeError("scope must contain canonical UUIDs");
    }

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      with candidates as (
        select
          keyword.id,
          keyword.workspace_id,
          keyword.project_id,
          keyword.display_keyword,
          keyword.normalized_keyword,
          keyword.market,
          keyword.language_tag,
          keyword.query_kind,
          keyword.mapping_revision
        from ${keywordEntities} keyword
        inner join ${clientProjects} project
          on project.id = keyword.project_id
         and project.workspace_id = keyword.workspace_id
        where keyword.workspace_id = ${scope.workspaceId}::uuid
          and keyword.project_id = ${scope.projectId}::uuid
          and project.archived_at is null
          and keyword.status = 'candidate'
          and keyword.mapping_review_state = 'unreviewed'
          and not exists (
            select 1
            from ${keywordReviewDecisions} decision
            where decision.workspace_id = keyword.workspace_id
              and decision.project_id = keyword.project_id
              and decision.keyword_entity_id = keyword.id
              and decision.decision_origin = 'user'
          )
      ),
      evidence as (
        select
          source.keyword_entity_id,
          occurrence.source_kind,
          observation.site_page_id,
          case
            when occurrence.source_kind = 'dataforseo_ranked'
              and jsonb_typeof(observation.value_json -> 'currentRank')
                = 'number'
            then (observation.value_json ->> 'currentRank')::numeric
          end as dataforseo_rank,
          case
            when occurrence.source_kind = 'gsc_top_query'
              and jsonb_typeof(
                observation.value_json
                  -> 'topQueries'
                  -> (
                    substring(
                      occurrence.source_pointer
                      from '^/valueJson/topQueries/([0-9])/query$'
                    )
                  )::int
                  -> 'impressions'
              ) = 'number'
            then (
              observation.value_json
                -> 'topQueries'
                -> (
                  substring(
                    occurrence.source_pointer
                    from '^/valueJson/topQueries/([0-9])/query$'
                  )
                )::int
                ->> 'impressions'
            )::numeric
          end as gsc_impressions
        from ${keywordEntitySources} source
        inner join candidates
          on candidates.id = source.keyword_entity_id
        inner join ${keywordOccurrences} occurrence
          on occurrence.id = source.keyword_occurrence_id
         and occurrence.workspace_id = source.workspace_id
         and occurrence.project_id = source.project_id
        inner join ${normalizedObservations} observation
          on observation.id = occurrence.normalized_observation_id
         and observation.workspace_id = occurrence.workspace_id
         and observation.project_id = occurrence.project_id
        where source.workspace_id = ${scope.workspaceId}::uuid
          and source.project_id = ${scope.projectId}::uuid
      ),
      occurrence_counts as (
        select
          source.keyword_entity_id,
          count(*)::int as occurrence_count
        from ${keywordEntitySources} source
        inner join candidates
          on candidates.id = source.keyword_entity_id
        where source.workspace_id = ${scope.workspaceId}::uuid
          and source.project_id = ${scope.projectId}::uuid
        group by source.keyword_entity_id
      ),
      scored as (
      select
        candidates.id,
        candidates.workspace_id,
        candidates.project_id,
        candidates.display_keyword,
        candidates.normalized_keyword,
        candidates.market,
        candidates.language_tag,
        candidates.query_kind,
        candidates.mapping_revision,
        coalesce(occurrence_counts.occurrence_count, 0)::int as occurrence_count,
        count(*) filter (
          where evidence.source_kind = 'dataforseo_ranked'
            and evidence.dataforseo_rank >= 1
        )::int as dataforseo_ranked_evidence,
        count(*) filter (
          where evidence.source_kind = 'gsc_top_query'
            and evidence.gsc_impressions >= 1
        )::int as gsc_impression_evidence,
        count(distinct evidence.site_page_id) filter (
          where evidence.source_kind = 'gsc_top_query'
            and evidence.gsc_impressions >= 1
            and evidence.site_page_id is not null
        )::int as gsc_attributed_site_page_count,
        (
          array_agg(distinct evidence.site_page_id) filter (
            where evidence.source_kind = 'gsc_top_query'
              and evidence.gsc_impressions >= 1
              and evidence.site_page_id is not null
          )
        )[1] as gsc_attributed_site_page_id
      from candidates
      left join evidence
        on evidence.keyword_entity_id = candidates.id
      left join occurrence_counts
        on occurrence_counts.keyword_entity_id = candidates.id
      group by
        candidates.id,
        candidates.workspace_id,
        candidates.project_id,
        candidates.display_keyword,
        candidates.normalized_keyword,
        candidates.market,
        candidates.language_tag,
        candidates.query_kind,
        candidates.mapping_revision,
        occurrence_counts.occurrence_count
      )
      select *
      from scored
      where scored.dataforseo_ranked_evidence >= 1
         or scored.gsc_impression_evidence >= 1
      order by scored.id asc
      limit ${options.limit}
    `);
    return result.rows as unknown as AutoGovernanceCandidateRow[];
  }

  /**
   * The customer-facing library page orders by value, mirroring the metric
   * projection exactly: within each Keyword's newest occurrence window, the
   * newest CSV-import/DataForSEO observation possessing the searchVolume key
   * decides the sort — a numeric value orders descending, an explicit null
   * (and a Keyword with no such observation) trails in intake order, so the
   * rendered volume and the ordering can never disagree. The cursor is a
   * numeric+timestamp+UUID keyset over exactly that ordering. Time columns
   * are cast to text so the raw read matches the query-builder row shape.
   */
  async listByProject(
    scope: ProjectScope,
    options: KeywordEntityListOptions,
  ): Promise<KeywordEntityListPage> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_KEYWORD_ENTITY_PAGE_SIZE
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_KEYWORD_ENTITY_PAGE_SIZE}`,
      );
    }
    if (options.market != null && !MARKET.test(options.market)) {
      throw new RangeError("market must be an uppercase ISO alpha-2 code");
    }
    const decoded = options.cursor
      ? decodeNumericTimestampUuidCursor(options.cursor)
      : null;
    if (options.cursor && !decoded) return { rows: [], nextCursor: null };

    const filters = [
      sql`entity.project_id = ${scope.projectId}::uuid`,
      sql`entity.workspace_id = ${scope.workspaceId}::uuid`,
    ];
    if (options.status) {
      filters.push(sql`entity.status = ${options.status}`);
    }
    if (options.queryKind) {
      filters.push(sql`entity.query_kind = ${options.queryKind}`);
    }
    if (options.market) {
      filters.push(sql`entity.market = ${options.market}`);
    }
    if (options.sourceKind) {
      filters.push(sql`exists (
        select 1
        from ${keywordEntitySources} filter_source
        inner join ${keywordOccurrences} filter_occurrence
          on filter_occurrence.id = filter_source.keyword_occurrence_id
         and filter_occurrence.workspace_id = filter_source.workspace_id
         and filter_occurrence.project_id = filter_source.project_id
        where filter_source.keyword_entity_id = entity.id
          and filter_source.workspace_id = entity.workspace_id
          and filter_source.project_id = entity.project_id
          and filter_occurrence.source_kind = ${options.sourceKind}
      )`);
    }

    const pairAfter = decoded
      ? sql`(ranked.created_at < ${decoded.timestamp}::timestamptz
          or (ranked.created_at = ${decoded.timestamp}::timestamptz
            and ranked.id < ${decoded.id}::uuid))`
      : sql`true`;
    const after = !decoded
      ? sql`true`
      : decoded.value === null
        ? sql`(ranked.sort_volume is null and ${pairAfter})`
        : sql`(ranked.sort_volume < ${decoded.value}::numeric
            or (ranked.sort_volume = ${decoded.value}::numeric and ${pairAfter})
            or ranked.sort_volume is null)`;

    const result = await this.exec.execute<Record<string, unknown>>(sql`
      with ranked as (
        select
          entity.id,
          entity.workspace_id,
          entity.project_id,
          entity.display_keyword,
          entity.normalized_keyword,
          entity.market,
          entity.language_tag,
          entity.query_kind,
          entity.status,
          entity.intent,
          entity.buyer_stage,
          entity.cluster_key,
          entity.mapping_decision,
          entity.mapped_site_page_id,
          entity.mapping_review_state,
          entity.mapping_revision,
          entity.first_seen_at,
          entity.last_seen_at,
          entity.created_at,
          entity.updated_at,
          volume_pick.volume as sort_volume
        from ${keywordEntities} entity
        inner join ${clientProjects} project
          on project.id = entity.project_id
         and project.workspace_id = entity.workspace_id
         and project.archived_at is null
        left join lateral (
          select case
            when jsonb_typeof(observation.value_json -> 'searchVolume') = 'number'
            then (observation.value_json ->> 'searchVolume')::numeric
          end as volume
          from (
            select
              occurrence.id,
              occurrence.created_at,
              occurrence.source_kind,
              occurrence.normalized_observation_id
            from ${keywordEntitySources} source
            inner join ${keywordOccurrences} occurrence
              on occurrence.id = source.keyword_occurrence_id
             and occurrence.workspace_id = source.workspace_id
             and occurrence.project_id = source.project_id
            where source.keyword_entity_id = entity.id
              and source.workspace_id = entity.workspace_id
              and source.project_id = entity.project_id
            order by occurrence.created_at desc, occurrence.id desc
            limit ${MAX_KEYWORD_OCCURRENCE_PAGE_SIZE}
          ) recent
          inner join ${normalizedObservations} observation
            on observation.id = recent.normalized_observation_id
           and observation.workspace_id = ${scope.workspaceId}::uuid
           and observation.project_id = ${scope.projectId}::uuid
          where recent.source_kind in ('csv_import', 'dataforseo_ranked')
            and observation.value_json ? 'searchVolume'
          order by recent.created_at desc, recent.id desc
          limit 1
        ) volume_pick on true
        where ${sql.join(filters, sql` and `)}
      )
      select
        ranked.id,
        ranked.workspace_id,
        ranked.project_id,
        ranked.display_keyword,
        ranked.normalized_keyword,
        ranked.market,
        ranked.language_tag,
        ranked.query_kind,
        ranked.status,
        ranked.intent,
        ranked.buyer_stage,
        ranked.cluster_key,
        ranked.mapping_decision,
        ranked.mapped_site_page_id,
        ranked.mapping_review_state,
        ranked.mapping_revision,
        ranked.first_seen_at::text as first_seen_at,
        ranked.last_seen_at::text as last_seen_at,
        ranked.created_at::text as created_at,
        ranked.updated_at::text as updated_at,
        ranked.sort_volume::text as sort_volume_text
      from ranked
      where ${after}
      order by ranked.sort_volume desc nulls last,
        ranked.created_at desc,
        ranked.id desc
      limit ${options.limit + 1}
    `);
    const rows = result.rows as unknown as (KeywordEntityRow & {
      readonly sort_volume_text: string | null;
    })[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    return {
      rows: page.map(({ sort_volume_text: _sortVolumeText, ...row }) => row),
      nextCursor:
        hasNext && last
          ? encodeNumericTimestampUuidCursor(
              last.sort_volume_text,
              last.created_at,
              last.id,
            )
          : null,
    };
  }

  /**
   * Whole-library Keyword counts per intake source for one active project.
   * Distinct entities per source kind; `all` is the unfiltered entity count,
   * so the numbers stay meaningful regardless of any page-level filter.
   */
  async countBySourceKind(scope: ProjectScope): Promise<KeywordSourceCounts> {
    const result = await this.exec.execute(sql`
      with active_entities as (
        select entity.id
        from ${keywordEntities} entity
        inner join ${clientProjects} project
          on project.id = entity.project_id
         and project.workspace_id = entity.workspace_id
        where entity.project_id = ${scope.projectId}::uuid
          and entity.workspace_id = ${scope.workspaceId}::uuid
          and project.archived_at is null
      ),
      by_kind as (
        select
          occurrence.source_kind,
          count(distinct source.keyword_entity_id)::int as keyword_count
        from ${keywordEntitySources} source
        inner join ${keywordOccurrences} occurrence
          on occurrence.id = source.keyword_occurrence_id
         and occurrence.workspace_id = source.workspace_id
         and occurrence.project_id = source.project_id
        inner join active_entities
          on active_entities.id = source.keyword_entity_id
        where source.project_id = ${scope.projectId}::uuid
          and source.workspace_id = ${scope.workspaceId}::uuid
        group by occurrence.source_kind
      )
      select
        (select count(*)::int from active_entities) as all_count,
        coalesce((select keyword_count from by_kind where source_kind = 'csv_import'), 0) as csv_import,
        coalesce((select keyword_count from by_kind where source_kind = 'dataforseo_ranked'), 0) as dataforseo_ranked,
        coalesce((select keyword_count from by_kind where source_kind = 'gsc_top_query'), 0) as gsc_top_query,
        coalesce((select keyword_count from by_kind where source_kind = 'product_profile'), 0) as product_profile,
        coalesce((select keyword_count from by_kind where source_kind = 'interview_summary'), 0) as interview_summary,
        coalesce((select keyword_count from by_kind where source_kind = 'user_review'), 0) as user_review,
        coalesce((select keyword_count from by_kind where source_kind = 'manual'), 0) as manual
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    const readCount = (key: string): number => {
      const value = row[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        return value;
      }
      if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        return Number.parseInt(value, 10);
      }
      throw new RangeError(`Keyword source count ${key} is not a safe integer`);
    };
    return {
      all: readCount("all_count"),
      csv_import: readCount("csv_import"),
      dataforseo_ranked: readCount("dataforseo_ranked"),
      gsc_top_query: readCount("gsc_top_query"),
      product_profile: readCount("product_profile"),
      interview_summary: readCount("interview_summary"),
      user_review: readCount("user_review"),
      manual: readCount("manual"),
    };
  }

  async findById(
    scope: ProjectScope,
    entityId: string,
  ): Promise<KeywordEntityRow | null> {
    const rows = (await this.exec
      .select(entitySelection)
      .from(keywordEntities)
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, keywordEntities.project_id),
          eq(clientProjects.workspace_id, keywordEntities.workspace_id),
        ),
      )
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          eq(keywordEntities.id, entityId),
          activeProjectPredicate(scope),
        ),
      )
      .limit(1)) as KeywordEntityRow[];
    return rows[0] ?? null;
  }

  /**
   * Preserve the existing timestamp+UUID customer cursor while constraining the
   * candidate set to the exact frozen Keyword IDs from one published Growth Map
   * generation. This avoids widening membership back to the mutable global
   * library while keeping list pagination behavior stable.
   */
  async listByIdsPage(
    scope: ProjectScope,
    entityIds: readonly string[],
    options: FrozenKeywordEntityListOptions,
  ): Promise<KeywordEntityListPage> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_KEYWORD_ENTITY_PAGE_SIZE
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_KEYWORD_ENTITY_PAGE_SIZE}`,
      );
    }
    const uniqueIds = [...new Set(entityIds)];
    if (uniqueIds.length > MAX_FROZEN_KEYWORD_ENTITY_BATCH) {
      throw new RangeError(
        `entityIds must contain at most ${MAX_FROZEN_KEYWORD_ENTITY_BATCH} ids`,
      );
    }
    for (const entityId of uniqueIds) {
      if (!UUID.test(entityId)) {
        throw new RangeError("entityIds must contain only UUIDs");
      }
    }
    if (uniqueIds.length === 0) {
      return { rows: [], nextCursor: null };
    }

    const decoded = options.cursor
      ? decodeTimestampUuidCursor(options.cursor)
      : null;
    if (options.cursor && !decoded) return { rows: [], nextCursor: null };
    const after = decoded
      ? or(
          lt(keywordEntities.created_at, decoded.timestamp),
          and(
            eq(keywordEntities.created_at, decoded.timestamp),
            lt(keywordEntities.id, decoded.id),
          ),
        )
      : undefined;

    const rows = (await this.exec
      .select(entitySelection)
      .from(keywordEntities)
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, keywordEntities.project_id),
          eq(clientProjects.workspace_id, keywordEntities.workspace_id),
        ),
      )
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          activeProjectPredicate(scope),
          inArray(keywordEntities.id, uniqueIds),
          after,
        ),
      )
      .orderBy(desc(keywordEntities.created_at), desc(keywordEntities.id))
      .limit(options.limit + 1)) as KeywordEntityRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor:
        hasNext && last
          ? encodeTimestampUuidCursor(last.created_at, last.id)
          : null,
    };
  }

  /**
   * Bounded batch existence read for a frozen keyword identity set. Callers
   * that freeze an explicit entity set (Content Shadow) must prove every id
   * belongs to this live project without issuing one query per id.
   */
  async listByIds(
    scope: ProjectScope,
    entityIds: readonly string[],
  ): Promise<KeywordEntityRow[]> {
    if (entityIds.length === 0) return [];
    if (entityIds.length > MAX_KEYWORD_ENTITY_BATCH) {
      throw new RangeError(
        `entityIds must contain at most ${MAX_KEYWORD_ENTITY_BATCH} ids`,
      );
    }
    return (await this.exec
      .select(entitySelection)
      .from(keywordEntities)
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, keywordEntities.project_id),
          eq(clientProjects.workspace_id, keywordEntities.workspace_id),
        ),
      )
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          inArray(keywordEntities.id, [...entityIds]),
          activeProjectPredicate(scope),
        ),
      )) as KeywordEntityRow[];
  }

  /**
   * @deprecated Keyword governance became append-only authority in migration
   * 0024. This legacy signature has no actor, reason or Topic revision and
   * therefore cannot create a truthful Keyword Review Decision.
   */
  async reviewAndMap(
    scope: ProjectScope,
    entityId: string,
    input: KeywordReviewMappingInput,
  ): Promise<KeywordEntityRow | null> {
    void scope;
    void entityId;
    void input;
    throw new LegacyKeywordReviewDisabledError();
  }
}
