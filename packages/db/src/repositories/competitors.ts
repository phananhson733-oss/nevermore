import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import {
  clientProjects,
  competitorEntities,
  competitorOriginOccurrences,
} from "../schema.ts";
import { canonicalUtcTimestamptz } from "../instant.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

export type CompetitorReviewStatus = "candidate" | "approved" | "excluded";
export type CompetitorRelationship =
  | "direct"
  | "indirect"
  | "status_quo"
  | "benchmark"
  | "publisher";
export type CompetitorAnalysisScope =
  | "positioning"
  | "product_capability"
  | "keyword_gap"
  | "content"
  | "serp_visibility";
export type CompetitorOriginKind =
  | "product_profile"
  | "csv_keyword_gap"
  | "manual";

interface EvidenceRefIdentity {
  readonly evidenceRefId: string;
}

export type ProductProfileEvidenceRef =
  | (EvidenceRefIdentity & {
      readonly kind: "snapshot";
      readonly snapshotId: string;
    })
  | (EvidenceRefIdentity & {
      readonly kind: "pageSnapshot";
      readonly pageSnapshotId: string;
    })
  | (EvidenceRefIdentity & {
      readonly kind: "observation";
      readonly observationId: string;
    })
  | (EvidenceRefIdentity & {
      readonly kind: "analysisInvocation";
      readonly analysisInvocationId: string;
    })
  | (EvidenceRefIdentity & {
      readonly kind: "declaredHint" | "userEdit";
    });

interface CompetitorOriginCommon {
  readonly domain: string;
  readonly name: string | null;
}

export interface ProductProfileCompetitorOriginInput
  extends CompetitorOriginCommon {
  readonly originKind: "product_profile";
  readonly name: string;
  readonly productProfileId: string;
  readonly profileVersion: number;
  readonly candidateId: string;
  readonly fieldProvenancePath: string;
  readonly evidenceRefs: readonly ProductProfileEvidenceRef[];
  readonly sourceReviewStatus: CompetitorReviewStatus;
  readonly sourceRelationship: "direct" | "indirect" | null;
  readonly sourceAnalysisScope: readonly CompetitorAnalysisScope[];
}

export interface CsvKeywordGapCompetitorOriginInput
  extends CompetitorOriginCommon {
  readonly originKind: "csv_keyword_gap";
  readonly name: null;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly importPreviewId: string;
  readonly sourcePointer: "/valueJson/competitorDomain";
}

export interface ManualCompetitorOriginInput extends CompetitorOriginCommon {
  readonly originKind: "manual";
  readonly manualEntryId: string;
}

export type CompetitorOriginInput =
  | ProductProfileCompetitorOriginInput
  | CsvKeywordGapCompetitorOriginInput
  | ManualCompetitorOriginInput;

export interface CompetitorOriginUpsertResult {
  readonly occurrenceId: string;
  readonly competitorId: string;
}

export interface CompetitorEntityRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly domain: string;
  readonly name: string | null;
  readonly review_status: CompetitorReviewStatus;
  readonly relationship: CompetitorRelationship | null;
  readonly analysis_scope: CompetitorAnalysisScope[];
  readonly revision: number;
  /** Max canonical Observation time; Product Profile/manual origins stay null. */
  readonly last_observed_at: string | null;
  readonly origin_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CompetitorOriginRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly competitor_id: string;
  readonly origin_kind: CompetitorOriginKind;
  readonly source_name: string | null;
  readonly product_profile_id: string | null;
  readonly profile_version: number | null;
  readonly candidate_id: string | null;
  readonly field_provenance_path: string | null;
  readonly evidence_refs: ProductProfileEvidenceRef[] | null;
  readonly source_review_status: CompetitorReviewStatus | null;
  readonly source_relationship: "direct" | "indirect" | null;
  readonly source_analysis_scope: CompetitorAnalysisScope[] | null;
  readonly data_snapshot_id: string | null;
  readonly normalized_observation_id: string | null;
  readonly import_preview_id: string | null;
  readonly source_pointer: string | null;
  readonly manual_entry_id: string | null;
  readonly observed_at: string | null;
  readonly created_at: string;
}

export interface CompetitorListOptions {
  readonly limit: number;
  readonly cursor: string | null;
  readonly reviewStatus?: CompetitorReviewStatus | null;
}

