import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION } from "@sf/contracts";
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
  | "manual"
  | "serp_overlap";

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

export interface ProductProfileCompetitorOriginInput extends CompetitorOriginCommon {
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

export interface CsvKeywordGapCompetitorOriginInput extends CompetitorOriginCommon {
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

export interface SerpOverlapCompetitorOriginInput extends CompetitorOriginCommon {
  readonly originKind: "serp_overlap";
  readonly name: null;
  readonly snapshotId: string;
  readonly observationId: string;
  readonly sourcePointer: "/valueJson/competitorDomain";
}

export type CompetitorOriginInput =
  | ProductProfileCompetitorOriginInput
  | CsvKeywordGapCompetitorOriginInput
  | ManualCompetitorOriginInput
  | SerpOverlapCompetitorOriginInput;

type LegacyCompetitorOriginInput = Exclude<
  CompetitorOriginInput,
  SerpOverlapCompetitorOriginInput
>;

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

/**
 * System-owned Product Profile projection. Revision zero means the customer
 * has not made a Competitor Library governance decision yet, so the first
 * confirmed profile may seed the default state. Existing governance revisions
 * remain authoritative and are never overwritten.
 */
export interface ProductProfileDefaultGovernanceInput {
  readonly name: string;
  readonly reviewStatus: CompetitorReviewStatus;
  readonly relationship: "direct" | "indirect" | null;
  readonly analysisScope: readonly CompetitorAnalysisScope[];
}

export interface CompetitorOriginBatchOptions {
  readonly limitPerEntity: number;
  readonly totalLimit: number;
}

export interface CompetitorIdPageOptions {
  readonly limit: number;
  readonly cursor: string | null;
}

export const MAX_COMPETITOR_PAGE_SIZE = 100;
export const MAX_COMPETITOR_ORIGIN_PAGE_SIZE = 100;
export const MAX_COMPETITOR_ORIGIN_BATCH_TOTAL = 2_000;
/** 500 accepted facts plus one overflow sentinel. */
export const MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ = 501;

/**
 * Versions 1 through 8, because Product Profile identity is UUIDv8.
 *
 * Competitor candidateId and evidenceRefId are derived deterministically from
 * the profile's own content so that re-synthesising the same site yields the
 * same identities. That derivation stamps version 8 (RFC 9562's custom
 * format), so a [1-5] bound rejected every competitor a Product Profile ever
 * produced — confirmation failed with a RangeError the moment a profile
 * carried one, which the E2E suite missed by confirming empty competitor
 * pools. Sibling repositories already accept [1-8]; this one was left behind.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
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

/** Safety ceiling for one frozen competitor identity set. */
export const MAX_COMPETITOR_ENTITY_BATCH = 500;

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
  field_provenance_path: competitorOriginOccurrences.field_provenance_path,
  evidence_refs: competitorOriginOccurrences.evidence_refs,
  source_review_status: competitorOriginOccurrences.source_review_status,
  source_relationship: competitorOriginOccurrences.source_relationship,
  source_analysis_scope: competitorOriginOccurrences.source_analysis_scope,
  data_snapshot_id: competitorOriginOccurrences.data_snapshot_id,
  normalized_observation_id:
    competitorOriginOccurrences.normalized_observation_id,
  import_preview_id: competitorOriginOccurrences.import_preview_id,
  source_pointer: competitorOriginOccurrences.source_pointer,
  manual_entry_id: competitorOriginOccurrences.manual_entry_id,
  observed_at: sql<
    string | null
  >`${competitorOriginOccurrences.observed_at}`.mapWith(
    nullableCanonicalInstant,
  ),
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

function assertOriginBatch(
  competitorIds: readonly string[],
  options: CompetitorOriginBatchOptions,
): string[] {
  if (competitorIds.length > MAX_COMPETITOR_ENTITY_BATCH) {
    throw new RangeError(
      `competitorIds must contain at most ${MAX_COMPETITOR_ENTITY_BATCH} ids`,
    );
  }
  const unique = new Set<string>();
  for (const competitorId of competitorIds) {
    assertUuid(competitorId, "competitorId");
    if (unique.has(competitorId)) {
      throw new RangeError("competitorIds must contain unique ids");
    }
    unique.add(competitorId);
  }
  if (
    !Number.isSafeInteger(options.limitPerEntity) ||
    options.limitPerEntity < 1 ||
    options.limitPerEntity > MAX_COMPETITOR_ORIGIN_PAGE_SIZE
  ) {
    throw new RangeError(
      `limitPerEntity must be between 1 and ${MAX_COMPETITOR_ORIGIN_PAGE_SIZE}`,
    );
  }
  if (
    !Number.isSafeInteger(options.totalLimit) ||
    options.totalLimit < 1 ||
    options.totalLimit > MAX_COMPETITOR_ORIGIN_BATCH_TOTAL
  ) {
    throw new RangeError(
      `totalLimit must be between 1 and ${MAX_COMPETITOR_ORIGIN_BATCH_TOTAL}`,
    );
  }
  return [...unique].sort();
}

function assertIdBatch(
  ids: readonly string[],
  label: string,
  maximum: number,
): string[] {
  if (ids.length > maximum) {
    throw new RangeError(`${label} must contain at most ${maximum} ids`);
  }
  const unique = new Set<string>();
  for (const id of ids) {
    assertUuid(id, label.slice(0, -1));
    if (unique.has(id)) {
      throw new RangeError(`${label} must contain unique ids`);
    }
    unique.add(id);
  }
  return [...unique];
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
      if (
        !Number.isSafeInteger(input.profileVersion) ||
        input.profileVersion < 1
      ) {
        throw new RangeError("profileVersion must be a positive safe integer");
      }
      if (
        input.fieldProvenancePath !== "/competitorCandidates" &&
        !PROFILE_PATH.test(input.fieldProvenancePath)
      ) {
        throw new RangeError(
          "fieldProvenancePath must cover a competitor candidate",
        );
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
    case "serp_overlap":
      assertUuid(input.snapshotId, "snapshotId");
      assertUuid(input.observationId, "observationId");
      if (
        input.name !== null ||
        input.sourcePointer !== "/valueJson/competitorDomain"
      ) {
        throw new RangeError(
          "SERP overlap origin requires the canonical competitorDomain pointer and no inferred name",
        );
      }
      return;
    default:
      throw new RangeError("unsupported competitor origin kind");
  }
}

function assertReviewInput(input: CompetitorReviewInput): void {
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >
      MAX_INCREMENTABLE_KEYWORD_GOVERNANCE_REVISION
  ) {
    throw new RangeError(
      "expectedRevision must be inside the incrementable PostgreSQL integer range",
    );
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

function assertProductProfileDefaultGovernanceInput(
  input: ProductProfileDefaultGovernanceInput,
): void {
  assertName(input.name);
  if (!REVIEW_STATUSES.has(input.reviewStatus)) {
    throw new RangeError("reviewStatus is unsupported");
  }
  if (
    input.relationship !== null &&
    !PROFILE_RELATIONSHIPS.has(input.relationship)
  ) {
    throw new RangeError("relationship is unsupported");
  }
  assertAnalysisScope(input.analysisScope);
  if (
    input.reviewStatus === "approved"
      ? input.relationship === null || input.analysisScope.length === 0
      : input.relationship !== null || input.analysisScope.length !== 0
  ) {
    throw new RangeError(
      "Product Profile default governance must classify only approved competitors",
    );
  }
}

function parseUpsertResult(value: unknown): CompetitorOriginUpsertResult {
  const rows = (
    value as {
      readonly rows?: readonly {
        readonly occurrence_id?: unknown;
        readonly competitor_id?: unknown;
      }[];
    }
  ).rows;
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

function originParameters(input: LegacyCompetitorOriginInput) {
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
  async listDiagnosticEligible(
    scope: ProjectScope,
    options: { readonly limit: number },
  ): Promise<CompetitorEntityRow[]> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ
    ) {
      throw new RangeError(
        `limit must be between 1 and ${MAX_DIAGNOSTIC_COMPETITOR_ENTITY_READ}`,
      );
    }
    return (await this.exec
      .select(competitorSelection)
      .from(competitorEntities)
      .where(
        and(
          projectPredicate(competitorEntities, scope),
          activeProjectPredicate(scope),
          eq(competitorEntities.review_status, "approved"),
        ),
      )
      .orderBy(asc(competitorEntities.domain), asc(competitorEntities.id))
      .limit(options.limit)) as CompetitorEntityRow[];
  }

  async upsertOrigin(
    scope: ProjectScope,
    input: CompetitorOriginInput,
  ): Promise<CompetitorOriginUpsertResult> {
    assertOriginInput(input);
    if (input.originKind === "serp_overlap") {
      const result = await this.exec.execute(sql`
        select occurrence_id, competitor_id
        from app.upsert_serp_overlap_competitor_origin(
          ${scope.workspaceId}::uuid,
          ${scope.projectId}::uuid,
          ${input.domain}::text,
          ${input.snapshotId}::uuid,
          ${input.observationId}::uuid,
          ${input.sourcePointer}::text
        )
      `);
      return parseUpsertResult(result);
    }
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

  /**
   * Apply the confirmed Product Profile's opt-out default only while no
   * Competitor Library revision exists. The governance trigger records this as
   * revision 1 when a pre-existing candidate changes; newly inserted entities
   * already carry the desired state and remain revision 0.
   */
  async applyProductProfileDefaultGovernance(
    scope: ProjectScope,
    competitorId: string,
    input: ProductProfileDefaultGovernanceInput,
  ): Promise<CompetitorEntityRow | null> {
    assertUuid(competitorId, "competitorId");
    assertProductProfileDefaultGovernanceInput(input);
    const rows = (await this.exec
      .update(competitorEntities)
      .set({
        name: input.name,
        review_status: input.reviewStatus,
        relationship: input.relationship,
        analysis_scope: [...input.analysisScope],
        revision: 1,
      })
      .where(
        and(
          projectPredicate(competitorEntities, scope),
          eq(competitorEntities.id, competitorId),
          eq(competitorEntities.revision, 0),
          sql`(
            ${competitorEntities.name},
            ${competitorEntities.review_status},
            ${competitorEntities.relationship},
            ${competitorEntities.analysis_scope}
          ) IS DISTINCT FROM (
            ${input.name}::text,
            ${input.reviewStatus}::text,
            ${input.relationship}::text,
            ${sql.param([...input.analysisScope])}::text[]
          )`,
          activeProjectPredicate(scope),
        ),
      )
      .returning(competitorSelection)) as CompetitorEntityRow[];
    return rows[0] ?? null;
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

  /**
   * Bounded batch existence read for a frozen competitor identity set. Mirrors
   * `KeywordsRepository.listByIds`: a frozen explicit set must be proven to
   * belong to this live project without one query per id.
   */
  async listByIds(
    scope: ProjectScope,
    competitorIds: readonly string[],
  ): Promise<CompetitorEntityRow[]> {
    if (competitorIds.length === 0) return [];
    if (competitorIds.length > MAX_COMPETITOR_ENTITY_BATCH) {
      throw new RangeError(
        `competitorIds must contain at most ${MAX_COMPETITOR_ENTITY_BATCH} ids`,
      );
    }
    for (const competitorId of competitorIds) {
      assertUuid(competitorId, "competitorId");
    }
    return (await this.exec
      .select(competitorSelection)
      .from(competitorEntities)
      .where(
        and(
          projectPredicate(competitorEntities, scope),
          inArray(competitorEntities.id, [...competitorIds]),
          activeProjectPredicate(scope),
        ),
      )) as CompetitorEntityRow[];
  }

  async listByIdsPage(
    scope: ProjectScope,
    competitorIds: readonly string[],
    options: CompetitorIdPageOptions,
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
    const ids = assertIdBatch(
      competitorIds,
      "competitorIds",
      MAX_COMPETITOR_ENTITY_BATCH,
    );
    if (ids.length === 0) return { rows: [], nextCursor: null };
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
          inArray(competitorEntities.id, ids),
          activeProjectPredicate(scope),
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

  /**
   * One project-scoped origin read for a frozen competitor set. A per-entity
   * window and an outer sentinel bound both corrupt histories and total
   * manifest size without issuing one query per competitor.
   */
  async listOriginsForCompetitorIds(
    scope: ProjectScope,
    competitorIds: readonly string[],
    options: CompetitorOriginBatchOptions,
  ): Promise<CompetitorOriginRow[]> {
    const ids = assertOriginBatch(competitorIds, options);
    if (ids.length === 0) return [];
    const result = await this.exec.execute<Record<string, unknown>>(sql`
      with ranked_competitor_origins as (
        select
          ${competitorOriginOccurrences.id} as id,
          ${competitorOriginOccurrences.workspace_id} as workspace_id,
          ${competitorOriginOccurrences.project_id} as project_id,
          ${competitorOriginOccurrences.competitor_id} as competitor_id,
          ${competitorOriginOccurrences.origin_kind} as origin_kind,
          ${competitorOriginOccurrences.source_name} as source_name,
          ${competitorOriginOccurrences.product_profile_id} as product_profile_id,
          ${competitorOriginOccurrences.profile_version} as profile_version,
          ${competitorOriginOccurrences.candidate_id} as candidate_id,
          ${competitorOriginOccurrences.field_provenance_path} as field_provenance_path,
          ${competitorOriginOccurrences.evidence_refs} as evidence_refs,
          ${competitorOriginOccurrences.source_review_status} as source_review_status,
          ${competitorOriginOccurrences.source_relationship} as source_relationship,
          ${competitorOriginOccurrences.source_analysis_scope} as source_analysis_scope,
          ${competitorOriginOccurrences.data_snapshot_id} as data_snapshot_id,
          ${competitorOriginOccurrences.normalized_observation_id} as normalized_observation_id,
          ${competitorOriginOccurrences.import_preview_id} as import_preview_id,
          ${competitorOriginOccurrences.source_pointer} as source_pointer,
          ${competitorOriginOccurrences.manual_entry_id} as manual_entry_id,
          ${competitorOriginOccurrences.observed_at}::text as observed_at,
          ${competitorOriginOccurrences.created_at}::text as created_at,
          row_number() over (
            partition by ${competitorOriginOccurrences.competitor_id}
            order by
              ${competitorOriginOccurrences.observed_at} desc nulls last,
              ${competitorOriginOccurrences.created_at} desc,
              ${competitorOriginOccurrences.id} desc
          ) as entity_row_number
        from ${competitorOriginOccurrences}
        inner join ${competitorEntities}
          on ${competitorEntities.id} = ${competitorOriginOccurrences.competitor_id}
         and ${competitorEntities.workspace_id} = ${competitorOriginOccurrences.workspace_id}
         and ${competitorEntities.project_id} = ${competitorOriginOccurrences.project_id}
        inner join ${clientProjects}
          on ${clientProjects.id} = ${competitorOriginOccurrences.project_id}
         and ${clientProjects.workspace_id} = ${competitorOriginOccurrences.workspace_id}
        where ${competitorOriginOccurrences.workspace_id} = ${scope.workspaceId}
          and ${competitorOriginOccurrences.project_id} = ${scope.projectId}
          and ${clientProjects.archived_at} is null
          and ${competitorOriginOccurrences.competitor_id} in (
            ${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}
          )
      )
      select
        id,
        workspace_id,
        project_id,
        competitor_id,
        origin_kind,
        source_name,
        product_profile_id,
        profile_version,
        candidate_id,
        field_provenance_path,
        evidence_refs,
        source_review_status,
        source_relationship,
        source_analysis_scope,
        data_snapshot_id,
        normalized_observation_id,
        import_preview_id,
        source_pointer,
        manual_entry_id,
        observed_at,
        created_at
      from ranked_competitor_origins
      where entity_row_number <= ${options.limitPerEntity}
      order by
        competitor_id asc,
        observed_at desc nulls last,
        created_at desc,
        id desc
      limit ${options.totalLimit + 1}
    `);
    return result.rows as unknown as CompetitorOriginRow[];
  }

  async listOriginsByIds(
    scope: ProjectScope,
    occurrenceIds: readonly string[],
  ): Promise<CompetitorOriginRow[]> {
    const ids = assertIdBatch(
      occurrenceIds,
      "occurrenceIds",
      MAX_COMPETITOR_ORIGIN_BATCH_TOTAL,
    );
    if (ids.length === 0) return [];
    return (await this.exec
      .select(originSelection)
      .from(competitorOriginOccurrences)
      .where(
        and(
          projectPredicate(competitorOriginOccurrences, scope),
          inArray(competitorOriginOccurrences.id, ids),
          activeProjectPredicate(scope),
        ),
      )) as CompetitorOriginRow[];
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
