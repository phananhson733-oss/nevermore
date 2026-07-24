import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { clientProjects, keywordEntities } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";
import type { KeywordQueryKind } from "./keyword-occurrences.ts";

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

export const MAX_KEYWORD_ENTITY_PAGE_SIZE = 100;
/** Safety ceiling for one frozen keyword identity set (search + generative). */
export const MAX_KEYWORD_ENTITY_BATCH = 500;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MARKET = /^[A-Z]{2}$/u;

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

function assertOptionalBounded(
  value: string | null,
  label: string,
  max: number,
): void {
  if (
    value !== null &&
    (value.length < 1 || value.length > max || value.trim() !== value)
  ) {
    throw new RangeError(
      `${label} must be null or 1 to ${max} trimmed characters`,
    );
  }
}

function assertReviewInput(input: KeywordReviewMappingInput): void {
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  ) {
    throw new RangeError(
      "expectedRevision must be a non-negative safe integer",
    );
  }
  assertOptionalBounded(input.intent, "intent", 100);
  assertOptionalBounded(input.buyerStage, "buyerStage", 100);
  assertOptionalBounded(input.clusterKey, "clusterKey", 200);
  if (
    input.mappingDecision === "existing_page" &&
    (input.mappedSitePageId === null || !UUID.test(input.mappedSitePageId))
  ) {
    throw new RangeError("mappedSitePageId is required for existing_page");
  }
  if (
    input.mappingDecision !== "existing_page" &&
    input.mappedSitePageId !== null
  ) {
    throw new RangeError(
      "mappedSitePageId must be null unless mapping is existing_page",
    );
  }
}

function activeProjectPredicate(scope: ProjectScope) {
  return and(
    eq(clientProjects.id, scope.projectId),
    eq(clientProjects.workspace_id, scope.workspaceId),
    isNull(clientProjects.archived_at),
  );
}

export class KeywordsRepository extends Repository {
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
          options.status
            ? eq(keywordEntities.status, options.status)
            : undefined,
          options.queryKind
            ? eq(keywordEntities.query_kind, options.queryKind)
            : undefined,
          options.market
            ? eq(keywordEntities.market, options.market)
            : undefined,
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

  /** Optimistic review/mapping command. Null means stale, absent or archived. */
  async reviewAndMap(
    scope: ProjectScope,
    entityId: string,
    input: KeywordReviewMappingInput,
  ): Promise<KeywordEntityRow | null> {
    assertReviewInput(input);
    const rows = (await this.exec
      .update(keywordEntities)
      .set({
        status: input.status,
        intent: input.intent,
        buyer_stage: input.buyerStage,
        cluster_key: input.clusterKey,
        mapping_decision: input.mappingDecision,
        mapped_site_page_id: input.mappedSitePageId,
        mapping_review_state: input.mappingReviewState,
        mapping_revision: input.expectedRevision + 1,
      })
      .where(
        and(
          projectPredicate(keywordEntities, scope),
          eq(keywordEntities.id, entityId),
          eq(keywordEntities.mapping_revision, input.expectedRevision),
          sql`exists (
            select 1
            from ${clientProjects}
            where ${clientProjects.id} = ${scope.projectId}
              and ${clientProjects.workspace_id} = ${scope.workspaceId}
              and ${clientProjects.archived_at} is null
          )`,
        ),
      )
      .returning(entitySelection)) as KeywordEntityRow[];
    return rows[0] ?? null;
  }
}
