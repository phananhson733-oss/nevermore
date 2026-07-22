import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { canonicalUtcTimestamptz } from "../instant.ts";
import {
  clientProjects,
  keywordEntitySources,
  keywordOccurrences,
} from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

export type KeywordQueryKind = "search_query" | "generative_query";
export type KeywordSourceKind =
  | "csv_import"
  | "dataforseo_ranked"
  | "gsc_top_query"
  | "manual";
export type KeywordScopeBasis =
  | "provider_collection_scope"
  | "user_provided"
  | "project_context"
  | "manual";

interface KeywordOccurrenceInputCommon {
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly market: string;
  readonly languageTag: string;
  readonly queryKind: KeywordQueryKind;
  readonly sourceRef: string;
  readonly collectedAt: string;
  readonly providerDataAsOf: string | null;
}

export type CanonicalKeywordOccurrenceInput =
  KeywordOccurrenceInputCommon &
    (
      | {
          readonly manualEntryId: null;
          readonly dataSnapshotId: string;
          readonly normalizedObservationId: string;
          readonly sourceKind: "csv_import";
          readonly scopeBasis: "user_provided";
          readonly sourcePointer: "/valueJson/keyword";
        }
      | {
          readonly manualEntryId: null;
          readonly dataSnapshotId: string;
          readonly normalizedObservationId: string;
          readonly sourceKind: "dataforseo_ranked";
          readonly scopeBasis: "provider_collection_scope";
          readonly sourcePointer: "/valueJson/keyword";
        }
      | {
          readonly manualEntryId: null;
          readonly dataSnapshotId: string;
          readonly normalizedObservationId: string;
          readonly sourceKind: "gsc_top_query";
          readonly scopeBasis: "project_context";
          readonly sourcePointer: string;
        }
    );

export type ManualKeywordOccurrenceInput = KeywordOccurrenceInputCommon & {
  readonly manualEntryId: string;
  readonly dataSnapshotId: null;
  readonly normalizedObservationId: null;
  readonly sourceKind: "manual";
  readonly scopeBasis: "manual";
  readonly sourcePointer: null;
  readonly providerDataAsOf: null;
};

export type KeywordOccurrenceInput =
  | CanonicalKeywordOccurrenceInput
  | ManualKeywordOccurrenceInput;

export interface KeywordOccurrenceRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly data_snapshot_id: string | null;
  readonly normalized_observation_id: string | null;
  readonly display_keyword: string;
  readonly normalized_keyword: string;
  readonly market: string;
  readonly language_tag: string;
  readonly query_kind: KeywordQueryKind;
  readonly source_kind: KeywordSourceKind;
  readonly scope_basis: KeywordScopeBasis;
  readonly source_pointer: string | null;
  readonly source_ref: string;
  readonly collected_at: string;
  readonly provider_data_as_of: string | null;
  readonly created_at: string;
}

export interface KeywordOccurrenceListPage {
  readonly rows: KeywordOccurrenceRow[];
  readonly nextCursor: string | null;
}

export interface KeywordLibraryUpsertResult {
  readonly occurrenceId: string;
  readonly entityId: string;
}

export const MAX_KEYWORD_OCCURRENCE_PAGE_SIZE = 100;
const MAX_KEYWORD_LENGTH = 500;
const MAX_SOURCE_REF_LENGTH = 2048;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MARKET = /^[A-Z]{2}$/u;
const GSC_TOP_QUERY_POINTER = /^\/valueJson\/topQueries\/[0-9]\/query$/u;