export interface CompetitorListPage {
  readonly rows: CompetitorEntityRow[];
  readonly nextCursor: string | null;
}

export interface CompetitorReviewInput {
  readonly expectedRevision: number;
  readonly name: string | null;
  readonly reviewStatus: CompetitorReviewStatus;
  readonly relationship: CompetitorRelationship | null;
  readonly analysisScope: readonly CompetitorAnalysisScope[];
}

export const MAX_COMPETITOR_PAGE_SIZE = 100;
export const MAX_COMPETITOR_ORIGIN_PAGE_SIZE = 100;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NORMALIZED_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const PROFILE_PATH = /^\/competitorCandidates\/(?:0|[1-9][0-9]*)$/u;
const REVIEW_STATUSES = new Set<CompetitorReviewStatus>([
  "candidate",
  "approved",
  "excluded",
]);
const RELATIONSHIPS = new Set<CompetitorRelationship>([
  "direct",
  "indirect",
  "status_quo",
  "benchmark",
  "publisher",
]);
const PROFILE_RELATIONSHIPS = new Set(["direct", "indirect"] as const);
const ANALYSIS_SCOPES = new Set<CompetitorAnalysisScope>([
  "positioning",
  "product_capability",
  "keyword_gap",
  "content",
  "serp_visibility",
]);

const nullableCanonicalInstant = {
  mapFromDriverValue(value: unknown): string | null {
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    return canonicalUtcTimestamptz(String(value));
  },
} as const;

const lastObservedAt = sql<string | null>`(
    select max(origin.observed_at)
    from app.competitor_origin_occurrences origin
    where origin.competitor_id = app.competitor_entities.id
  )`.mapWith(nullableCanonicalInstant);
const originCount = sql<number>`(
  select count(*)::integer
  from app.competitor_origin_occurrences origin
  where origin.competitor_id = app.competitor_entities.id
)`;

const competitorSelection = {
  id: competitorEntities.id,
  workspace_id: competitorEntities.workspace_id,
  project_id: competitorEntities.project_id,
  domain: competitorEntities.domain,
  name: competitorEntities.name,
  review_status: competitorEntities.review_status,
  relationship: competitorEntities.relationship,
  analysis_scope: competitorEntities.analysis_scope,
  revision: competitorEntities.revision,
  last_observed_at: lastObservedAt,
  origin_count: originCount,
  created_at: competitorEntities.created_at,
  updated_at: competitorEntities.updated_at,
} as const;

const originSelection = {
  id: competitorOriginOccurrences.id,
  workspace_id: competitorOriginOccurrences.workspace_id,
  project_id: competitorOriginOccurrences.project_id,
  competitor_id: competitorOriginOccurrences.competitor_id,
  origin_kind: competitorOriginOccurrences.origin_kind,
  source_name: competitorOriginOccurrences.source_name,
  product_profile_id: competitorOriginOccurrences.product_profile_id,
  profile_version: competitorOriginOccurrences.profile_version,
  candidate_id: competitorOriginOccurrences.candidate_id,
  field_provenance_path:
    competitorOriginOccurrences.field_provenance_path,
  evidence_refs: competitorOriginOccurrences.evidence_refs,
  source_review_status: competitorOriginOccurrences.source_review_status,
  source_relationship: competitorOriginOccurrences.source_relationship,
  source_analysis_scope:
    competitorOriginOccurrences.source_analysis_scope,
  data_snapshot_id: competitorOriginOccurrences.data_snapshot_id,
  normalized_observation_id:
    competitorOriginOccurrences.normalized_observation_id,
  import_preview_id: competitorOriginOccurrences.import_preview_id,
  source_pointer: competitorOriginOccurrences.source_pointer,
  manual_entry_id: competitorOriginOccurrences.manual_entry_id,
  observed_at: sql<string | null>`${competitorOriginOccurrences.observed_at}`
    .mapWith(nullableCanonicalInstant),
  created_at: competitorOriginOccurrences.created_at,
} as const;

function activeProjectPredicate(scope: ProjectScope) {
  return sql`exists (
    select 1
    from ${clientProjects}
    where ${clientProjects.id} = ${scope.projectId}
      and ${clientProjects.workspace_id} = ${scope.workspaceId}
      and ${clientProjects.archived_at} is null
  )`;
}

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new RangeError(`${label} must be a UUID`);
}

