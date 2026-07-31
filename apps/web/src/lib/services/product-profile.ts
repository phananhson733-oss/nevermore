import {
  AddProductProfileCompetitorRequest as AddCompetitorRequestSchema,
  ConfirmedProductProfile as ConfirmedProfileSchema,
  ConfirmedProductProfileRowDto as ConfirmedRowSchema,
  ConfirmProductProfileRequest as ConfirmRequestSchema,
  PRODUCT_PROFILE_SCHEMA_VERSION,
  ProductProfileDraft as DraftProfileSchema,
  ProductProfileDraftRowDto as DraftRowSchema,
  ReviewProductProfileCompetitorRequest as ReviewCompetitorRequestSchema,
  UpdateProductProfileDraftRequest as UpdateDraftRequestSchema,
  type AddProductProfileCompetitorRequest,
  type ConfirmedProductProfile,
  type ConfirmedProductProfileRowDto,
  type ConfirmProductProfileRequest,
  type ProductProfileDraft,
  type ProductProfileDraftRowDto,
  type ProductProfileFieldProvenance,
  type ProductProfileRowDto,
  type ReviewProductProfileCompetitorRequest,
  type UpdateProductProfileDraftRequest,
} from "@sf/contracts";
import {
  AsyncRunsRepository,
  canonicalUtcTimestamptz,
  contentHash,
  IcpProfilesRepository,
  ProductProfileRunsRepository,
  ProjectsRepository,
  SitesRepository,
  type AsyncRunRow,
  type CanonicalValue,
  type Executor,
  type IcpProfileRow,
  type ProjectRow,
  type ProjectScope,
  type ProductProfileProvenanceIssue,
  type WorkspaceScope,
} from "@sf/db";
import { ProblemError } from "@sf/observability";
import type { ZodError } from "zod";
import { getDb } from "@/lib/db";
import { isPostgresUniqueViolation } from "./db-errors";
import { projectConfirmedProductProfileCompetitors } from "./product-profile-competitor-projection";
import { toAsyncRunDto, type AsyncRunDto } from "./runs";

/** One queued/running Product Profile synthesis per project. */
export const PRODUCT_PROFILE_SYNTHESIS_ACTIVE_KEY =
  "product-profile:synthesis" as const;
const PRODUCT_PROFILE_CRAWL_ACTIVE_KEY = "collect:crawl:site_graph" as const;

const PROFILE_UNIQUE_CONSTRAINTS = [
  "icp_profiles_project_id_version_key",
  "icp_profiles_project_id_content_hash_key",
] as const;

const CUSTOMER_EDIT_LIMITATION =
  "Customer-declared edit; not independently observed.";
const DEFAULT_CUSTOMER_COMPETITOR_REASON = "Customer-declared competitor.";
const REQUIRED_CONFIRMED_SEMANTIC_ROOTS = [
  "/productName",
  "/oneLiner",
  "/category",
  "/productType",
  "/businessModels",
  "/valueProposition",
  "/coreFeatures",
  "/targetMarkets",
  "/targetAudiences",
] as const;
const TRACEABLE_DERIVATIONS = new Set([
  "declared",
  "observed",
  "computed",
  "inferred",
]);

export type ActiveProductProfileSynthesisRun = AsyncRunDto & {
  readonly kind: "product_profile_synthesis";
  readonly status: "queued" | "running";
  readonly resultRef: null;
};

export type ActiveProductProfileCrawlRun = AsyncRunDto & {
  readonly kind: "collection";
  readonly status: "queued" | "running";
  readonly resultRef: null;
};

export interface ProductProfileWorkspace {
  readonly projectId: string;
  readonly currentProfile: ProductProfileRowDto | null;
  readonly confirmedProfile: ConfirmedProductProfileRowDto | null;
  /** Durable guard against auto-recreating a failed initial synthesis on refresh. */
  readonly hasSynthesisAttemptForCurrentDraft: boolean;
  readonly activeSynthesisRun: ActiveProductProfileSynthesisRun | null;
  readonly activeCrawlRun: ActiveProductProfileCrawlRun | null;
}