/** Canonical stable identity used before the database enforces the same bytes. */
export function normalizeKeywordIdentity(keyword: string): string {
  return keyword
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function canonicalLanguageTag(languageTag: string): string {
  if (languageTag.trim() !== languageTag || languageTag.length > 255) {
    throw new RangeError("languageTag must be a canonical BCP-47 tag");
  }
  try {
    const canonical = Intl.getCanonicalLocales(languageTag)[0];
    if (!canonical) throw new RangeError("missing language tag");
    return canonical;
  } catch {
    throw new RangeError("languageTag must be a canonical BCP-47 tag");
  }
}

function assertInput(input: KeywordOccurrenceInput): {
  readonly occurrenceId: string | null;
  readonly dataSnapshotId: string | null;
  readonly observationId: string | null;
  readonly languageTag: string;
  readonly scopeBasis: KeywordScopeBasis;
  readonly sourcePointer: string | null;
  readonly collectedAt: string;
  readonly providerDataAsOf: string | null;
} {
  if (
    input.displayKeyword.trim() !== input.displayKeyword ||
    input.displayKeyword.length < 1 ||
    input.displayKeyword.length > MAX_KEYWORD_LENGTH
  ) {
    throw new RangeError("displayKeyword must contain 1 to 500 trimmed characters");
  }
  const normalized = normalizeKeywordIdentity(input.displayKeyword);
  if (input.normalizedKeyword !== normalized) {
    throw new RangeError("normalizedKeyword must equal the canonical keyword identity");
  }
  if (!MARKET.test(input.market)) {
    throw new RangeError("market must be an uppercase ISO alpha-2 code");
  }
  if (
    input.sourceRef.trim() !== input.sourceRef ||
    input.sourceRef.length < 1 ||
    input.sourceRef.length > MAX_SOURCE_REF_LENGTH
  ) {
    throw new RangeError("sourceRef must contain 1 to 2048 trimmed characters");
  }
  const collectedAt = canonicalUtcTimestamptz(input.collectedAt);
  const providerDataAsOf =
    input.providerDataAsOf === null
      ? null
      : canonicalUtcTimestamptz(input.providerDataAsOf);
  const languageTag = canonicalLanguageTag(input.languageTag);

  if (input.sourceKind === "manual") {
    if (!UUID.test(input.manualEntryId)) {
      throw new RangeError("manualEntryId must be a UUID");
    }
    if (
      input.dataSnapshotId !== null ||
      input.normalizedObservationId !== null ||
      input.sourcePointer !== null ||
      input.providerDataAsOf !== null ||
      input.scopeBasis !== "manual"
    ) {
      throw new RangeError("manual occurrence must not invent provider lineage");
    }
    if (input.sourceRef !== `manual:${input.manualEntryId}`) {
      throw new RangeError("sourceRef must identify the manual entry occurrence");
    }
    return {
      occurrenceId: input.manualEntryId,
      dataSnapshotId: null,
      observationId: null,
      languageTag,
      scopeBasis: "manual",
      sourcePointer: null,
      collectedAt,
      providerDataAsOf: null,
    };
  }

  if (!UUID.test(input.normalizedObservationId)) {
    throw new RangeError(
      "normalizedObservationId must identify canonical Observation lineage",
    );
  }
  if (!UUID.test(input.dataSnapshotId)) {
    throw new RangeError("dataSnapshotId must be a UUID");
  }
  if (input.manualEntryId !== null) {
    throw new RangeError("manualEntryId must be null for canonical source lineage");
  }
  const validPointer =
    (input.sourcePointer === "/valueJson/keyword" &&
      input.sourceKind !== "gsc_top_query") ||
    (GSC_TOP_QUERY_POINTER.test(input.sourcePointer) &&
      input.sourceKind === "gsc_top_query");
  if (!validPointer) {
    throw new RangeError("sourcePointer is not supported for sourceKind");
  }
  const expectedScopeBasis: Exclude<KeywordScopeBasis, "manual"> =
    input.sourceKind === "csv_import"
      ? "user_provided"
      : input.sourceKind === "dataforseo_ranked"
        ? "provider_collection_scope"
        : "project_context";
  if (input.scopeBasis !== expectedScopeBasis) {
    throw new RangeError("scopeBasis is not supported for sourceKind");
  }
  if (input.queryKind !== "search_query") {
    throw new RangeError("current canonical sourceKind requires search_query");
  }
  if (
    input.sourceRef !==
    `observation:${input.normalizedObservationId}#${input.sourcePointer}`
  ) {
    throw new RangeError(
      "sourceRef must be the canonical Observation pointer reference",
    );
  }
  return {
    occurrenceId: null,
    dataSnapshotId: input.dataSnapshotId,
    observationId: input.normalizedObservationId,
    languageTag,
    scopeBasis: expectedScopeBasis,
    sourcePointer: input.sourcePointer,
    collectedAt,
    providerDataAsOf,
  };
}

function parseUpsertResult(value: unknown): KeywordLibraryUpsertResult {
  const rows = (value as {
    readonly rows?: readonly {
      readonly occurrence_id?: unknown;
      readonly entity_id?: unknown;
    }[];
  }).rows;
  const row = rows?.length === 1 ? rows[0] : undefined;
  if (
    !row ||
    typeof row.occurrence_id !== "string" ||
    typeof row.entity_id !== "string"
  ) {
    throw new Error("keyword library upsert returned an invalid result");
  }
  return { occurrenceId: row.occurrence_id, entityId: row.entity_id };
}

export class KeywordOccurrencesRepository extends Repository {
  /**
   * One database call atomically converges immutable occurrence provenance,
   * stable identity and entity membership under concurrent retries.
   */
  async upsertIntoLibrary(
    scope: ProjectScope,
    input: KeywordOccurrenceInput,
  ): Promise<KeywordLibraryUpsertResult> {
    const canonical = assertInput(input);
    const raw = await this.exec.execute(sql`
      select occurrence_id, entity_id
      from app.upsert_keyword_library_occurrence(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${canonical.occurrenceId}::uuid,
        ${canonical.dataSnapshotId}::uuid,
        ${canonical.observationId}::uuid,
        ${input.displayKeyword}::text,
        ${input.normalizedKeyword}::text,
        ${input.market}::text,
        ${canonical.languageTag}::text,
        ${input.queryKind}::text,
        ${input.sourceKind}::text,
        ${canonical.scopeBasis}::text,
        ${canonical.sourcePointer}::text,
        ${input.sourceRef}::text,
        ${canonical.collectedAt}::timestamptz,
        ${canonical.providerDataAsOf}::timestamptz
      )
    `);
    return parseUpsertResult(raw);
  }

  /** Bounded provenance history for one stable keyword entity. */
  async listForEntity(
    scope: ProjectScope,
    entityId: string,
    options: { readonly limit: number; readonly cursor: string | null },
  ): Promise<KeywordOccurrenceListPage> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_KEYWORD_OCCURRENCE_PAGE_SIZE
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_KEYWORD_OCCURRENCE_PAGE_SIZE}`,
      );
    }
    const decoded = options.cursor
      ? decodeTimestampUuidCursor(options.cursor)
      : null;
    if (options.cursor && !decoded) return { rows: [], nextCursor: null };
    const after = decoded
      ? or(
          lt(keywordOccurrences.created_at, decoded.timestamp),
          and(
            eq(keywordOccurrences.created_at, decoded.timestamp),
            lt(keywordOccurrences.id, decoded.id),
          ),
        )
      : undefined;

    const rows = (await this.exec
      .select({
        id: keywordOccurrences.id,
        workspace_id: keywordOccurrences.workspace_id,
        project_id: keywordOccurrences.project_id,
        data_snapshot_id: keywordOccurrences.data_snapshot_id,
        normalized_observation_id:
          keywordOccurrences.normalized_observation_id,
        display_keyword: keywordOccurrences.display_keyword,
        normalized_keyword: keywordOccurrences.normalized_keyword,
        market: keywordOccurrences.market,
        language_tag: keywordOccurrences.language_tag,
        query_kind: keywordOccurrences.query_kind,
        source_kind: keywordOccurrences.source_kind,
        scope_basis: keywordOccurrences.scope_basis,
        source_pointer: keywordOccurrences.source_pointer,
        source_ref: keywordOccurrences.source_ref,
        collected_at: keywordOccurrences.collected_at,
        provider_data_as_of: keywordOccurrences.provider_data_as_of,
        created_at: keywordOccurrences.created_at,
      })
      .from(keywordEntitySources)
      .innerJoin(
        keywordOccurrences,
        and(
          eq(
            keywordOccurrences.id,
            keywordEntitySources.keyword_occurrence_id,
          ),
          eq(
            keywordOccurrences.workspace_id,
            keywordEntitySources.workspace_id,
          ),
          eq(
            keywordOccurrences.project_id,
            keywordEntitySources.project_id,
          ),
        ),
      )
      .innerJoin(
        clientProjects,
        and(
          eq(clientProjects.id, keywordEntitySources.project_id),
          eq(clientProjects.workspace_id, keywordEntitySources.workspace_id),
        ),
      )
      .where(
        and(
          projectPredicate(keywordEntitySources, scope),
          eq(keywordEntitySources.keyword_entity_id, entityId),
          isNull(clientProjects.archived_at),
          after,
        ),
      )
      .orderBy(desc(keywordOccurrences.created_at), desc(keywordOccurrences.id))
      .limit(options.limit + 1)) as KeywordOccurrenceRow[];

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
}