function assertName(name: string | null): void {
  if (
    name !== null &&
    (name.length < 1 || name.length > 160 || name.trim() !== name)
  ) {
    throw new RangeError("name must be null or 1 to 160 trimmed characters");
  }
}

function assertDomain(domain: string): void {
  if (!NORMALIZED_DOMAIN.test(domain) || domain !== domain.toLowerCase()) {
    throw new RangeError(
      "domain must be a normalized lowercase hostname without scheme, port, or path",
    );
  }
}

function assertAnalysisScope(
  analysisScope: readonly CompetitorAnalysisScope[],
): void {
  if (
    analysisScope.length > 5 ||
    new Set(analysisScope).size !== analysisScope.length ||
    analysisScope.some((value) => !ANALYSIS_SCOPES.has(value))
  ) {
    throw new RangeError("analysisScope must contain unique supported scopes");
  }
}

function assertEvidenceRefs(
  evidenceRefs: readonly ProductProfileEvidenceRef[],
): void {
  if (
    evidenceRefs.length < 1 ||
    evidenceRefs.length > 50 ||
    new Set(evidenceRefs.map((ref) => ref.evidenceRefId)).size !==
      evidenceRefs.length
  ) {
    throw new RangeError("evidenceRefs must contain 1 to 50 unique typed refs");
  }
  for (const ref of evidenceRefs) {
    if (
      typeof ref !== "object" ||
      ref === null ||
      !UUID.test(ref.evidenceRefId)
    ) {
      throw new RangeError("evidenceRefs must contain typed UUID identities");
    }
    const value = ref as unknown as Record<string, unknown>;
    const targetKey =
      ref.kind === "snapshot"
        ? "snapshotId"
        : ref.kind === "pageSnapshot"
          ? "pageSnapshotId"
          : ref.kind === "observation"
            ? "observationId"
            : ref.kind === "analysisInvocation"
              ? "analysisInvocationId"
              : ref.kind === "declaredHint" || ref.kind === "userEdit"
                ? null
                : undefined;
    if (targetKey === undefined) {
      throw new RangeError("evidenceRefs contain an unsupported kind");
    }
    const expected = new Set([
      "evidenceRefId",
      "kind",
      ...(targetKey ? [targetKey] : []),
    ]);
    if (
      Object.keys(value).some((key) => !expected.has(key)) ||
      Object.keys(value).length !== expected.size ||
      (targetKey !== null &&
        (typeof value[targetKey] !== "string" ||
          !UUID.test(value[targetKey] as string)))
    ) {
      throw new RangeError("evidenceRefs must preserve an exact typed shape");
    }
  }
}

function assertOriginInput(input: CompetitorOriginInput): void {
  assertDomain(input.domain);
  assertName(input.name);
  switch (input.originKind) {
    case "product_profile":
      assertUuid(input.productProfileId, "productProfileId");
      assertUuid(input.candidateId, "candidateId");
      if (!Number.isSafeInteger(input.profileVersion) || input.profileVersion < 1) {
        throw new RangeError("profileVersion must be a positive safe integer");
      }
      if (
        input.fieldProvenancePath !== "/competitorCandidates" &&
        !PROFILE_PATH.test(input.fieldProvenancePath)
      ) {
        throw new RangeError("fieldProvenancePath must cover a competitor candidate");
      }
      assertEvidenceRefs(input.evidenceRefs);
      if (!REVIEW_STATUSES.has(input.sourceReviewStatus)) {
        throw new RangeError("sourceReviewStatus is unsupported");
      }
      if (
        input.sourceRelationship !== null &&
        !PROFILE_RELATIONSHIPS.has(input.sourceRelationship)
      ) {
        throw new RangeError(
          "sourceRelationship must be a Product Profile direct/indirect value",
        );
      }
      assertAnalysisScope(input.sourceAnalysisScope);
      if (
        input.sourceReviewStatus === "approved" &&
        (input.sourceRelationship === null ||
          input.sourceAnalysisScope.length === 0)
      ) {
        throw new RangeError(
          "approved Product Profile competitors require relationship and scope",
        );
      }
      return;
    case "csv_keyword_gap":
      assertUuid(input.snapshotId, "snapshotId");
      assertUuid(input.observationId, "observationId");
      assertUuid(input.importPreviewId, "importPreviewId");
      if (
        input.name !== null ||
        input.sourcePointer !== "/valueJson/competitorDomain"
      ) {
        throw new RangeError(
          "CSV competitor origin requires the canonical competitorDomain pointer",
        );
      }
      return;
    case "manual":
      assertUuid(input.manualEntryId, "manualEntryId");
      return;
    default:
      throw new RangeError("unsupported competitor origin kind");
  }
}