function pointerToken(value: PropertyKey): string {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function validationProblem(detail: string, error?: ZodError): ProblemError {
  return new ProblemError("VALIDATION_ERROR", detail, {
    ...(error
      ? {
          errors: error.issues.map((issue) => ({
            pointer:
              issue.path.length === 0
                ? "/"
                : `/${issue.path.map(pointerToken).join("/")}`,
            code: issue.code,
            message: issue.message,
          })),
        }
      : {}),
  });
}

function provenanceValidationProblem(
  issues: readonly ProductProfileProvenanceIssue[],
): ProblemError {
  return new ProblemError(
    "VALIDATION_ERROR",
    "Product Profile provenance does not match its frozen source data.",
    {
      errors: issues.map((issue) => ({
        pointer: issue.path,
        code: issue.code,
        // Do not expose whether a caller-supplied foreign UUID exists. The
        // scoped repository/DB validator retains the exact diagnostic while
        // the customer receives one safe, actionable explanation.
        message:
          "The referenced evidence is missing, stale, or outside this Product Profile's frozen source set.",
      })),
    },
  );
}

function versionConflict(baseVersion: number): ProblemError {
  return new ProblemError(
    "VERSION_CONFLICT",
    `Product Profile changed while saving baseVersion ${baseVersion}.`,
  );
}

async function mapProfileWrite<T>(
  baseVersion: number,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isPostgresUniqueViolation(error, PROFILE_UNIQUE_CONSTRAINTS)) {
      throw versionConflict(baseVersion);
    }
    throw error;
  }
}

function projectScope(scope: WorkspaceScope, projectId: string): ProjectScope {
  return { workspaceId: scope.workspaceId, projectId };
}

function parseDraftRow(
  row: IcpProfileRow,
  currentProfileId: string | null,
): ProductProfileDraftRowDto | null {
  if (row.status !== "draft") return null;
  const profile = DraftProfileSchema.safeParse(row.profile);
  if (!profile.success) return null;
  return DraftRowSchema.parse({
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: "draft",
    profile: profile.data,
    contentHash: row.content_hash,
    createdAt: canonicalUtcTimestamptz(row.created_at),
    isCurrent: row.id === currentProfileId,
    isConfirmed: false,
  });
}

function parseConfirmedRow(
  row: IcpProfileRow,
  currentProfileId: string | null,
): ConfirmedProductProfileRowDto | null {
  if (row.status !== "complete") return null;
  const profile = ConfirmedProfileSchema.safeParse(row.profile);
  if (!profile.success) return null;
  return ConfirmedRowSchema.parse({
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: "complete",
    profile: profile.data,
    contentHash: row.content_hash,
    createdAt: canonicalUtcTimestamptz(row.created_at),
    isCurrent: row.id === currentProfileId,
    isConfirmed: true,
  });
}

function activeSynthesisRun(
  row: AsyncRunRow | null,
): ActiveProductProfileSynthesisRun | null {
  if (
    row?.kind !== "product_profile_synthesis" ||
    (row.status !== "queued" && row.status !== "running") ||
    row.result_type !== null ||
    row.result_id !== null
  ) {
    return null;
  }
  return {
    ...toAsyncRunDto(row),
    kind: "product_profile_synthesis",
    status: row.status,
    resultRef: null,
  };
}

function activeCrawlRun(
  row: AsyncRunRow | null,
): ActiveProductProfileCrawlRun | null {
  if (
    row?.kind !== "collection" ||
    (row.status !== "queued" && row.status !== "running") ||
    row.result_type !== null ||
    row.result_id !== null
  ) {
    return null;
  }
  return {
    ...toAsyncRunDto(row),
    kind: "collection",
    status: row.status,
    resultRef: null,
  };
}