function assertReviewInput(input: CompetitorReviewInput): void {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new RangeError("expectedRevision must be a non-negative safe integer");
  }
  assertName(input.name);
  if (!REVIEW_STATUSES.has(input.reviewStatus)) {
    throw new RangeError("reviewStatus is unsupported");
  }
  if (input.relationship !== null && !RELATIONSHIPS.has(input.relationship)) {
    throw new RangeError("relationship is unsupported");
  }
  assertAnalysisScope(input.analysisScope);
  if (
    input.reviewStatus === "approved" &&
    (input.relationship === null || input.analysisScope.length === 0)
  ) {
    throw new RangeError(
      "approved competitors require a relationship and non-empty analysisScope",
    );
  }
  if (
    input.reviewStatus !== "approved" &&
    (input.relationship !== null || input.analysisScope.length !== 0)
  ) {
    throw new RangeError(
      `${input.reviewStatus} competitors cannot enter an approved relationship or scope`,
    );
  }
}

function parseUpsertResult(value: unknown): CompetitorOriginUpsertResult {
  const rows = (value as {
    readonly rows?: readonly {
      readonly occurrence_id?: unknown;
      readonly competitor_id?: unknown;
    }[];
  }).rows;
  const row = rows?.length === 1 ? rows[0] : undefined;
  if (
    !row ||
    typeof row.occurrence_id !== "string" ||
    typeof row.competitor_id !== "string"
  ) {
    throw new Error("competitor origin upsert returned an invalid result");
  }
  return {
    occurrenceId: row.occurrence_id,
    competitorId: row.competitor_id,
  };
}

function originParameters(input: CompetitorOriginInput) {
  if (input.originKind === "product_profile") {
    return {
      productProfileId: input.productProfileId,
      profileVersion: input.profileVersion,
      candidateId: input.candidateId,
      fieldProvenancePath: input.fieldProvenancePath,
      evidenceRefs: JSON.stringify(input.evidenceRefs),
      sourceReviewStatus: input.sourceReviewStatus,
      sourceRelationship: input.sourceRelationship,
      sourceAnalysisScope: [...input.sourceAnalysisScope],
      snapshotId: null,
      observationId: null,
      importPreviewId: null,
      sourcePointer: null,
      manualEntryId: null,
    };
  }
  if (input.originKind === "csv_keyword_gap") {
    return {
      productProfileId: null,
      profileVersion: null,
      candidateId: null,
      fieldProvenancePath: null,
      evidenceRefs: null,
      sourceReviewStatus: null,
      sourceRelationship: null,
      sourceAnalysisScope: null,
      snapshotId: input.snapshotId,
      observationId: input.observationId,
      importPreviewId: input.importPreviewId,
      sourcePointer: input.sourcePointer,
      manualEntryId: null,
    };
  }
  return {
    productProfileId: null,
    profileVersion: null,
    candidateId: null,
    fieldProvenancePath: null,
    evidenceRefs: null,
    sourceReviewStatus: null,
    sourceRelationship: null,
    sourceAnalysisScope: null,
    snapshotId: null,
    observationId: null,
    importPreviewId: null,
    sourcePointer: null,
    manualEntryId: input.manualEntryId,
  };
}

export class CompetitorsRepository extends Repository {
  async upsertOrigin(
    scope: ProjectScope,
    input: CompetitorOriginInput,
  ): Promise<CompetitorOriginUpsertResult> {
    assertOriginInput(input);
    const p = originParameters(input);
    const result = await this.exec.execute(sql`
      select occurrence_id, competitor_id
      from app.upsert_competitor_origin(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${input.domain}::text,
        ${input.name}::text,
        ${input.originKind}::text,
        ${p.productProfileId}::uuid,
        ${p.profileVersion}::integer,
        ${p.candidateId}::uuid,
        ${p.fieldProvenancePath}::text,
        ${p.evidenceRefs}::jsonb,
        ${p.sourceReviewStatus}::text,
        ${p.sourceRelationship}::text,
        ${sql.param(p.sourceAnalysisScope)}::text[],
        ${p.snapshotId}::uuid,
        ${p.observationId}::uuid,
        ${p.importPreviewId}::uuid,
        ${p.sourcePointer}::text,
        ${p.manualEntryId}::uuid
      )
    `);
    return parseUpsertResult(result);
  }