/** Read only formally versioned Product Profile rows; legacy opaque ICP stays hidden. */
export async function getProductProfileWorkspace(
  scope: WorkspaceScope,
  projectId: string,
): Promise<ProductProfileWorkspace> {
  const { db } = getDb();
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");

  const scoped = projectScope(scope, projectId);
  const profileIds = [
    project.current_icp_profile_id,
    project.confirmed_icp_profile_id,
  ].filter((id): id is string => id !== null);
  const uniqueIds = [...new Set(profileIds)];
  const [rows, activeSynthesis, activeCrawl] = await Promise.all([
    Promise.all(
      uniqueIds.map((id) => new IcpProfilesRepository(db).findById(scoped, id)),
    ),
    new AsyncRunsRepository(db).findActive(
      scoped,
      PRODUCT_PROFILE_SYNTHESIS_ACTIVE_KEY,
    ),
    new AsyncRunsRepository(db).findActive(
      scoped,
      PRODUCT_PROFILE_CRAWL_ACTIVE_KEY,
    ),
  ]);
  const byId = new Map(
    rows.flatMap((row) => (row === null ? [] : [[row.id, row] as const])),
  );

  const currentRow = project.current_icp_profile_id
    ? (byId.get(project.current_icp_profile_id) ?? null)
    : null;
  const confirmedRow = project.confirmed_icp_profile_id
    ? (byId.get(project.confirmed_icp_profile_id) ?? null)
    : null;

  // A complete public row is necessarily confirmed. Fail closed for any legacy
  // complete current pointer that was never selected as the confirmed profile.
  const currentProfile = currentRow
    ? currentRow.status === "draft"
      ? parseDraftRow(currentRow, project.current_icp_profile_id)
      : currentRow.id === project.confirmed_icp_profile_id
        ? parseConfirmedRow(currentRow, project.current_icp_profile_id)
        : null
    : null;
  const confirmedProfile = confirmedRow
    ? parseConfirmedRow(confirmedRow, project.current_icp_profile_id)
    : null;
  const hasSynthesisAttemptForCurrentDraft =
    currentProfile?.status === "draft" && currentRow !== null
      ? await new ProductProfileRunsRepository(db).hasAttemptForBaseProfile(
          scoped,
          {
            id: currentRow.id,
            version: currentRow.version,
            contentHash: currentRow.content_hash,
          },
        )
      : false;

  return {
    projectId,
    currentProfile,
    confirmedProfile,
    hasSynthesisAttemptForCurrentDraft,
    activeSynthesisRun: activeSynthesisRun(activeSynthesis),
    activeCrawlRun: activeCrawlRun(activeCrawl),
  };
}

interface LockedDraft {
  readonly project: ProjectRow;
  readonly row: IcpProfileRow;
  readonly profile: ProductProfileDraft;
}

async function lockCurrentDraft(
  tx: Executor,
  scope: WorkspaceScope,
  projectId: string,
  baseVersion: number,
): Promise<LockedDraft> {
  const projects = new ProjectsRepository(tx);
  const profiles = new IcpProfilesRepository(tx);
  const project = await projects.findByIdForUpdate(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) {
    throw new ProblemError(
      "PROJECT_ARCHIVED",
      "Project is archived and read-only.",
    );
  }
  if (!project.current_icp_profile_id) {
    throw validationProblem("A current Product Profile draft is required.");
  }
  const row = await profiles.findById(
    projectScope(scope, projectId),
    project.current_icp_profile_id,
  );
  if (!row) {
    throw validationProblem("A current Product Profile draft is required.");
  }
  if (row.version !== baseVersion) throw versionConflict(baseVersion);
  if (row.status !== "draft") {
    throw validationProblem("The current Product Profile is not an editable draft.");
  }
  const parsed = DraftProfileSchema.safeParse(row.profile);
  if (!parsed.success) {
    throw validationProblem(
      "The current ICP row is not a Product Profile draft.",
      parsed.error,
    );
  }
  return { project, row, profile: parsed.data };
}