  async listByProject(
    scope: ProjectScope,
    options: CompetitorListOptions,
  ): Promise<CompetitorListPage> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_COMPETITOR_PAGE_SIZE
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_COMPETITOR_PAGE_SIZE}`,
      );
    }
    if (
      options.reviewStatus != null &&
      !REVIEW_STATUSES.has(options.reviewStatus)
    ) {
      throw new RangeError("reviewStatus is unsupported");
    }
    const decoded = options.cursor
      ? decodeTimestampUuidCursor(options.cursor)
      : null;
    if (options.cursor && !decoded) return { rows: [], nextCursor: null };
    const after = decoded
      ? or(
          lt(competitorEntities.created_at, decoded.timestamp),
          and(
            eq(competitorEntities.created_at, decoded.timestamp),
            lt(competitorEntities.id, decoded.id),
          ),
        )
      : undefined;
    const rows = (await this.exec
      .select(competitorSelection)
      .from(competitorEntities)
      .where(
        and(
          projectPredicate(competitorEntities, scope),
          activeProjectPredicate(scope),
          options.reviewStatus
            ? eq(competitorEntities.review_status, options.reviewStatus)
            : undefined,
          after,
        ),
      )
      .orderBy(desc(competitorEntities.created_at), desc(competitorEntities.id))
      .limit(options.limit + 1)) as CompetitorEntityRow[];
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
    competitorId: string,
  ): Promise<CompetitorEntityRow | null> {
    assertUuid(competitorId, "competitorId");
    const rows = (await this.exec
      .select(competitorSelection)
      .from(competitorEntities)
      .where(
        and(
          projectPredicate(competitorEntities, scope),
          eq(competitorEntities.id, competitorId),
          activeProjectPredicate(scope),
        ),
      )
      .limit(1)) as CompetitorEntityRow[];
    return rows[0] ?? null;
  }

  async listOrigins(
    scope: ProjectScope,
    competitorId: string,
    limit: number,
  ): Promise<CompetitorOriginRow[]> {
    assertUuid(competitorId, "competitorId");
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_COMPETITOR_ORIGIN_PAGE_SIZE
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_COMPETITOR_ORIGIN_PAGE_SIZE}`,
      );
    }
    return (await this.exec
      .select(originSelection)
      .from(competitorOriginOccurrences)
      .where(
        and(
          projectPredicate(competitorOriginOccurrences, scope),
          eq(competitorOriginOccurrences.competitor_id, competitorId),
          activeProjectPredicate(scope),
          sql`exists (
            select 1
            from ${competitorEntities}
            where ${competitorEntities.id} = ${competitorId}
              and ${competitorEntities.workspace_id} = ${scope.workspaceId}
              and ${competitorEntities.project_id} = ${scope.projectId}
          )`,
        ),
      )
      .orderBy(
        sql`${competitorOriginOccurrences.observed_at} desc nulls last`,
        desc(competitorOriginOccurrences.created_at),
        desc(competitorOriginOccurrences.id),
      )
      .limit(limit)) as CompetitorOriginRow[];
  }

  /** Null means stale revision, absent entity, foreign scope, or archived project. */
  async review(
    scope: ProjectScope,
    competitorId: string,
    input: CompetitorReviewInput,
  ): Promise<CompetitorEntityRow | null> {
    assertUuid(competitorId, "competitorId");
    assertReviewInput(input);
    const rows = (await this.exec
      .update(competitorEntities)
      .set({
        name: input.name,
        review_status: input.reviewStatus,
        relationship: input.relationship,
        analysis_scope: [...input.analysisScope],
        revision: input.expectedRevision + 1,
      })
      .where(
        and(
          projectPredicate(competitorEntities, scope),
          eq(competitorEntities.id, competitorId),
          eq(competitorEntities.revision, input.expectedRevision),
          activeProjectPredicate(scope),
        ),
      )
      .returning(competitorSelection)) as CompetitorEntityRow[];
    return rows[0] ?? null;
  }
}