function deterministicUuidV8(seed: CanonicalValue): string {
  const raw = contentHash(seed).slice(0, 32);
  const versioned = `${raw.slice(0, 12)}8${raw.slice(13)}`;
  const variant = (
    (Number.parseInt(versioned[16]!, 16) & 0b0011) |
    0b1000
  ).toString(16);
  const hex = `${versioned.slice(0, 16)}${variant}${versioned.slice(17)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isPathInSubtree(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function sortedProvenance(
  values: readonly ProductProfileFieldProvenance[],
): ProductProfileFieldProvenance[] {
  return [...values].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function customerEditProvenance(
  profile: ProductProfileDraft,
  path: string,
  value: unknown,
): ProductProfileFieldProvenance {
  return {
    path,
    derivation: "declared",
    confidence: "high",
    evidenceRefs: [
      {
        evidenceRefId: deterministicUuidV8({
          namespace: "product-profile-user-edit.0.3.0",
          profileSchemaVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
          sourceSiteId: profile.sourceSiteId,
          sourcePageUrl: profile.sourcePageUrl,
          path,
          value: value as CanonicalValue,
        }),
        kind: "userEdit",
      },
    ],
    limitation: CUSTOMER_EDIT_LIMITATION,
    observedAt: null,
  };
}

function emptyProfileField(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

function parseMutatedDraft(value: unknown): ProductProfileDraft {
  const parsed = DraftProfileSchema.safeParse(value);
  if (!parsed.success) {
    throw validationProblem("Product Profile mutation is invalid.", parsed.error);
  }
  return parsed.data;
}

/** Deterministic server rewrite for the contract-owned top-level edit surface. */
export function applyProductProfileEditablePatch(
  profile: ProductProfileDraft,
  patch: UpdateProductProfileDraftRequest["patch"],
): ProductProfileDraft {
  const next = { ...profile, ...patch };
  let provenance = [...profile.fieldProvenance];
  let missing = [...profile.missingFields];
  let conflicting = [...profile.conflictingFields];

  for (const [field, value] of Object.entries(patch)) {
    const path = `/${field}`;
    provenance = provenance.filter(
      (entry) => !isPathInSubtree(entry.path, path),
    );
    missing = missing.filter((entry) => !isPathInSubtree(entry, path));
    conflicting = conflicting.filter(
      (entry) => !isPathInSubtree(entry, path),
    );
    if (emptyProfileField(value)) missing.push(path);
    else provenance.push(customerEditProvenance(profile, path, value));
  }

  return parseMutatedDraft({
    ...next,
    fieldProvenance: sortedProvenance(provenance),
    missingFields: sortedUnique(missing),
    conflictingFields: sortedUnique(conflicting),
  });
}

async function appendOrReuseDraft(
  tx: Executor,
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  currentProfileId: string,
  profile: ProductProfileDraft,
): Promise<ProductProfileDraftRowDto> {
  const scoped = projectScope(scope, projectId);
  const projects = new ProjectsRepository(tx);
  const profiles = new IcpProfilesRepository(tx);
  const hash = contentHash({
    status: "draft",
    profile: profile as unknown as CanonicalValue,
  });
  const duplicate = await profiles.findByContentHash(scoped, hash);
  let row: IcpProfileRow;
  if (duplicate) {
    row = duplicate;
  } else {
    row = await profiles.insertVersion({
      workspaceId: scope.workspaceId,
      projectId,
      version: (await profiles.maxVersion(scoped)) + 1,
      status: "draft",
      profile: profile as unknown as Record<string, unknown>,
      contentHash: hash,
      createdBy: actorId,
    });
  }
  if (row.id !== currentProfileId) {
    const updated = await projects.setCurrentIcpProfile(scope, projectId, row.id);
    if (!updated) throw new ProblemError("NOT_FOUND", "Project not found.");
  }
  const dto = parseDraftRow(row, row.id);
  if (!dto) {
    throw new Error("Persisted Product Profile draft failed canonical validation.");
  }
  return dto;
}

/** Append/reuse a customer-edited immutable draft and advance only current. */
export async function updateProductProfileDraft(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  body: UpdateProductProfileDraftRequest,
): Promise<ProductProfileDraftRowDto> {
  const parsed = UpdateDraftRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw validationProblem("Product Profile edit failed validation.", parsed.error);
  }
  const { db } = getDb();
  return mapProfileWrite(parsed.data.baseVersion, () =>
    db.transaction(async (tx) => {
      const locked = await lockCurrentDraft(
        tx,
        scope,
        projectId,
        parsed.data.baseVersion,
      );
      const profile = applyProductProfileEditablePatch(
        locked.profile,
        parsed.data.patch,
      );
      return appendOrReuseDraft(
        tx,
        scope,
        projectId,
        actorId,
        locked.row.id,
        profile,
      );
    }),
  );
}

function replaceCandidateProvenance(
  profile: ProductProfileDraft,
  candidateIndex: number,
  candidate: ProductProfileDraft["competitorCandidates"][number],
): Pick<
  ProductProfileDraft,
  "fieldProvenance" | "missingFields" | "conflictingFields"
> {
  const path = `/competitorCandidates/${candidateIndex}`;
  const provenance = profile.fieldProvenance.filter(
    (entry) =>
      !isPathInSubtree(entry.path, path) &&
      !(
        entry.path === "/competitorCandidates" &&
        entry.derivation === "missing"
      ),
  );
  provenance.push(customerEditProvenance(profile, path, candidate));
  return {
    fieldProvenance: sortedProvenance(provenance),
    missingFields: sortedUnique(
      profile.missingFields.filter(
        (entry) =>
          entry !== "/competitorCandidates" &&
          !isPathInSubtree(entry, path),
      ),
    ),
    conflictingFields: sortedUnique(
      profile.conflictingFields.filter(
        (entry) => !isPathInSubtree(entry, path),
      ),
    ),
  };
}

/** Review/correct one server-identified competitor without replacing identity. */
export async function reviewProductProfileCompetitor(
  scope: WorkspaceScope,
  projectId: string,
  candidateId: string,
  actorId: string,
  body: ReviewProductProfileCompetitorRequest,
): Promise<ProductProfileDraftRowDto> {
  const parsed = ReviewCompetitorRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw validationProblem("Competitor review failed validation.", parsed.error);
  }
  const { db } = getDb();
  return mapProfileWrite(parsed.data.baseVersion, () =>
    db.transaction(async (tx) => {
      const locked = await lockCurrentDraft(
        tx,
        scope,
        projectId,
        parsed.data.baseVersion,
      );
      const index = locked.profile.competitorCandidates.findIndex(
        (candidate) => candidate.candidateId === candidateId,
      );
      if (index < 0) {
        throw new ProblemError("NOT_FOUND", "Competitor candidate not found.");
      }
      const current = locked.profile.competitorCandidates[index]!;
      const reviewed = {
        ...current,
        reviewStatus: parsed.data.reviewStatus,
        ...(parsed.data.relationship !== undefined
          ? { relationship: parsed.data.relationship }
          : {}),
        ...(parsed.data.analysisScope !== undefined
          ? { analysisScope: parsed.data.analysisScope }
          : {}),
        ...(parsed.data.reason !== undefined
          ? { reason: parsed.data.reason }
          : {}),
        ...(parsed.data.similarity !== undefined
          ? { similarity: parsed.data.similarity }
          : {}),
        confidence: "high" as const,
      };
      if (
        reviewed.reviewStatus === "approved" &&
        (reviewed.relationship === null || reviewed.analysisScope.length === 0)
      ) {
        throw validationProblem(
          "Approved competitors require a relationship and analysis scope.",
        );
      }
      const competitorCandidates = [...locked.profile.competitorCandidates];
      competitorCandidates[index] = reviewed;
      const profile = parseMutatedDraft({
        ...locked.profile,
        competitorCandidates,
        ...replaceCandidateProvenance(locked.profile, index, reviewed),
      });
      return appendOrReuseDraft(
        tx,
        scope,
        projectId,
        actorId,
        locked.row.id,
        profile,
      );
    }),
  );
}

/** Add one honest customer-declared competitor; similarity remains unknown. */
export async function addProductProfileCompetitor(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  body: AddProductProfileCompetitorRequest,
): Promise<ProductProfileDraftRowDto> {
  const parsed = AddCompetitorRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw validationProblem("Competitor failed validation.", parsed.error);
  }
  const { db } = getDb();
  return mapProfileWrite(parsed.data.baseVersion, () =>
    db.transaction(async (tx) => {
      const locked = await lockCurrentDraft(
        tx,
        scope,
        projectId,
        parsed.data.baseVersion,
      );
      if (
        locked.profile.competitorCandidates.some(
          (candidate) => candidate.domain === parsed.data.domain,
        )
      ) {
        throw validationProblem("A competitor with this domain already exists.");
      }
      const candidate = {
        candidateId: deterministicUuidV8({
          namespace: "product-profile-competitor.0.3.0",
          projectId,
          sourceSiteId: locked.profile.sourceSiteId,
          domain: parsed.data.domain,
        }),
        name: parsed.data.name,
        domain: parsed.data.domain,
        relationship: parsed.data.relationship,
        analysisScope: parsed.data.analysisScope,
        similarity: null,
        reason: parsed.data.reason ?? DEFAULT_CUSTOMER_COMPETITOR_REASON,
        reviewStatus: "approved" as const,
        confidence: "high" as const,
      };
      const index = locked.profile.competitorCandidates.length;
      const profile = parseMutatedDraft({
        ...locked.profile,
        competitorCandidates: [
          ...locked.profile.competitorCandidates,
          candidate,
        ],
        ...replaceCandidateProvenance(locked.profile, index, candidate),
      });
      return appendOrReuseDraft(
        tx,
        scope,
        projectId,
        actorId,
        locked.row.id,
        profile,
      );
    }),
  );
}

async function appendOrReuseConfirmed(
  tx: Executor,
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  profile: ConfirmedProductProfile,
): Promise<ConfirmedProductProfileRowDto> {
  const scoped = projectScope(scope, projectId);
  const profiles = new IcpProfilesRepository(tx);
  const projects = new ProjectsRepository(tx);
  const sites = new SitesRepository(tx);
  const hash = contentHash({
    status: "complete",
    profile: profile as unknown as CanonicalValue,
  });
  const duplicate = await profiles.findByContentHash(scoped, hash);
  const row =
    duplicate ??
    (await profiles.insertVersion({
      workspaceId: scope.workspaceId,
      projectId,
      version: (await profiles.maxVersion(scoped)) + 1,
      status: "complete",
      profile: profile as unknown as Record<string, unknown>,
      contentHash: hash,
      createdBy: actorId,
    }));
  const confirmed = parseConfirmedRow(row, row.id);
  if (!confirmed) {
    throw new Error("Persisted confirmed Product Profile failed validation.");
  }

  if (!(await projects.setCurrentIcpProfile(scope, projectId, row.id))) {
    throw new ProblemError("NOT_FOUND", "Project not found.");
  }
  if (!(await projects.setConfirmedIcpProfile(scope, projectId, row.id))) {
    throw new ProblemError("NOT_FOUND", "Project not found.");
  }
  await projectConfirmedProductProfileCompetitors(
    tx,
    scoped,
    { id: row.id, version: row.version },
    profile,
  );
  await sites.updatePrimaryMarketCodes(
    scoped,
    profile.targetMarkets.map((market) => market.marketCode),
  );
  await projects.setReadyToDiagnoseIfEligible(scope, projectId);
  return confirmed;
}

function hasTraceableCoverage(
  profile: ConfirmedProductProfile,
  root: string,
): boolean {
  return profile.fieldProvenance.some(
    (entry) =>
      isPathInSubtree(entry.path, root) &&
      TRACEABLE_DERIVATIONS.has(entry.derivation),
  );
}

function hasUnresolvedMarker(
  profile: ConfirmedProductProfile,
  root: string,
): boolean {
  return [...profile.missingFields, ...profile.conflictingFields].some((path) =>
    isPathInSubtree(path, root),
  );
}

/**
 * A structurally complete profile is not automatically evidence-backed. Audit
 * inputs must not become customer-visible facts unless each required semantic
 * root—and each retained competitor—has a declared or canonical provenance
 * anchor and no unresolved marker. A pool-level `/competitorCandidates` anchor
 * covers the complete pool; otherwise every candidate needs its index subtree.
 */
function assertConfirmedTraceability(profile: ConfirmedProductProfile): void {
  for (const root of REQUIRED_CONFIRMED_SEMANTIC_ROOTS) {
    if (hasUnresolvedMarker(profile, root)) {
      throw validationProblem(
        `Product Profile field ${root} is still missing or conflicting.`,
      );
    }
    if (!hasTraceableCoverage(profile, root)) {
      throw validationProblem(
        `Product Profile field ${root} has no traceable provenance.`,
      );
    }
  }

  if (profile.competitorCandidates.length === 0) return;
  const root = "/competitorCandidates";
  if (hasUnresolvedMarker(profile, root)) {
    throw validationProblem(
      "Product Profile competitors are still missing or conflicting.",
    );
  }
  const rootCoverage = profile.fieldProvenance.some(
    (entry) =>
      entry.path === root && TRACEABLE_DERIVATIONS.has(entry.derivation),
  );
  profile.competitorCandidates.forEach((_candidate, index) => {
    const candidateRoot = `${root}/${index}`;
    if (!rootCoverage && !hasTraceableCoverage(profile, candidateRoot)) {
      throw validationProblem(
        `Product Profile competitor ${index} has no traceable provenance.`,
      );
    }
  });
}

/** Confirm a reviewed profile. This transaction never creates or enqueues a run. */
export async function confirmProductProfile(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  body: ConfirmProductProfileRequest,
): Promise<ConfirmedProductProfileRowDto> {
  const parsedBody = ConfirmRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    throw validationProblem(
      "Product Profile confirmation failed validation.",
      parsedBody.error,
    );
  }
  const { db } = getDb();
  return mapProfileWrite(parsedBody.data.baseVersion, () =>
    db.transaction(async (tx) => {
      const locked = await lockCurrentDraft(
        tx,
        scope,
        projectId,
        parsedBody.data.baseVersion,
      );
      const confirmed = ConfirmedProfileSchema.safeParse(locked.profile);
      if (!confirmed.success) {
        throw validationProblem(
          "Product Profile is incomplete and cannot be confirmed.",
          confirmed.error,
        );
      }
      assertConfirmedTraceability(confirmed.data);
      const provenance =
        await new IcpProfilesRepository(
          tx,
        ).preflightProductProfileProvenance(
          projectScope(scope, projectId),
          confirmed.data,
        );
      if (!provenance.ok) {
        throw provenanceValidationProblem(provenance.issues);
      }
      return appendOrReuseConfirmed(
        tx,
        scope,
        projectId,
        actorId,
        provenance.profile,
      );
    }),
  );
}
